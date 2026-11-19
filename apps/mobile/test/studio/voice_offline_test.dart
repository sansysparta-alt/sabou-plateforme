// US-081 : voix du Studio mobile hors réseau.
// Critère 2 : brouillon de voix conservé hors réseau (coffre chiffré, décision du maître
//             d'œuvre du 19 novembre 2026), envoi au retour du réseau sans doublon (clé d'envoi).
// Critère 1 : alerte de bruit, ré-enregistrement (seul le dernier enregistrement compte).
// Les règles du serveur (cible, consentement, brouillon, clé rejouée) sont prouvées par
// apps/api/src/treatments/studio-voices.test.ts et packages/db/test/studio-voix-praticien.test.ts.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sabou_mobile/dossier/session.dart';
import 'package:sabou_mobile/studio/noise_meter.dart';
import 'package:sabou_mobile/studio/studio_api.dart';
import 'package:sabou_mobile/studio/voice_outbox.dart';
import 'package:sabou_mobile/studio/voice_vault.dart';

import '../dossier/fakes.dart';

final audio = utf8.encode(
  'ftypM4A voix du praticien, préparation de la décoction',
);

void main() {
  late Directory dir;
  late MemorySecretStore secrets;
  late VoiceVault vault;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('sabou-voix-');
    secrets = MemorySecretStore();
    vault = VoiceVault(directory: dir, secrets: secrets);
  });

  tearDown(() => dir.delete(recursive: true));

  Future<PendingVoice> record({
    String object = 'preparation',
    String code = 'REC-0001',
  }) => vault.put(
    code: code,
    target: 'section',
    object: object,
    contentType: 'audio/mp4',
    audio: audio,
  );

  group('Coffre des voix en attente (chiffré)', () {
    test(
      'la voix rangée est illisible sans la clé, relue à l’identique avec elle',
      () async {
        final voice = await record();
        final stored = await File('${dir.path}/${voice.clientKey}.voix')
            .readAsBytes();
        expect(
          utf8.decode(stored, allowMalformed: true),
          isNot(contains('praticien')),
        );
        expect(stored.length, audio.length + 12 + 16); // nonce + étiquette GCM
        expect(await vault.read(voice), audio);
        // Clé gardée dans le magasin sécurisé, jamais dans le dossier de l'application
        expect(secrets.values.keys, ['sabou.voice_vault_key']);
        expect(
          dir.listSync().map((f) => f.path).any((p) => p.contains('key')),
          isFalse,
        );
      },
    );

    test('contre-épreuve : une autre clé ne déchiffre pas', () async {
      final voice = await record();
      final other = VoiceVault(directory: dir, secrets: MemorySecretStore());
      expect(() => other.read(voice), throwsA(isA<Exception>()));
    });

    test('ré-enregistrer remplace la voix en attente de la même cible ; les autres restent', () async {
      final first = await record();
      await record(object: 'cycle');
      final second = await record();
      final pending = await vault.pending();
      expect(pending.map((p) => p.object), ['cycle', 'preparation']);
      expect(pending.last.clientKey, second.clientKey);
      expect(File('${dir.path}/${first.clientKey}.voix').existsSync(), isFalse);
    });

    test('la liste survit au redémarrage de l’application ; clés d’envoi uniques (UUID v4)', () async {
      final a = await record();
      final b = await record(object: 'cycle');
      final reopened = VoiceVault(directory: dir, secrets: secrets);
      expect((await reopened.pending()).map((p) => p.clientKey), [
        a.clientKey,
        b.clientKey,
      ]);
      expect(
        a.clientKey,
        matches(
          RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          ),
        ),
      );
      expect(a.clientKey, isNot(b.clientKey));
    });
  });

  group('Envoi au retour du réseau', () {
    late FakeServer server;
    late StudioApi api;
    late List<http.Request> voiceRequests;
    late Future<http.Response> Function(http.Request) voiceHandler;

    setUp(() async {
      server = FakeServer();
      voiceRequests = [];
      voiceHandler = (_) async => http.Response('[]', 200);
      final session = PractitionerSession(
        store: MemorySecretStore(),
        launcher: FakeLauncher(),
        client: server.client,
        issuer: issuer,
      );
      await session.signIn();
      api = StudioApi(
        baseUrl: Uri.parse('http://api.test'),
        session: session,
        client: MockClient((request) {
          if (!request.url.path.contains('/voix/')) {
            return server.handle(request);
          }
          voiceRequests.add(request);
          return voiceHandler(request);
        }),
      );
    });

    test(
      'envoie la voix déchiffrée avec sa clé, puis l’efface du téléphone',
      () async {
        final voice = await record();
        final result = await VoiceOutbox(vault: vault, api: api).flush();
        expect((result.sent, result.left), (1, 0));
        final request = voiceRequests.single;
        expect(request.method, 'PUT');
        expect(
          request.url.path,
          '/api/praticien/traitements/REC-0001/voix/section/preparation',
        );
        expect(request.url.queryParameters['cle'], voice.clientKey);
        expect(request.headers['content-type'], 'audio/mp4');
        expect(request.bodyBytes, audio);
        expect(await vault.pending(), isEmpty);
        expect(dir.listSync().where((f) => f.path.endsWith('.voix')), isEmpty);
      },
    );

    test(
      'sans réseau : rien n’est perdu ; au retour, la même clé est renvoyée',
      () async {
        final voice = await record();
        voiceHandler = (_) async =>
            throw http.ClientException('Réseau injoignable');
        final offline = await VoiceOutbox(vault: vault, api: api).flush();
        expect((offline.sent, offline.left), (0, 1));
        voiceHandler = (_) async => http.Response('[]', 200);
        final back = await VoiceOutbox(vault: vault, api: api).flush();
        expect((back.sent, back.left), (1, 0));
        expect(voiceRequests.map((r) => r.url.queryParameters['cle']), [
          voice.clientKey,
          voice.clientKey,
        ]);
      },
    );

    test('refus définitif (traitement soumis entre-temps) : gardé avec sa raison, plus tenté', () async {
      await record();
      voiceHandler = (_) async => http.Response.bytes(
        utf8.encode(
          jsonEncode({
            'error': 'locked',
            'message': 'Ce traitement a été soumis : il ne se modifie plus.',
          }),
        ),
        409,
      );
      final outbox = VoiceOutbox(vault: vault, api: api);
      final result = await outbox.flush();
      expect((result.failed, result.left), (1, 0));
      expect((await vault.pending()).single.error, contains('soumis'));
      await outbox.flush();
      expect(voiceRequests, hasLength(1));
    });

    test(
      'serveur saturé (429, 5xx) : la voix attend la tournée suivante',
      () async {
        await record();
        voiceHandler = (_) async => http.Response.bytes(
          utf8.encode(jsonEncode({'error': 'too_many', 'message': 'Trop'})),
          429,
        );
        final result = await VoiceOutbox(vault: vault, api: api).flush();
        expect((result.failed, result.left), (0, 1));
        expect((await vault.pending()).single.error, isNull);
      },
    );
  });

  group('Alerte de bruit', () {
    NoiseVerdict judge(Iterable<double> levels) {
      final meter = NoiseMeter();
      levels.forEach(meter.add);
      return meter.verdict();
    }

    // Parole : pics vers −15 dBFS, silences entre les mots au niveau du fond
    Iterable<double> speech(double floor) =>
        List.generate(40, (i) => i % 3 == 0 ? floor : -15.0);

    test('pièce calme : aucune alerte', () {
      expect(judge(speech(-55)), NoiseVerdict.ok);
      expect(noiseMessage(NoiseVerdict.ok), isNull);
    });

    test('marché ou rue : alerte et invitation à recommencer', () {
      expect(judge(speech(-28)), NoiseVerdict.noisy);
      expect(
        noiseMessage(NoiseVerdict.noisy),
        contains('enregistrez de nouveau'),
      );
    });

    test('son saturé, ou enregistrement trop court', () {
      expect(judge(List.filled(40, 0.0)), NoiseVerdict.clipping);
      expect(judge(speech(-55).take(10)), NoiseVerdict.tooShort);
    });

    test('contre-épreuve : le seuil décide (−36 dBFS passe, −34 alerte)', () {
      expect(judge(speech(noiseFloorLimitDb - 1)), NoiseVerdict.ok);
      expect(judge(speech(noiseFloorLimitDb + 1)), NoiseVerdict.noisy);
    });
  });
}

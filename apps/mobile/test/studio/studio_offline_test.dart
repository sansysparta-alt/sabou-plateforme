// US-080 : le Studio mobile fonctionne sans réseau.
// Critère 1 : après connexion, usage complet hors réseau (liste, listes du formulaire,
//             traitement, enregistrement, soumission) à partir de la copie chiffrée.
// Critère 2 : synchronisation au retour du réseau, règle R-DON-04 (avis au praticien), sans
//             doublon. La règle elle-même est prouvée en base (studio-hors-reseau.test.ts).
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/dossier/session.dart';
import 'package:sabou_mobile/studio/sealed_files.dart';
import 'package:sabou_mobile/studio/studio_api.dart';
import 'package:sabou_mobile/studio/studio_offline.dart';
import 'package:sabou_mobile/studio/voice_vault.dart';

import '../dossier/fakes.dart';
import 'studio_pages_test.dart' show completeFields;

void main() {
  late Directory dir;
  late FakeServer server;
  late MemorySecretStore secrets;
  late StudioStore store;
  late VoiceVault vault;
  late OfflineStudio studio;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('sabou-studio-');
    server = FakeServer();
    secrets = MemorySecretStore();
    final session = PractitionerSession(
      store: MemorySecretStore(),
      launcher: FakeLauncher(),
      client: server.client,
      issuer: issuer,
    );
    await session.signIn();
    store = StudioStore(
      SealedFiles(
        directory: dir,
        secrets: secrets,
        keyName: 'sabou.studio_store_key',
      ),
    );
    vault = VoiceVault(
      directory: Directory('${dir.path}/voix'),
      secrets: secrets,
    );
    studio = OfflineStudio(
      api: StudioApi(
        baseUrl: Uri.parse('http://api.test'),
        session: session,
        client: server.client,
      ),
      store: store,
      vault: vault,
      clock: () => DateTime.utc(2026, 11, 19, 10),
    );
  });

  tearDown(() => dir.delete(recursive: true));

  TreatmentFields fields(String title) => TreatmentFields.fromJson(
    completeFields(title: title).cast<String, dynamic>(),
  );

  group('Critère 1 : usage hors réseau à partir de la copie', () {
    test(
      'liste et listes du formulaire reçues en ligne, relues sans réseau',
      () async {
        server.seedTreatment(completeFields(title: 'Tisane du soir'));
        await studio.referentials();
        await studio.list();
        expect(studio.offlineSince, isNull);
        server.offline = true;
        final list = await studio.list();
        expect(list.map((t) => t.title), ['Tisane du soir']);
        expect(studio.offlineSince, '2026-11-19T10:00:00.000Z');
        expect((await studio.referentials()).diseases, isNotEmpty);
      },
    );

    test('la copie est chiffrée : illisible sur le disque, ignorée avec une autre clé', () async {
      server.seedTreatment(completeFields(title: 'Tisane secrète'));
      await studio.list();
      final raw = await File('${dir.path}/liste.json').readAsBytes();
      expect(String.fromCharCodes(raw), isNot(contains('Tisane')));
      final other = StudioStore(
        SealedFiles(
          directory: dir,
          secrets: MemorySecretStore(),
          keyName: 'sabou.studio_store_key',
        ),
      );
      expect(await other.list(), isNull);
    });

    test(
      'sans réseau ni copie : l’erreur de réseau remonte (rien d’inventé)',
      () async {
        server.offline = true;
        expect(studio.list, throwsA(isA<Exception>()));
      },
    );

    test('créer et soumettre sans réseau : gardé sur le téléphone, en tête de liste', () async {
      final refs = await studio.referentials();
      await studio.list();
      server.offline = true;
      final (detail, queued) = await studio.save(
        null,
        fields('Décoction hors réseau'),
        refs,
        submit: true,
      );
      expect(queued, isTrue);
      expect(isLocalCode(detail.code), isTrue);
      expect(
        detail.consentedAt,
        isNotNull,
      ); // la voix peut déjà s'enregistrer (US-081)
      final list = await studio.list();
      expect(list.first.title, 'Décoction hors réseau');
      expect(
        (await studio.detail(detail.code, refs)).title,
        'Décoction hors réseau',
      );
    });

    test('deux enregistrements hors réseau : une seule attente, date de lecture d’origine gardée', () async {
      final refs = await studio.referentials();
      final code = server.seedTreatment(completeFields(title: 'Avant'));
      final read = await studio.detail(code, refs);
      server.offline = true;
      final (first, _) = await studio.save(read, fields('Première'), refs);
      await studio.save(first, fields('Seconde'), refs);
      final pending = await store.pending();
      expect(pending, hasLength(1));
      expect(pending.single.fields.titleFr, 'Seconde');
      expect(pending.single.readAt, read.modifiedAt);
    });
  });

  group('Critère 2 : synchronisation au retour du réseau', () {
    test('le brouillon créé hors réseau part avec sa clé ; ses voix reçoivent le code', () async {
      final refs = await studio.referentials();
      server.offline = true;
      final (local, _) = await studio.save(
        null,
        fields('Créé hors réseau'),
        refs,
      );
      await vault.put(
        code: local.code,
        target: 'section',
        object: 'preparation',
        contentType: 'audio/mp4',
        audio: [1, 2, 3],
      );
      server.offline = false;
      final report = await studio.sync();
      expect(report.sent, 1);
      expect(await store.pending(), isEmpty);
      final code = server.treatments.keys.single;
      final syncs = server.requests.where(
        (r) => r.url.path.endsWith('/synchro/traitements'),
      );
      expect(syncs, hasLength(1));
      // Voix : rangée sous le code du serveur (l'envoi des voix vers le faux serveur échoue :
      // la voix attend, elle n'est pas perdue)
      expect((await vault.pending()).single.code, code);
    });

    test(
      'envoi rejoué (réponse perdue) : la même clé, aucun doublon',
      () async {
        final refs = await studio.referentials();
        server.offline = true;
        await studio.save(null, fields('Rejoué'), refs);
        final key = (await store.pending()).single.clientKey;
        server.offline = false;
        // Le serveur a reçu un premier envoi dont la réponse s'est perdue
        server.syncResults[key] = {
          'conflit': null,
          'soumissionManques': null,
          'detail':
              server.treatments[server.seedTreatment(
                completeFields(title: 'Rejoué'),
              )],
        };
        await studio.sync();
        expect(server.treatments, hasLength(1));
      },
    );

    test(
      'version du serveur soumise entre-temps : elle prime, avis au praticien',
      () async {
        final refs = await studio.referentials();
        final code = server.seedTreatment(
          completeFields(title: 'Sur le serveur'),
        );
        final read = await studio.detail(code, refs);
        server.offline = true;
        await studio.save(read, fields('Sur le téléphone'), refs);
        server.treatments[code] = {
          ...server.treatments[code]!,
          'statut': 'soumise',
        };
        server.offline = false;
        final report = await studio.sync();
        expect(
          report.notices.single,
          contains('version du serveur est gardée'),
        );
        expect(server.treatments[code]!['titreFr'], 'Sur le serveur');
        expect(await studio.takeNotices(), report.notices);
        expect(await studio.takeNotices(), isEmpty);
      },
    );

    test(
      'deux brouillons : le dernier arrivé l’emporte, avis au praticien',
      () async {
        final refs = await studio.referentials();
        final code = server.seedTreatment(completeFields(title: 'Ailleurs'));
        final read = await studio.detail(code, refs);
        server.offline = true;
        await studio.save(read, fields('Téléphone'), refs);
        server.treatments[code] = {
          ...server.treatments[code]!,
          'modifieLe': 'plus récent',
        };
        server.offline = false;
        final report = await studio.sync();
        expect(
          report.notices.single,
          contains('votre version, arrivée la dernière, est retenue'),
        );
        expect(server.treatments[code]!['titreFr'], 'Téléphone');
      },
    );

    test('soumission demandée hors réseau mais incomplète : enregistré, ce qui manque est dit', () async {
      final refs = await studio.referentials();
      server.offline = true;
      final incomplete = TreatmentFields.fromJson({
        ...completeFields(title: 'Incomplet').cast<String, dynamic>(),
        'sections': <Object?>[],
      });
      await studio.save(null, incomplete, refs, submit: true);
      server.offline = false;
      final report = await studio.sync();
      expect(report.notices.single, contains('enregistré mais pas soumis'));
    });

    test(
      'toujours sans réseau : rien n’est perdu, la tournée s’arrête',
      () async {
        final refs = await studio.referentials();
        server.offline = true;
        await studio.save(null, fields('Patience'), refs);
        final report = await studio.sync();
        expect((report.sent, report.left), (0, 1));
        expect(await store.pending(), hasLength(1));
      },
    );

    test('session expirée pendant la tournée : la déconnexion remonte, l’attente reste', () async {
      final refs = await studio.referentials();
      server.offline = true;
      await studio.save(null, fields('Session'), refs);
      server.offline = false;
      server.validAccess.clear();
      server.keycloakRejectsRefresh = true;
      await expectLater(studio.sync(), throwsA(isA<SignedOutException>()));
      expect(await store.pending(), hasLength(1));
    });
  });
}

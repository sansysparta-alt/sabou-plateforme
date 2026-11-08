// US-040b, critère 1 (côté application) et décisions du maître d'œuvre : connexion par la
// page de Keycloak, session gardée dans le magasin sécurisé, rafraîchie, révoquée.
import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/dossier/session.dart';

import 'fakes.dart';

void main() {
  late FakeServer server;
  late MemorySecretStore store;
  late FakeLauncher launcher;
  late DateTime now;
  late PractitionerSession session;

  setUp(() {
    server = FakeServer();
    store = MemorySecretStore();
    launcher = FakeLauncher();
    now = DateTime.now();
    session = PractitionerSession(
      store: store,
      launcher: launcher,
      client: server.client,
      now: () => now,
      issuer: issuer,
    );
  });

  String? kept() => store.values['sabou.praticien.refresh_token'];

  test('la connexion garde le seul jeton de rafraîchissement dans le magasin sécurisé', () async {
    expect(await session.hasSession(), isFalse);
    expect(await session.signIn(), isTrue);
    expect(kept(), 'rafraichissement-1');
    expect(store.values.values, isNot(contains('acces-1')));
    expect(await session.hasSession(), isTrue);
    expect(await session.accessToken(), 'acces-1');
    expect(server.refreshCount, 0);
  });

  test(
    'page de connexion fermée sans se connecter : rien n’est gardé',
    () async {
      launcher.next = null;
      expect(await session.signIn(), isFalse);
      expect(await session.hasSession(), isFalse);
    },
  );

  test('jeton d’accès bientôt expiré : rafraîchi, et le nouveau jeton de rafraîchissement gardé', () async {
    await session.signIn();
    now = now.add(const Duration(minutes: 5));
    expect(await session.accessToken(), 'acces-2');
    expect(kept(), 'rafraichissement-2');
    final body = server.requests.last.bodyFields;
    expect(body, {
      'grant_type': 'refresh_token',
      'client_id': 'sabou-mobile',
      'refresh_token': 'rafraichissement-1',
    });
  });

  test(
    'l’application rouverte reprend la session gardée sur le téléphone',
    () async {
      store.values['sabou.praticien.refresh_token'] = 'rafraichissement-1';
      expect(await session.accessToken(), 'acces-2');
      expect(launcher.calls, 0);
    },
  );

  test(
    'des demandes simultanées ne déclenchent qu’un seul rafraîchissement',
    () async {
      store.values['sabou.praticien.refresh_token'] = 'rafraichissement-1';
      final tokens = await Future.wait([
        session.accessToken(),
        session.accessToken(),
        session.accessToken(),
      ]);
      expect(tokens.toSet(), {'acces-2'});
      expect(server.refreshCount, 1);
    },
  );

  test('session expirée (30 jours) ou révoquée : jeton effacé, reconnexion demandée', () async {
    store.values['sabou.praticien.refresh_token'] = 'rafraichissement-1';
    server.keycloakRejectsRefresh = true;
    await expectLater(
      session.accessToken(),
      throwsA(isA<SignedOutException>()),
    );
    expect(await session.hasSession(), isFalse);
  });

  test(
    'coupure réseau pendant le rafraîchissement : la session est gardée',
    () async {
      store.values['sabou.praticien.refresh_token'] = 'rafraichissement-1';
      server.offline = true;
      await expectLater(
        session.accessToken(),
        throwsA(isNot(isA<SignedOutException>())),
      );
      expect(await session.hasSession(), isTrue);
    },
  );

  test(
    'se déconnecter révoque le jeton auprès de Keycloak puis l’efface',
    () async {
      await session.signIn();
      await session.signOut();
      final revoke = server.requests.last;
      expect(revoke.url.toString(), '$oidc/revoke');
      expect(revoke.bodyFields, {
        'client_id': 'sabou-mobile',
        'token': 'rafraichissement-1',
        'token_type_hint': 'refresh_token',
      });
      expect(await session.hasSession(), isFalse);
      await expectLater(
        session.accessToken(),
        throwsA(isA<SignedOutException>()),
      );
    },
  );

  test(
    'se déconnecter hors réseau efface quand même le jeton du téléphone',
    () async {
      await session.signIn();
      server.offline = true;
      await session.signOut();
      expect(await session.hasSession(), isFalse);
    },
  );
}

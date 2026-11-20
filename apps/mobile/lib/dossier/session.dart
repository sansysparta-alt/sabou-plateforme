// Connexion du praticien (US-040b, §2.29, décisions du maître d'œuvre du 8 novembre 2026) :
// - page de connexion de Keycloak ouverte dans le navigateur du téléphone (code + PKCE,
//   RFC 8252) : le mot de passe n'est jamais saisi dans l'application ;
// - jeton de rafraîchissement hors ligne (30 jours d'inactivité) gardé dans le magasin
//   sécurisé du téléphone (Keystore) ; le jeton d'accès (5 minutes) reste en mémoire ;
// - « Se déconnecter » révoque le jeton auprès de Keycloak puis l'efface du téléphone.
// Agent préfectoral (US-082, §2.86) : même mécanisme dans le domaine interne « sabou »,
// client « sabou-terrain », second facteur exigé par l'API, session hors ligne de 7 jours.
// Le domaine choisi à la connexion est gardé avec la session : le rafraîchissement et la
// révocation s'adressent au bon client.
// Rôles du compte (US-018) : lus dans le jeton d'accès et gardés sur le téléphone, pour
// ouvrir les rubriques du bon profil même sans réseau. Ils ne servent qu'à l'affichage :
// l'API vérifie elle-même le jeton et le rôle à chaque demande.
import 'dart:async';
import 'dart:convert';

import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:http/http.dart' as http;

import '../sync/database_key.dart' show SecretStore;
import 'config.dart';

/// Jetons reçus de Keycloak.
class Tokens {
  const Tokens({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime expiresAt;
}

/// La session n'existe pas ou n'est plus valable : il faut se reconnecter.
class SignedOutException implements Exception {
  const SignedOutException();
}

/// Domaine de connexion : praticien (domaine public) ou agent préfectoral (domaine interne).
enum SignInRealm {
  practitioner(mobileClientId),
  fieldAgent(fieldClientId);

  const SignInRealm(this.clientId);

  /// Client Keycloak de l'application dans ce domaine.
  final String clientId;
}

/// Ouverture de la page de connexion ; remplaçable dans les tests.
abstract interface class LoginLauncher {
  /// Jetons, ou null si la page a été fermée sans se connecter. [loginHint] : numéro déjà
  /// rempli sur la page (après l'inscription, US-066).
  Future<Tokens?> login({
    String? loginHint,
    SignInRealm realm = SignInRealm.practitioner,
  });
}

/// Page de connexion de Keycloak dans un onglet du navigateur (Custom Tabs), par AppAuth.
class AppAuthLoginLauncher implements LoginLauncher {
  AppAuthLoginLauncher([FlutterAppAuth? appAuth])
    : _appAuth = appAuth ?? const FlutterAppAuth();

  final FlutterAppAuth _appAuth;

  @override
  Future<Tokens?> login({
    String? loginHint,
    SignInRealm realm = SignInRealm.practitioner,
  }) async {
    final issuer = realm == SignInRealm.fieldAgent
        ? internalIssuer
        : publicIssuer;
    try {
      final response = await _appAuth.authorizeAndExchangeCode(
        AuthorizationTokenRequest(
          realm.clientId,
          mobileRedirectUri,
          issuer: issuer,
          scopes: const ['openid', 'offline_access'],
          promptValues: const ['login'],
          loginHint: loginHint,
          // HTTP seulement vers le poste de développement (adb reverse)
          allowInsecureConnections: issuer.startsWith('http://localhost'),
        ),
      );
      final access = response.accessToken;
      final refresh = response.refreshToken;
      if (access == null || refresh == null) return null;
      return Tokens(
        accessToken: access,
        refreshToken: refresh,
        expiresAt:
            response.accessTokenExpirationDateTime ??
            DateTime.now().add(const Duration(minutes: 5)),
      );
    } on FlutterAppAuthUserCancelledException {
      return null;
    }
  }
}

const _refreshTokenName = 'sabou.praticien.refresh_token';
const _rolesName = 'sabou.session.roles';
const _realmName = 'sabou.session.domaine';

/// Rôles du domaine Keycloak portés par un jeton d'accès (claim `roles`), sans vérifier sa
/// signature : c'est le rôle de l'API. Ensemble vide si le jeton est illisible.
Set<String> rolesFromAccessToken(String accessToken) {
  final parts = accessToken.split('.');
  if (parts.length != 3) return const {};
  try {
    final payload = jsonDecode(
      utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
    );
    final roles = payload is Map<String, dynamic> ? payload['roles'] : null;
    return roles is List ? roles.whereType<String>().toSet() : const {};
  } on FormatException {
    return const {};
  }
}

/// Session du praticien : fournit un jeton d'accès valable, rafraîchi au besoin.
class PractitionerSession {
  PractitionerSession({
    required this._store,
    required this._launcher,
    http.Client? client,
    DateTime Function()? now,
    String issuer = publicIssuer,
    String fieldIssuer = internalIssuer,
  }) : _client = client ?? http.Client(),
       _now = now ?? DateTime.now,
       _issuers = {
         SignInRealm.practitioner: issuer,
         SignInRealm.fieldAgent: fieldIssuer,
       };

  final SecretStore _store;
  final LoginLauncher _launcher;
  final http.Client _client;
  final DateTime Function() _now;
  final Map<SignInRealm, String> _issuers;

  Tokens? _tokens;
  SignInRealm? _realm;

  /// Domaine de la session gardée (praticien par défaut : sessions ouvertes avant US-082).
  Future<SignInRealm> realm() async =>
      _realm ??= await _store.read(_realmName) == SignInRealm.fieldAgent.name
      ? SignInRealm.fieldAgent
      : SignInRealm.practitioner;

  Future<String> _oidc() async {
    final issuer = _issuers[await realm()]!;
    return '${issuer.replaceAll(RegExp(r'/$'), '')}/protocol/openid-connect';
  }

  Future<Tokens>? _refreshing;

  /// Vrai si un jeton de rafraîchissement est gardé sur le téléphone.
  Future<bool> hasSession() async {
    final stored = await _store.read(_refreshTokenName);
    return stored != null && stored.isNotEmpty;
  }

  /// Ouvre la page de connexion du domaine [realm]. Faux si elle a été fermée sans se
  /// connecter.
  Future<bool> signIn({
    String? loginHint,
    SignInRealm realm = SignInRealm.practitioner,
  }) async {
    final tokens = await _launcher.login(loginHint: loginHint, realm: realm);
    if (tokens == null) return false;
    _realm = realm;
    await _store.write(_realmName, realm.name);
    await _keep(tokens);
    return true;
  }

  /// Jeton d'accès valable au moins 30 secondes encore ; [force] : rafraîchi même s'il
  /// semble valable (l'API l'a refusé).
  Future<String> accessToken({bool force = false}) async {
    final current = _tokens;
    if (!force &&
        current != null &&
        current.expiresAt.isAfter(_now().add(const Duration(seconds: 30)))) {
      return current.accessToken;
    }
    // Un seul rafraîchissement à la fois : Keycloak fait tourner le jeton de
    // rafraîchissement, deux demandes simultanées se gêneraient
    _refreshing ??= _refresh().whenComplete(() => _refreshing = null);
    return (await _refreshing!).accessToken;
  }

  /// Rôles du compte connecté : ceux gardés sur le téléphone, sinon ceux du jeton d'accès
  /// (session ouverte avant US-018). Lève [SignedOutException] si la session n'est plus
  /// valable, une exception réseau si les rôles ne sont pas connus et le réseau manque.
  Future<Set<String>> roles() async {
    final stored = await _store.read(_rolesName);
    if (stored != null && stored.isNotEmpty) return stored.split(' ').toSet();
    return rolesFromAccessToken(await accessToken());
  }

  Future<Tokens> _refresh() async {
    final refreshToken =
        _tokens?.refreshToken ?? await _store.read(_refreshTokenName);
    if (refreshToken == null || refreshToken.isEmpty) {
      throw const SignedOutException();
    }
    final response = await _client
        .post(
          Uri.parse('${await _oidc()}/token'),
          body: {
            'grant_type': 'refresh_token',
            'client_id': (await realm()).clientId,
            'refresh_token': refreshToken,
          },
        )
        .timeout(const Duration(seconds: 30));
    // 400 / 401 : session expirée (30 jours sans ouvrir l'application, 7 jours pour l'agent),
    // révoquée ou compte
    // suspendu. Le jeton gardé ne servira plus : il est effacé.
    if (response.statusCode == 400 || response.statusCode == 401) {
      await _forget();
      throw const SignedOutException();
    }
    if (response.statusCode != 200) {
      throw http.ClientException('Keycloak : statut ${response.statusCode}');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final tokens = Tokens(
      accessToken: body['access_token'] as String,
      refreshToken: (body['refresh_token'] as String?) ?? refreshToken,
      expiresAt: _now().add(
        Duration(seconds: (body['expires_in'] as num).toInt()),
      ),
    );
    await _keep(tokens);
    return tokens;
  }

  /// Révoque la session hors ligne auprès de Keycloak puis l'efface du téléphone, même si
  /// le réseau manque (le jeton effacé ne peut plus servir depuis ce téléphone).
  Future<void> signOut() async {
    final refreshToken =
        _tokens?.refreshToken ?? await _store.read(_refreshTokenName);
    final oidc = await _oidc();
    final clientId = (await realm()).clientId;
    await _forget();
    if (refreshToken == null || refreshToken.isEmpty) return;
    try {
      await _client
          .post(
            Uri.parse('$oidc/revoke'),
            body: {
              'client_id': clientId,
              'token': refreshToken,
              'token_type_hint': 'refresh_token',
            },
          )
          .timeout(const Duration(seconds: 15));
    } on Exception {
      // Hors réseau : la session expirera d'elle-même (30 jours d'inactivité, 7 jours pour
      // l'agent)
    }
  }

  Future<void> _keep(Tokens tokens) async {
    _tokens = tokens;
    await _store.write(_refreshTokenName, tokens.refreshToken);
    await _store.write(
      _rolesName,
      (rolesFromAccessToken(tokens.accessToken).toList()..sort()).join(' '),
    );
  }

  Future<void> _forget() async {
    _tokens = null;
    _realm = null;
    await _store.write(_refreshTokenName, '');
    await _store.write(_rolesName, '');
    await _store.write(_realmName, '');
  }
}

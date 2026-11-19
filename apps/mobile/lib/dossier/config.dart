// Adresses du serveur pour le dossier du praticien (US-040b). Valeurs par défaut : poste de
// développement relié par `adb reverse` (localhost du téléphone = poste). La version publiée
// les reçoit à la compilation (--dart-define), en HTTPS.
const String practitionerApiUrl = String.fromEnvironment(
  'SABOU_API_URL',
  defaultValue: 'http://localhost:4000',
);

/// Domaine Keycloak des citoyens et praticiens (lot D, §2.25).
const String publicIssuer = String.fromEnvironment(
  'SABOU_PUBLIC_ISSUER',
  defaultValue: 'http://localhost:8080/realms/sabou-public',
);

/// Site public, vers lequel est renvoyé un compte citoyen (l'inscription du praticien se fait
/// dans l'application depuis US-066).
const String publicSiteUrl = String.fromEnvironment(
  'SABOU_SITE_URL',
  defaultValue: 'http://localhost:3000',
);

/// Client public de l'application (client Keycloak « sabou-mobile », §2.29).
const String mobileClientId = 'sabou-mobile';

/// Domaine Keycloak interne (lot D, §2.25) : l'agent préfectoral s'y connecte avec son second
/// facteur (US-082, §2.86).
const String internalIssuer = String.fromEnvironment(
  'SABOU_INTERNAL_ISSUER',
  defaultValue: 'http://localhost:8080/realms/sabou',
);

/// Client public de l'agent préfectoral dans l'application (client Keycloak « sabou-terrain »,
/// session hors ligne de 7 jours, §2.86).
const String fieldClientId = 'sabou-terrain';

/// Retour de la page de connexion vers l'application (schéma privé, RFC 8252).
const String mobileRedirectUri = 'gn.sabou.mobile:/oauth2redirect';

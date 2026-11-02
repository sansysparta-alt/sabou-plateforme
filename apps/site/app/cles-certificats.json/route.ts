// Clés publiques de la DG, publiées sur le site (R-QR-03) au format JWKS (RFC 7517).
// Prototype US-006 : lues dans SABOU_QR_PUBLIC_KEYS (tableau JSON de JWK Ed25519),
// clés de test uniquement. Plus tard : table `cle_signature`, via l'API.
import { parsePublicKeys } from '@sabou/qr';

// Lu à chaque requête : la liste change avec la rotation et la révocation des clés
export const dynamic = 'force-dynamic';

export function GET(): Response {
  let configured: unknown = [];
  try {
    configured = JSON.parse(process.env.SABOU_QR_PUBLIC_KEYS ?? '[]');
  } catch {
    console.error('SABOU_QR_PUBLIC_KEYS : JSON illisible, aucune clé publiée');
  }
  return Response.json(
    { keys: parsePublicKeys(configured) },
    // Le service worker garde la dernière copie pour la vérification hors ligne
    { headers: { 'Cache-Control': 'no-cache' } },
  );
}

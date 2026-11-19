// Liens vers la connexion du citoyen (lot D : US-014). La connexion passe par l'API, qui
// redirige vers la page de Keycloak : ce sont des liens de navigation complète, pas des
// liens internes de Next.js.

// Connexion par Keycloak, puis retour sur « Mon compte » (ou la page indiquée) ; numéro
// pré-rempli si connu
export function loginHref(phone?: string, returnTo = '/compte'): string {
  const query = new URLSearchParams({ returnTo });
  if (phone) query.set('identifiant', phone);
  return `/auth/citoyen/login?${query.toString()}`;
}

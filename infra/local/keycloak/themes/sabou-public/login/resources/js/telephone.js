// Connexion par numéro de téléphone (lot D : US-014). L'identifiant Keycloak est la forme
// nationale du numéro (9 chiffres) : espaces, points, tirets et indicatif +224 sont retirés
// avant l'envoi, comme le fait le site à l'inscription (@sabou/types/phone).
// Sans JavaScript, la saisie des 9 chiffres seuls fonctionne (aide affichée sous le champ).
document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('kc-form-login');
  var field = document.getElementById('username');
  if (!form || !field) return;
  form.addEventListener('submit', function () {
    var compact = field.value.trim().replace(/[\s.\-()]/g, '');
    var national = compact.replace(/^(?:\+224|00224|224(?=\d{9}$))/, '');
    if (/^6\d{8}$/.test(national)) field.value = national;
  });
});

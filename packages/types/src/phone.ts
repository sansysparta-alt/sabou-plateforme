// Numéros de mobile guinéens (lot D : US-014). Sans dépendance : le site public importe ce
// module seul (« @sabou/types/phone ») pour ne pas envoyer zod au téléphone.

// Indicatif de la Guinée et forme nationale d'un mobile : 9 chiffres commençant par 6
export const GUINEA_PREFIX = '+224';
const NATIONAL_MOBILE = /^6\d{8}$/;

// Forme nationale (9 chiffres) d'un numéro saisi librement : espaces, points, tirets et
// indicatif (+224, 00224 ou 224) acceptés. Renvoie null si ce n'est pas un mobile guinéen.
export function toNationalMobile(input: string): string | null {
  const compact = input.trim().replace(/[\s.\-()]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;
  const digits = compact.replace(/^(?:\+224|00224|224(?=\d{9}$))/, '');
  return NATIONAL_MOBILE.test(digits) ? digits : null;
}

// Forme internationale, celle de la base et des envois de SMS (+2246XXXXXXXX)
export function toInternational(national: string): string {
  return `${GUINEA_PREFIX}${national}`;
}

// Affichage lisible : « 621 23 45 67 »
export function formatNationalMobile(national: string): string {
  return national.replace(/^(\d{3})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4');
}

// Règles du mot de passe d'un citoyen (décision du maître d'œuvre : 8 caractères au moins,
// chiffres seuls acceptés). En plus, refus des suites devinées en premier : son propre
// numéro, un seul chiffre répété, une suite croissante ou décroissante. Renvoie le motif
// du refus, ou null si le mot de passe est accepté.
export const CITIZEN_PASSWORD_MIN = 8;
export const CITIZEN_PASSWORD_MAX = 128;

export function citizenPasswordError(password: string, nationalPhone: string): string | null {
  if (password.length < CITIZEN_PASSWORD_MIN) {
    return `Le mot de passe doit compter au moins ${CITIZEN_PASSWORD_MIN} caractères.`;
  }
  if (password.length > CITIZEN_PASSWORD_MAX) {
    return `Le mot de passe doit compter au plus ${CITIZEN_PASSWORD_MAX} caractères.`;
  }
  if (password.includes(nationalPhone) || nationalPhone.includes(password)) {
    return 'Le mot de passe ne doit pas reprendre votre numéro de téléphone.';
  }
  if (/^(.)\1*$/.test(password) || isRun(password)) {
    return 'Ce mot de passe est trop facile à deviner.';
  }
  return null;
}

// 12345678, 98765432… : chaque chiffre suit (ou précède) le précédent
function isRun(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  const step = (Number(value[1]) - Number(value[0]) + 10) % 10;
  if (step !== 1 && step !== 9) return false;
  for (let i = 1; i < value.length; i += 1) {
    if ((Number(value[i]) - Number(value[i - 1]) + 10) % 10 !== step) return false;
  }
  return true;
}

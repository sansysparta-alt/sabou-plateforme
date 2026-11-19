// Règles de saisie de l'inscription, reprises de @sabou/types (phone.ts, citizens.ts) pour
// dire l'erreur sous le champ avant tout envoi. L'API reste seule juge : elle refait les
// mêmes contrôles et son refus est affiché au même endroit.

/// Forme nationale (9 chiffres commençant par 6) d'un numéro saisi librement : espaces,
/// points, tirets, parenthèses et indicatif (+224, 00224 ou 224) acceptés ; null sinon.
String? toNationalMobile(String input) {
  final compact = input.trim().replaceAll(RegExp(r'[\s.\-()]'), '');
  if (!RegExp(r'^\+?\d+$').hasMatch(compact)) return null;
  final digits = compact.replaceFirst(
    RegExp(r'^(?:\+224|00224|224(?=\d{9}$))'),
    '',
  );
  return RegExp(r'^6\d{8}$').hasMatch(digits) ? digits : null;
}

const int passwordMin = 8;
const int passwordMax = 128;
const int firstNameMax = 50;
const int lastNameMax = 80;

/// Défaut d'un mot de passe (règles de US-014), ou null s'il convient.
enum PasswordIssue { tooShort, tooLong, containsPhone, tooEasy }

PasswordIssue? passwordIssue(String password, String nationalPhone) {
  if (password.length < passwordMin) return PasswordIssue.tooShort;
  if (password.length > passwordMax) return PasswordIssue.tooLong;
  if (password.contains(nationalPhone) || nationalPhone.contains(password)) {
    return PasswordIssue.containsPhone;
  }
  if (RegExp(r'^(.)\1*$').hasMatch(password) || _isRun(password)) {
    return PasswordIssue.tooEasy;
  }
  return null;
}

// 12345678, 98765432… : chaque chiffre suit (ou précède) le précédent
bool _isRun(String value) {
  if (!RegExp(r'^\d+$').hasMatch(value)) return false;
  int digit(int i) => value.codeUnitAt(i) - 48;
  final step = (digit(1) - digit(0) + 10) % 10;
  if (step != 1 && step != 9) return false;
  for (var i = 1; i < value.length; i++) {
    if ((digit(i) - digit(i - 1) + 10) % 10 != step) return false;
  }
  return true;
}

/// Défaut d'un prénom ou d'un nom, ou null s'il convient.
enum NameIssue { empty, tooLong, notLetters }

NameIssue? nameIssue(String value, int max) {
  final name = value.trim();
  if (name.isEmpty) return NameIssue.empty;
  if (name.length > max) return NameIssue.tooLong;
  if (!RegExp(r"^\p{L}[\p{L}\p{M}' -]*$", unicode: true).hasMatch(name)) {
    return NameIssue.notLetters;
  }
  return null;
}

/// Le code reçu par SMS compte 6 chiffres.
bool isSmsCode(String value) => RegExp(r'^\d{6}$').hasMatch(value.trim());

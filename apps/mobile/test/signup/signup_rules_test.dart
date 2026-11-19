// US-066, critère 1 : mêmes règles que le site (cas repris de packages/types/src/citizens.test.ts).
import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/signup/signup_rules.dart';

void main() {
  test('numéro saisi librement, ramené aux 9 chiffres nationaux', () {
    for (final input in [
      '621234567',
      '621 23 45 67',
      '+224 621 23 45 67',
      '00224621234567',
      '224621234567',
      '621-23-45-67',
      '(621) 23.45.67',
    ]) {
      expect(toNationalMobile(input), '621234567', reason: input);
    }
    for (final input in [
      '',
      '721234567',
      '62123456',
      '6212345678',
      '+33612345678',
      '62a234567',
    ]) {
      expect(toNationalMobile(input), isNull, reason: input);
    }
  });

  test('mot de passe : 8 caractères au moins, ni le numéro, ni répétition, ni suite', () {
    expect(passwordIssue('40718293', '621234567'), isNull);
    expect(passwordIssue('4071829', '621234567'), PasswordIssue.tooShort);
    expect(passwordIssue('x' * 129, '621234567'), PasswordIssue.tooLong);
    expect(
      passwordIssue('a621234567', '621234567'),
      PasswordIssue.containsPhone,
    );
    expect(passwordIssue('62123456', '621234567'), PasswordIssue.containsPhone);
    expect(passwordIssue('aaaaaaaa', '621234567'), PasswordIssue.tooEasy);
    expect(passwordIssue('12345678', '621234567'), PasswordIssue.tooEasy);
    expect(passwordIssue('98765432', '621234567'), PasswordIssue.tooEasy);
    expect(passwordIssue('89012345', '621234567'), PasswordIssue.tooEasy);
  });

  test('prénom et nom : lettres, apostrophe, espace et tiret', () {
    for (final name in [
      'Mariama',
      'N’Faly'.replaceAll('’', "'"),
      'Élisabeth',
      'Abdoul Karim',
      'Sow-Diallo',
    ]) {
      expect(nameIssue(name, firstNameMax), isNull, reason: name);
    }
    expect(nameIssue('  ', firstNameMax), NameIssue.empty);
    expect(nameIssue('x' * 51, firstNameMax), NameIssue.tooLong);
    for (final name in ['Ali2', '<b>Ali</b>', "'Ali", '-Ali']) {
      expect(nameIssue(name, firstNameMax), NameIssue.notLetters, reason: name);
    }
  });

  test('code reçu par SMS : 6 chiffres', () {
    expect(isSmsCode('012345'), isTrue);
    expect(isSmsCode('12345'), isFalse);
    expect(isSmsCode('12a456'), isFalse);
  });
}

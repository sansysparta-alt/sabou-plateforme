// Textes de l'inscription (US-066) et du mot de passe oublié (US-069), en français et en
// anglais. Les langues nationales sont en
// voix seulement : aucun texte en soussou, malinké, pular ou guerzé.
import 'package:flutter/widgets.dart';

import 'signup_rules.dart';

class SignupTexts {
  const SignupTexts._(this._en);

  /// Anglais si la langue du téléphone est l'anglais, français sinon.
  factory SignupTexts.of(BuildContext context) =>
      SignupTexts._(Localizations.maybeLocaleOf(context)?.languageCode == 'en');

  final bool _en;

  String _t(String fr, String en) => _en ? en : fr;

  String get title =>
      _t('Créer un compte praticien', 'Create a practitioner account');
  String step(int n) => _t('Étape $n sur 3', 'Step $n of 3');

  // Étape 1 : le numéro
  String get phoneIntro => _t(
    'Saisissez votre numéro de mobile. Vous recevrez un code par SMS.',
    'Enter your mobile number. You will receive a code by text message.',
  );
  String get phoneLabel => _t('Numéro de mobile', 'Mobile number');
  String get phoneHint => _t('Exemple : 621 23 45 67', 'Example: 621 23 45 67');
  String get phoneInvalid => _t(
    'Saisissez un numéro de mobile guinéen : 9 chiffres commençant par 6.',
    'Enter a Guinean mobile number: 9 digits starting with 6.',
  );
  String get sendCode => _t('Recevoir le code', 'Get the code');

  // Étape 2 : le code
  String codeSentTo(String phone) => _t(
    'Code envoyé par SMS au $phone.',
    'Code sent by text message to $phone.',
  );
  String get codeLabel =>
      _t('Code reçu par SMS', 'Code received by text message');
  String get codeInvalidFormat =>
      _t('Le code reçu par SMS compte 6 chiffres.', 'The code has 6 digits.');
  String codeWrong(int? remaining) => remaining == null
      ? _t('Code incorrect.', 'Incorrect code.')
      : _t(
          'Code incorrect. Essais restants : $remaining.',
          'Incorrect code. Attempts left: $remaining.',
        );
  String get codeExpired => _t(
    'Ce code a expiré ou a été trop souvent mal saisi. Demandez un nouveau code.',
    'This code has expired or was entered wrongly too many times. Ask for a new code.',
  );
  String get verify => _t('Vérifier le code', 'Check the code');
  String get resend => _t('Renvoyer un code', 'Send a new code');
  String get codeResent =>
      _t('Un nouveau code a été envoyé.', 'A new code has been sent.');
  String get changeNumber => _t('Changer de numéro', 'Change number');

  // Étape 3 : identité et mot de passe
  String get identityIntro => _t(
    'Votre prénom et votre nom figureront sur votre certificat.',
    'Your first name and last name will appear on your certificate.',
  );
  String get firstNameLabel => _t('Prénom', 'First name');
  String get lastNameLabel => _t('Nom', 'Last name');
  String get passwordLabel => _t('Mot de passe', 'Password');
  String get passwordHelp => _t(
    '8 caractères au moins. Ni votre numéro, ni une suite comme 12345678.',
    'At least 8 characters. Not your number, nor a sequence like 12345678.',
  );
  String get showPassword => _t('Afficher le mot de passe', 'Show password');
  String get hidePassword => _t('Masquer le mot de passe', 'Hide password');
  String get createAccount => _t('Créer mon compte', 'Create my account');

  String nameError(NameIssue issue, {required bool first}) => switch (issue) {
    NameIssue.empty =>
      first
          ? _t('Indiquez votre prénom.', 'Enter your first name.')
          : _t('Indiquez votre nom.', 'Enter your last name.'),
    NameIssue.tooLong =>
      first
          ? _t(
              'Le prénom compte au plus $firstNameMax caractères.',
              'The first name has at most $firstNameMax characters.',
            )
          : _t(
              'Le nom compte au plus $lastNameMax caractères.',
              'The last name has at most $lastNameMax characters.',
            ),
    NameIssue.notLetters =>
      first
          ? _t(
              'Le prénom ne contient que des lettres.',
              'The first name may only contain letters.',
            )
          : _t(
              'Le nom ne contient que des lettres.',
              'The last name may only contain letters.',
            ),
  };

  String passwordError(PasswordIssue issue) => switch (issue) {
    PasswordIssue.tooShort => _t(
      'Le mot de passe doit compter au moins $passwordMin caractères.',
      'The password must have at least $passwordMin characters.',
    ),
    PasswordIssue.tooLong => _t(
      'Le mot de passe doit compter au plus $passwordMax caractères.',
      'The password must have at most $passwordMax characters.',
    ),
    PasswordIssue.containsPhone => _t(
      'Le mot de passe ne doit pas reprendre votre numéro de téléphone.',
      'The password must not contain your phone number.',
    ),
    PasswordIssue.tooEasy => _t(
      'Ce mot de passe est trop facile à deviner.',
      'This password is too easy to guess.',
    ),
  };

  // Fin et refus généraux
  String get existing => _t(
    'Ce numéro a déjà un compte. Connectez-vous avec votre mot de passe.',
    'This number already has an account. Sign in with your password.',
  );
  String get signIn => _t('Se connecter', 'Sign in');
  String get created => _t(
    'Votre compte est créé. Connectez-vous pour ouvrir votre dossier de certification.',
    'Your account has been created. Sign in to open your certification file.',
  );
  String get ticketExpired => _t(
    'Cette inscription a expiré. Recommencez avec votre numéro.',
    'This sign-up has expired. Start again with your number.',
  );
  String tooMany(int? seconds) {
    final minutes = seconds == null ? null : (seconds / 60).ceil();
    return minutes == null
        ? _t(
            'Trop de demandes. Réessayez plus tard.',
            'Too many requests. Try again later.',
          )
        : _t(
            'Trop de demandes. Réessayez dans $minutes min.',
            'Too many requests. Try again in $minutes min.',
          );
  }

  String get offline => _t(
    'Pas de réseau : votre saisie est gardée. Réessayez quand le réseau revient.',
    'No network: what you entered is kept. Try again when the network is back.',
  );
  String get failed => _t(
    'L’inscription n’a pas abouti. Réessayez.',
    'Sign-up did not go through. Try again.',
  );
  String get busy => _t('Envoi en cours…', 'Sending…');

  // Mot de passe oublié (US-069)
  String get forgotPassword => _t('Mot de passe oublié ?', 'Forgot password?');
  String get resetTitle => _t('Mot de passe oublié', 'Forgot password');
  String get resetPhoneIntro => _t(
    'Saisissez le numéro de votre compte. S’il a un compte SABOU, vous recevrez un code par SMS.',
    'Enter your account number. If it has a SABOU account, you will receive a code by text message.',
  );
  String resetCodeSentTo(String phone) => _t(
    'Si le $phone a un compte SABOU, un code vient de lui être envoyé par SMS.',
    'If $phone has a SABOU account, a code has just been sent to it by text message.',
  );
  String get newPasswordLabel => _t('Nouveau mot de passe', 'New password');
  String get changePassword => _t('Changer le mot de passe', 'Change password');
  String get resetDone => _t(
    'Votre mot de passe est changé et vous êtes déconnecté de tous vos appareils. '
        'Connectez-vous avec le nouveau ; si vous avez activé la double vérification, elle '
        'vous sera demandée.',
    'Your password has been changed and you have been signed out of all your devices. '
        'Sign in with the new one; if you turned on two-step verification, it will be asked.',
  );
  String get resetExpired => _t(
    'Cette demande a expiré. Recommencez avec votre numéro.',
    'This request has expired. Start again with your number.',
  );
}

// Inscription du praticien dans l'application (US-066, UC-20, §6.6) : numéro, code reçu par
// SMS, prénom, nom et mot de passe. Mêmes règles et même API que le site (US-014, US-040a).
// Chaque erreur est dite sous le champ concerné ; sans réseau, l'écran le dit et la saisie
// reste dans les champs. Le compte créé, la page de connexion de Keycloak s'ouvre avec le
// numéro déjà rempli (le jeton n'est délivré que par Keycloak, US-040b).
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'signup_api.dart';
import 'signup_rules.dart';
import 'signup_texts.dart';

/// Connexion après l'inscription, le numéro (forme nationale) en indice de connexion.
/// Vrai si le praticien est connecté.
typedef SignInAfterSignup = Future<bool> Function(String nationalPhone);

enum _Step { phone, code, identity, existing, created }

class SignupPage extends StatefulWidget {
  const SignupPage({super.key, required this.api, required this.signIn});

  final SignupApi api;
  final SignInAfterSignup signIn;

  @override
  State<SignupPage> createState() => _SignupPageState();
}

class _SignupPageState extends State<SignupPage> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _firstName = TextEditingController();
  final _lastName = TextEditingController();
  final _password = TextEditingController();

  _Step _step = _Step.phone;
  String _national = '';
  String? _ticket;
  bool _busy = false;
  bool _showPassword = false;

  // Erreurs sous les champs, message général (en tête d'étape)
  final Map<String, String> _fieldErrors = {};
  String? _message;
  StatusKind _messageKind = StatusKind.error;

  @override
  void dispose() {
    for (final c in [_phone, _code, _firstName, _lastName, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  SignupTexts get _t => SignupTexts.of(context);

  void _clear() {
    _fieldErrors.clear();
    _message = null;
  }

  // Appel à l'API avec indicateur d'envoi et refus généraux ; null si l'appel a échoué
  Future<T?> _call<T>(
    Future<T> Function() work, {
    required void Function(SignupException) onRefused,
  }) async {
    setState(() {
      _busy = true;
      _clear();
    });
    try {
      return await work();
    } on SignupOfflineException {
      _show(_t.offline);
    } on SignupException catch (e) {
      if (e.code == 'too_many') {
        _show(_t.tooMany(e.retryAfter));
      } else if (e.code == 'ticket_invalid') {
        _ticket = null;
        _step = _Step.phone;
        _show(_t.ticketExpired);
      } else {
        onRefused(e);
      }
    } on Exception {
      _show(_t.failed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    return null;
  }

  void _show(String text, [StatusKind kind = StatusKind.error]) {
    _message = text;
    _messageKind = kind;
  }

  Future<void> _sendCode() async {
    final national = toNationalMobile(_phone.text);
    if (national == null) {
      return setState(() {
        _clear();
        _fieldErrors['phone'] = _t.phoneInvalid;
      });
    }
    final sent = await _call(() async {
      await widget.api.requestCode(national);
      return true;
    }, onRefused: (e) => _fieldErrors['phone'] = e.message);
    if (sent == true) {
      setState(() {
        _national = national;
        _code.clear();
        _step = _Step.code;
      });
    }
  }

  Future<void> _resend() async {
    final sent = await _call(() async {
      await widget.api.requestCode(_national);
      return true;
    }, onRefused: (e) => _show(e.message));
    if (sent == true) setState(() => _show(_t.codeResent, StatusKind.info));
  }

  Future<void> _verify() async {
    if (!isSmsCode(_code.text)) {
      return setState(() {
        _clear();
        _fieldErrors['code'] = _t.codeInvalidFormat;
      });
    }
    final result = await _call(
      () => widget.api.verify(_national, _code.text.trim()),
      onRefused: (e) => _fieldErrors['code'] = switch (e.code) {
        'code_invalid' => _t.codeWrong(e.remainingAttempts),
        'code_expired' => _t.codeExpired,
        _ => e.message,
      },
    );
    if (result == null) return;
    setState(() {
      switch (result) {
        case NewNumber(:final ticket):
          _ticket = ticket;
          _step = _Step.identity;
        case ExistingAccount():
          _step = _Step.existing;
      }
    });
  }

  Future<void> _create() async {
    final errors = <String, String>{
      if (nameIssue(_firstName.text, firstNameMax) case final issue?)
        'firstName': _t.nameError(issue, first: true),
      if (nameIssue(_lastName.text, lastNameMax) case final issue?)
        'lastName': _t.nameError(issue, first: false),
      if (passwordIssue(_password.text, _national) case final issue?)
        'password': _t.passwordError(issue),
    };
    if (errors.isNotEmpty) {
      return setState(() {
        _clear();
        _fieldErrors.addAll(errors);
      });
    }
    final created = await _call(
      () => widget.api.complete(
        ticket: _ticket!,
        firstName: _firstName.text.trim(),
        lastName: _lastName.text.trim(),
        password: _password.text,
      ),
      // Refus de l'API (règles identiques) : sous le champ dont parle le message
      onRefused: (e) {
        final m = e.message.toLowerCase();
        final field = m.contains('mot de passe')
            ? 'password'
            : m.contains('prénom')
            ? 'firstName'
            : m.contains('nom')
            ? 'lastName'
            : null;
        field == null ? _show(e.message) : _fieldErrors[field] = e.message;
      },
    );
    if (created == null) return;
    _password.clear();
    setState(() => _step = created ? _Step.created : _Step.existing);
    if (created) await _signIn();
  }

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _clear();
    });
    try {
      // Connecté : la porte d'entrée remplace cette page par le dossier
      if (await widget.signIn(_national)) return;
    } on Exception {
      _show(_t.offline);
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final t = _t;
    final stepNumber = switch (_step) {
      _Step.phone => 1,
      _Step.code => 2,
      _ => 3,
    };
    return Scaffold(
      appBar: AppBar(title: Text(t.title)),
      body: SafeArea(
        child: AutofillGroup(
          child: ListView(
            padding: const EdgeInsets.all(SabouSpace.s4),
            children: [
              Text(t.step(stepNumber)),
              const SizedBox(height: SabouSpace.s3),
              if (_message != null)
                StatusMessage(_message!, kind: _messageKind),
              ...switch (_step) {
                _Step.phone => _phoneStep(t),
                _Step.code => _codeStep(t),
                _Step.identity => _identityStep(t),
                _Step.existing => _endStep(t, t.existing, StatusKind.info),
                _Step.created => _endStep(t, t.created, StatusKind.success),
              },
            ],
          ),
        ),
      ),
    );
  }

  Widget _field({
    required String id,
    required TextEditingController controller,
    required String label,
    String? hint,
    String? helper,
    TextInputType? keyboard,
    Iterable<String>? autofill,
    List<TextInputFormatter>? formatters,
    bool obscure = false,
    Widget? suffix,
    TextInputAction action = TextInputAction.next,
    VoidCallback? onSubmitted,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: SabouSpace.s4),
    child: TextField(
      key: Key('signup-$id'),
      controller: controller,
      enabled: !_busy,
      keyboardType: keyboard,
      autofillHints: autofill,
      inputFormatters: formatters,
      obscureText: obscure,
      autocorrect: false,
      enableSuggestions: !obscure,
      textInputAction: action,
      onSubmitted: onSubmitted == null ? null : (_) => onSubmitted(),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        helperText: helper,
        helperMaxLines: 3,
        errorText: _fieldErrors[id],
        errorMaxLines: 3,
        suffixIcon: suffix,
      ),
    ),
  );

  Widget _submit(String label, VoidCallback onPressed) => FilledButton(
    onPressed: _busy ? null : onPressed,
    child: Text(_busy ? _t.busy : label),
  );

  List<Widget> _phoneStep(SignupTexts t) => [
    Text(t.phoneIntro),
    const SizedBox(height: SabouSpace.s4),
    _field(
      id: 'phone',
      controller: _phone,
      label: t.phoneLabel,
      hint: t.phoneHint,
      keyboard: TextInputType.phone,
      autofill: const [AutofillHints.telephoneNumber],
      action: TextInputAction.done,
      onSubmitted: _sendCode,
    ),
    _submit(t.sendCode, _sendCode),
  ];

  List<Widget> _codeStep(SignupTexts t) => [
    Text(t.codeSentTo(_formatted)),
    const SizedBox(height: SabouSpace.s4),
    _field(
      id: 'code',
      controller: _code,
      label: t.codeLabel,
      keyboard: TextInputType.number,
      autofill: const [AutofillHints.oneTimeCode],
      formatters: [
        FilteringTextInputFormatter.digitsOnly,
        LengthLimitingTextInputFormatter(6),
      ],
      action: TextInputAction.done,
      onSubmitted: _verify,
    ),
    _submit(t.verify, _verify),
    const SizedBox(height: SabouSpace.s3),
    OutlinedButton(onPressed: _busy ? null : _resend, child: Text(t.resend)),
    TextButton(
      onPressed: _busy
          ? null
          : () => setState(() {
              _clear();
              _step = _Step.phone;
            }),
      child: Text(t.changeNumber),
    ),
  ];

  List<Widget> _identityStep(SignupTexts t) => [
    Text(t.identityIntro),
    const SizedBox(height: SabouSpace.s4),
    _field(
      id: 'firstName',
      controller: _firstName,
      label: t.firstNameLabel,
      autofill: const [AutofillHints.givenName],
      keyboard: TextInputType.name,
    ),
    _field(
      id: 'lastName',
      controller: _lastName,
      label: t.lastNameLabel,
      autofill: const [AutofillHints.familyName],
      keyboard: TextInputType.name,
    ),
    _field(
      id: 'password',
      controller: _password,
      label: t.passwordLabel,
      helper: t.passwordHelp,
      obscure: !_showPassword,
      autofill: const [AutofillHints.newPassword],
      keyboard: TextInputType.visiblePassword,
      action: TextInputAction.done,
      onSubmitted: _create,
      suffix: IconButton(
        tooltip: _showPassword ? t.hidePassword : t.showPassword,
        icon: Icon(_showPassword ? Icons.visibility_off : Icons.visibility),
        onPressed: () => setState(() => _showPassword = !_showPassword),
      ),
    ),
    _submit(t.createAccount, _create),
  ];

  List<Widget> _endStep(SignupTexts t, String text, StatusKind kind) => [
    StatusMessage(text, kind: kind),
    _submit(t.signIn, _signIn),
  ];

  String get _formatted => _national.replaceFirstMapped(
    RegExp(r'^(\d{3})(\d{2})(\d{2})(\d{2})$'),
    (m) => '${m[1]} ${m[2]} ${m[3]} ${m[4]}',
  );
}

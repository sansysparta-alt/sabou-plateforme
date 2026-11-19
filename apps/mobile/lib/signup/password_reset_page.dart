// Mot de passe oublié du praticien dans l'application (US-069, §5.2) : numéro, code reçu par
// SMS, nouveau mot de passe (règles de US-014). Même API que le site. L'écran ne dit jamais
// si le numéro a un compte : le SMS n'arrive que s'il en a un. Sans réseau, l'écran le dit et
// la saisie reste. À la fin, toutes les sessions du compte sont fermées ; la page de connexion
// de Keycloak s'ouvre avec le numéro déjà rempli.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'form_field.dart';
import 'signup_api.dart';
import 'signup_page.dart' show SignInAfterSignup;
import 'signup_rules.dart';
import 'signup_texts.dart';

enum _Step { phone, code, password, done }

class PasswordResetPage extends StatefulWidget {
  const PasswordResetPage({super.key, required this.api, required this.signIn});

  final SignupApi api;
  final SignInAfterSignup signIn;

  @override
  State<PasswordResetPage> createState() => _PasswordResetPageState();
}

class _PasswordResetPageState extends State<PasswordResetPage> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();

  _Step _step = _Step.phone;
  String _national = '';
  String? _ticket;
  bool _busy = false;
  bool _showPassword = false;

  // Erreur sous le champ de l'étape, message général en tête
  String? _fieldError;
  String? _message;
  StatusKind _messageKind = StatusKind.error;

  @override
  void dispose() {
    for (final c in [_phone, _code, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  SignupTexts get _t => SignupTexts.of(context);

  void _clear() {
    _fieldError = null;
    _message = null;
  }

  void _show(String text, [StatusKind kind = StatusKind.error]) {
    _message = text;
    _messageKind = kind;
  }

  // Appel à l'API ; refus généraux traités ici, refus du champ sous le champ
  Future<bool> _call(
    Future<void> Function() work, {
    String Function(SignupException)? fieldError,
  }) async {
    setState(() {
      _busy = true;
      _clear();
    });
    try {
      await work();
      return true;
    } on SignupOfflineException {
      _show(_t.offline);
    } on SignupException catch (e) {
      if (e.code == 'too_many') {
        _show(_t.tooMany(e.retryAfter));
      } else if (e.code == 'ticket_invalid') {
        _ticket = null;
        _password.clear();
        _step = _Step.phone;
        _show(_t.resetExpired);
      } else {
        _fieldError = fieldError?.call(e) ?? e.message;
      }
    } on Exception {
      _show(_t.failed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    return false;
  }

  Future<void> _sendCode({bool again = false}) async {
    final national = again ? _national : toNationalMobile(_phone.text);
    if (national == null) {
      return setState(() {
        _clear();
        _fieldError = _t.phoneInvalid;
      });
    }
    if (await _call(() => widget.api.requestResetCode(national))) {
      setState(() {
        _national = national;
        if (again) {
          _show(_t.codeResent, StatusKind.info);
        } else {
          _code.clear();
          _step = _Step.code;
        }
      });
    }
  }

  Future<void> _verify() async {
    if (!isSmsCode(_code.text)) {
      return setState(() {
        _clear();
        _fieldError = _t.codeInvalidFormat;
      });
    }
    String? ticket;
    final ok = await _call(
      () async =>
          ticket = await widget.api.verifyReset(_national, _code.text.trim()),
      fieldError: (e) => switch (e.code) {
        'code_invalid' => _t.codeWrong(e.remainingAttempts),
        'code_expired' => _t.codeExpired,
        _ => e.message,
      },
    );
    if (ok) {
      setState(() {
        _ticket = ticket;
        _step = _Step.password;
      });
    }
  }

  Future<void> _change() async {
    final issue = passwordIssue(_password.text, _national);
    if (issue != null) {
      return setState(() {
        _clear();
        _fieldError = _t.passwordError(issue);
      });
    }
    final ok = await _call(
      () =>
          widget.api.resetPassword(ticket: _ticket!, password: _password.text),
    );
    if (ok) {
      _password.clear();
      setState(() => _step = _Step.done);
    }
  }

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _clear();
    });
    try {
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
      appBar: AppBar(title: Text(t.resetTitle)),
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
                _Step.phone => [
                  Text(t.resetPhoneIntro),
                  const SizedBox(height: SabouSpace.s4),
                  _field(
                    id: 'phone',
                    controller: _phone,
                    label: t.phoneLabel,
                    hint: t.phoneHint,
                    keyboard: TextInputType.phone,
                    autofill: const [AutofillHints.telephoneNumber],
                    onSubmitted: _sendCode,
                  ),
                  _submit(t.sendCode, _sendCode),
                ],
                _Step.code => [
                  Text(t.resetCodeSentTo(_formatted)),
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
                    onSubmitted: _verify,
                  ),
                  _submit(t.verify, _verify),
                  const SizedBox(height: SabouSpace.s3),
                  OutlinedButton(
                    onPressed: _busy ? null : () => _sendCode(again: true),
                    child: Text(t.resend),
                  ),
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () => setState(() {
                            _clear();
                            _step = _Step.phone;
                          }),
                    child: Text(t.changeNumber),
                  ),
                ],
                _Step.password => [
                  _field(
                    id: 'password',
                    controller: _password,
                    label: t.newPasswordLabel,
                    helper: t.passwordHelp,
                    obscure: !_showPassword,
                    autofill: const [AutofillHints.newPassword],
                    keyboard: TextInputType.visiblePassword,
                    onSubmitted: _change,
                    suffix: IconButton(
                      tooltip: _showPassword ? t.hidePassword : t.showPassword,
                      icon: Icon(
                        _showPassword ? Icons.visibility_off : Icons.visibility,
                      ),
                      onPressed: () =>
                          setState(() => _showPassword = !_showPassword),
                    ),
                  ),
                  _submit(t.changePassword, _change),
                ],
                _Step.done => [
                  StatusMessage(t.resetDone, kind: StatusKind.success),
                  _submit(t.signIn, _signIn),
                ],
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
    required VoidCallback onSubmitted,
  }) => publicFormField(
    keyPrefix: 'reset',
    id: id,
    controller: controller,
    label: label,
    enabled: !_busy,
    error: _fieldError,
    hint: hint,
    helper: helper,
    keyboard: keyboard,
    autofill: autofill,
    formatters: formatters,
    obscure: obscure,
    suffix: suffix,
    action: TextInputAction.done,
    onSubmitted: onSubmitted,
  );

  Widget _submit(String label, VoidCallback onPressed) => FilledButton(
    onPressed: _busy ? null : onPressed,
    child: Text(_busy ? _t.busy : label),
  );

  String get _formatted => _national.replaceFirstMapped(
    RegExp(r'^(\d{3})(\d{2})(\d{2})(\d{2})$'),
    (m) => '${m[1]} ${m[2]} ${m[3]} ${m[4]}',
  );
}

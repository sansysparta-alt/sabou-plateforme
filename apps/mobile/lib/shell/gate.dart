// Porte d'entrée de l'application (US-018) : connexion, puis rubriques du profil.
// - session gardée sur le téléphone : ouverture directe, même sans réseau (rôles gardés) ;
// - compte sans accès à l'application (citoyen) : session révoquée aussitôt, renvoi vers
//   le site public ;
// - session expirée ou révoquée : retour à la connexion.
import 'package:flutter/material.dart';

import '../dossier/session.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'app_shell.dart';
import 'rubric.dart';

/// Ouvre une adresse dans le navigateur du téléphone ; remplaçable dans les tests.
typedef OpenUrl = Future<void> Function(Uri url);

enum _Phase { opening, signedOut, signedIn, noAccess, unknownRoles }

class SabouGate extends StatefulWidget {
  const SabouGate({
    super.key,
    required this.session,
    required this.rubrics,
    required this.openUrl,
    required this.signupUrl,
    required this.siteUrl,
    this.devTools,
  });

  final PractitionerSession session;

  /// Registre de toutes les rubriques ; la porte ne garde que celles du profil.
  final List<Rubric> rubrics;
  final OpenUrl openUrl;
  final Uri signupUrl;

  /// Site public, pour les comptes sans accès à l'application.
  final Uri siteUrl;
  final Widget? devTools;

  @override
  State<SabouGate> createState() => _SabouGateState();
}

class _SabouGateState extends State<SabouGate> {
  _Phase _phase = _Phase.opening;
  SabouProfile? _profile;

  @override
  void initState() {
    super.initState();
    widget.session.hasSession().then((has) {
      if (!mounted) return;
      has ? _resolveProfile() : _go(_Phase.signedOut);
    });
  }

  void _go(_Phase phase) {
    if (mounted) setState(() => _phase = phase);
  }

  Future<void> _resolveProfile() async {
    _go(_Phase.opening);
    final Set<String> roles;
    try {
      roles = await widget.session.roles();
    } on SignedOutException {
      return _go(_Phase.signedOut);
    } on Exception {
      return _go(_Phase.unknownRoles);
    }
    final profile = profileFromRoles(roles);
    if (profile == null) {
      // Aucune raison de garder sur le téléphone une session qui n'ouvre rien
      await widget.session.signOut();
      return _go(_Phase.noAccess);
    }
    _profile = profile;
    _go(_Phase.signedIn);
  }

  Future<void> _signOut() async {
    await widget.session.signOut();
    _go(_Phase.signedOut);
  }

  @override
  Widget build(BuildContext context) {
    return switch (_phase) {
      _Phase.opening => const Scaffold(
        body: LoadingView(label: 'Ouverture de SABOU'),
      ),
      _Phase.signedOut => LoginPage(
        session: widget.session,
        openUrl: widget.openUrl,
        signupUrl: widget.signupUrl,
        onSignedIn: _resolveProfile,
        devTools: widget.devTools,
      ),
      _Phase.signedIn => AppShell(
        rubrics: rubricsFor(_profile!, widget.rubrics),
        onSignOut: _signOut,
        onSignedOut: () => _go(_Phase.signedOut),
        devTools: widget.devTools,
      ),
      _Phase.noAccess => _NoAccessPage(
        openSite: () => widget.openUrl(widget.siteUrl),
        onBack: () => _go(_Phase.signedOut),
      ),
      _Phase.unknownRoles => Scaffold(
        appBar: AppBar(title: const Text('SABOU')),
        body: ListView(
          padding: const EdgeInsets.all(SabouSpace.s4),
          children: [
            const StatusMessage(
              'L’application n’a pas pu ouvrir votre session. Vérifiez le réseau, '
              'puis réessayez.',
              kind: StatusKind.error,
            ),
            FilledButton(
              onPressed: _resolveProfile,
              child: const Text('Réessayer'),
            ),
          ],
        ),
      ),
    };
  }
}

/// Connexion par la page de Keycloak (US-040b). Seuls les praticiens se connectent pour
/// l'instant ; l'agent préfectoral viendra avec sa première rubrique (US-082).
class LoginPage extends StatefulWidget {
  const LoginPage({
    super.key,
    required this.session,
    required this.openUrl,
    required this.signupUrl,
    required this.onSignedIn,
    this.devTools,
  });

  final PractitionerSession session;
  final OpenUrl openUrl;
  final Uri signupUrl;
  final VoidCallback onSignedIn;
  final Widget? devTools;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  bool _busy = false;
  String? _error;

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (await widget.session.signIn()) {
        widget.onSignedIn();
        return;
      }
    } on Exception {
      _error =
          'La connexion n’a pas abouti. Vérifiez le réseau, puis réessayez.';
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('SABOU'), actions: [?widget.devTools]),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(SabouSpace.s4),
          children: [
            Semantics(
              header: true,
              child: Text(
                'Espace praticien',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
            ),
            const SizedBox(height: SabouSpace.s2),
            const Text(
              'Connectez-vous avec votre numéro de téléphone et votre mot de passe '
              'pour remplir et envoyer votre dossier de certification.',
            ),
            const SizedBox(height: SabouSpace.s5),
            if (_error != null) StatusMessage(_error!, kind: StatusKind.error),
            FilledButton(
              onPressed: _busy ? null : _signIn,
              child: Text(_busy ? 'Connexion en cours…' : 'Se connecter'),
            ),
            const SizedBox(height: SabouSpace.s5),
            const Text('Pas encore de compte ?'),
            const SizedBox(height: SabouSpace.s2),
            OutlinedButton(
              onPressed: () => widget.openUrl(widget.signupUrl),
              child: const Text('Créer un compte sur le site SABOU'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Compte sans accès à l'application : le citoyen est renvoyé vers le site public.
class _NoAccessPage extends StatelessWidget {
  const _NoAccessPage({required this.openSite, required this.onBack});

  final VoidCallback openSite;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('SABOU')),
    body: SafeArea(
      child: EmptyState(
        icon: Icons.public,
        title: 'Application réservée aux praticiens et aux agents de terrain',
        message:
            'Votre compte est un compte citoyen. L’annuaire, le dictionnaire et '
            'les recettes sont sur le site public SABOU.',
        actions: [
          FilledButton(
            onPressed: openSite,
            child: const Text('Ouvrir le site SABOU'),
          ),
          OutlinedButton(
            onPressed: onBack,
            child: const Text('Se connecter avec un autre compte'),
          ),
        ],
      ),
    ),
  );
}

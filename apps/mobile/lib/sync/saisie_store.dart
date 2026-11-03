// Dossiers saisis sur le téléphone, avec ou sans réseau (US-004). Toute écriture va
// d'abord dans la base locale chiffrée ; PowerSync la met en file d'envoi et la
// transmet au serveur au retour de la connexion.
import 'dart:convert';

import 'package:powersync/powersync.dart';

import 'sync_schema.dart';

/// Ouvre la base locale, chiffrée (SQLCipher) avec [key], clé brute de 256 bits en
/// hexadécimal. Clé brute (x'…') : pas de dérivation PBKDF2, inutile pour une clé tirée
/// au hasard, et qui coûtait 1,6 s à chaque ouverture sur le téléphone d'essai.
PowerSyncDatabase openSaisieDatabase({
  required String path,
  required String key,
}) {
  if (!RegExp(r'^[0-9a-f]{64}$').hasMatch(key)) {
    throw ArgumentError(
      'Clé de base invalide : 64 caractères hexadécimaux attendus',
    );
  }
  return PowerSyncDatabase(
    schema: syncSchema,
    path: path,
    encryption: EncryptionOptions(key: "x'$key'"),
  );
}

class Saisie {
  const Saisie({
    required this.id,
    required this.contenu,
    required this.statut,
    required this.version,
    required this.origineId,
  });

  factory Saisie.fromRow(Map<String, dynamic> row) => Saisie(
    id: row['id'] as String,
    contenu: jsonDecode(row['contenu'] as String) as Map<String, dynamic>,
    statut: row['statut'] as String? ?? 'brouillon',
    version: row['version'] as int?,
    origineId: row['origine_id'] as String?,
  );

  final String id;
  final Map<String, dynamic> contenu;
  final String statut;

  /// Version du serveur ; nulle tant que le dossier n'y est pas arrivé.
  final int? version;

  /// Dossier d'origine, pour une copie née d'un conflit (R-DON-04).
  final String? origineId;
}

class Avis {
  const Avis({required this.saisieId, required this.motif});

  final String saisieId;
  final String motif;

  /// Message pour l'agent (R-DON-04, point 4).
  String get message => motif == 'version_validee'
      ? 'Ce dossier avait été validé sur le serveur : votre saisie est gardée en brouillon.'
      : 'Une saisie plus récente d’un autre agent a remplacé la vôtre ; la vôtre est gardée dans l’historique.';
}

class SaisieStore {
  SaisieStore(this.db);

  final PowerSyncDatabase db;

  /// Crée un dossier ; l'identifiant est tiré sur le téléphone (UUID), sans réseau.
  Future<String> create(Map<String, dynamic> contenu) async {
    // execute : une écriture passe par la connexion d'écriture, jamais par get()
    final rows = await db.execute(
      'INSERT INTO $saisieTable (id, type, contenu, statut) '
      "VALUES (uuid(), 'dossier', ?, 'brouillon') RETURNING id",
      [jsonEncode(contenu)],
    );
    return rows.first['id'] as String;
  }

  /// Remplace le contenu du dossier entier (jamais champ par champ, R-DON-04).
  Future<void> update(String id, Map<String, dynamic> contenu) => db.execute(
    'UPDATE $saisieTable SET contenu = ? WHERE id = ?',
    [jsonEncode(contenu), id],
  );

  Stream<List<Saisie>> watchAll() => db
      .watch('SELECT * FROM $saisieTable ORDER BY recue_le DESC, id')
      .map((rows) => rows.map(Saisie.fromRow).toList());

  Stream<List<Avis>> watchAvis() => db
      .watch('SELECT saisie_id, motif FROM $avisTable ORDER BY cree_le DESC')
      .map(
        (rows) => [
          for (final r in rows)
            Avis(
              saisieId: r['saisie_id'] as String,
              motif: r['motif'] as String,
            ),
        ],
      );

  /// Nombre d'écritures pas encore reçues par le serveur.
  Stream<int> watchPending() => db
      .watch('SELECT count(*) AS n FROM ps_crud')
      .map((rows) => rows.first['n'] as int);
}

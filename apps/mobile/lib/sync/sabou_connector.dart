// Liaison entre la base du téléphone et les serveurs (US-004) : PowerSync pour recevoir,
// l'API (POST /sync/upload) pour envoyer. Une écriture ne quitte la file d'envoi qu'une
// fois reçue par le serveur : une coupure, même au milieu d'un envoi, ne perd rien.
import 'dart:convert';
import 'dart:developer' as developer;

import 'package:http/http.dart' as http;
import 'package:powersync/powersync.dart';

import 'sync_schema.dart';

/// Adresses vues du téléphone (reliées par adb reverse en développement).
const String defaultPowerSyncUrl = String.fromEnvironment(
  'SABOU_POWERSYNC_URL',
  defaultValue: 'http://localhost:8090',
);
const String defaultApiUrl = String.fromEnvironment(
  'SABOU_API_URL',
  defaultValue: 'http://localhost:4000',
);

/// Jeton de développement (pnpm --filter @sabou/api sync:token) ; Keycloak en production.
const String devSyncToken = String.fromEnvironment('SABOU_SYNC_TOKEN');

/// Le serveur refuse durablement le lot : le renvoyer ne servirait à rien.
class RejectedUploadException implements Exception {
  const RejectedUploadException(this.statusCode);

  final int statusCode;

  @override
  String toString() => 'Lot refusé par le serveur ($statusCode)';
}

class SabouConnector extends PowerSyncBackendConnector {
  SabouConnector({
    required this.powerSyncUrl,
    required this.apiUrl,
    required this.token,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final Uri powerSyncUrl;
  final Uri apiUrl;
  final Future<String> Function() token;
  final http.Client _client;

  @override
  Future<PowerSyncCredentials?> fetchCredentials() async =>
      PowerSyncCredentials(
        endpoint: powerSyncUrl.toString(),
        token: await token(),
      );

  @override
  Future<void> uploadData(PowerSyncDatabase database) async {
    final transaction = await database.getNextCrudTransaction();
    if (transaction == null) return;

    // Un dossier modifié plusieurs fois hors réseau part une seule fois, dans son état final
    final operations = <String, Map<String, Object?>>{};
    for (final entry in transaction.crud) {
      if (entry.table != saisieTable) continue;
      // Le dossier entier tel qu'il est maintenant sur le téléphone (R-DON-04, point 1)
      final row = await database.getOptional(
        'SELECT type, contenu, version FROM $saisieTable WHERE id = ?',
        [entry.id],
      );
      operations[entry.id] = {
        'op': row == null ? 'DELETE' : entry.op.toJson(),
        'table': saisieTable,
        'id': entry.id,
        'type': row?['type'] ?? 'dossier',
        'contenu': row == null
            ? <String, Object?>{}
            : jsonDecode(row['contenu'] as String),
        'version_base': row?['version'],
      };
    }

    if (operations.isNotEmpty) {
      try {
        await _send(operations.values.toList());
      } on RejectedUploadException catch (error) {
        // Lot invalide ou interdit : le garder bloquerait toute la file. La
        // synchronisation suivante rétablit l'état du serveur sur le téléphone.
        developer.log('$error : écritures abandonnées', name: 'sabou.sync');
      }
    }
    await transaction.complete();
  }

  // Lève une exception (et garde la file) si le réseau ou le serveur fait défaut
  Future<void> _send(List<Map<String, Object?>> operations) async {
    final response = await _client
        .post(
          apiUrl.resolve('/sync/upload'),
          headers: {
            'Authorization': 'Bearer ${await token()}',
            'Content-Type': 'application/json',
          },
          body: jsonEncode({'operations': operations}),
        )
        .timeout(const Duration(seconds: 30));
    if (response.statusCode == 200) return;
    if (response.statusCode == 400 ||
        response.statusCode == 403 ||
        response.statusCode == 413) {
      throw RejectedUploadException(response.statusCode);
    }
    // 401 (jeton à renouveler), 5xx, 429… : nouvel essai plus tard, rien n'est perdu
    throw http.ClientException(
      'Envoi refusé pour l’instant (${response.statusCode})',
    );
  }
}

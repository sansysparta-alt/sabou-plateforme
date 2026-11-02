// Envoi d'une voix au banc d'essai de US-005 (packages/audio/src/essai-server.ts), au
// travers du relais 3G. En production, l'envoi passera par l'API (US-009).
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

/// Adresse du banc d'essai vue du téléphone (relais 3G, relié par adb reverse).
const String defaultEssaiUrl = String.fromEnvironment(
  'SABOU_ESSAI_URL',
  defaultValue: 'http://localhost:3300',
);

class ProcessedVersion {
  const ProcessedVersion({
    required this.name,
    required this.url,
    required this.bytes,
  });

  final String name;
  final Uri url;
  final int bytes;
}

class UploadResult {
  const UploadResult({
    required this.sentBytes,
    required this.uploadTime,
    required this.receivedSeconds,
    required this.versions,
  });

  final int sentBytes;
  final Duration uploadTime;
  final double receivedSeconds;
  final List<ProcessedVersion> versions;
}

class EssaiException implements Exception {
  const EssaiException(this.message);

  final String message;

  @override
  String toString() => message;
}

class EssaiApi {
  EssaiApi({required this.baseUrl, http.Client? client})
    : _client = client ?? http.Client();

  final Uri baseUrl;
  final http.Client _client;

  /// Envoie la voix et attend les versions traitées ; mesure la durée de l'envoi.
  Future<UploadResult> upload(Uint8List audio, String contentType) async {
    final stopwatch = Stopwatch()..start();
    final http.Response response;
    try {
      response = await _client
          .post(
            baseUrl.resolve('/voix'),
            headers: {'Content-Type': contentType},
            body: audio,
          )
          .timeout(const Duration(minutes: 3));
    } on Exception {
      throw const EssaiException(
        'Le banc d’essai ne répond pas. Vérifiez qu’il est lancé et relié au téléphone.',
      );
    }
    stopwatch.stop();
    if (response.statusCode != 201) {
      throw EssaiException(switch (response.statusCode) {
        413 => 'Enregistrement trop long pour l’essai.',
        415 => 'Format audio refusé par le serveur.',
        _ => 'Le serveur n’a pas pu traiter la voix (${response.statusCode}).',
      });
    }
    final body =
        jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    return UploadResult(
      sentBytes: audio.length,
      uploadTime: stopwatch.elapsed,
      receivedSeconds: (body['receivedSeconds'] as num).toDouble(),
      versions: [
        for (final v in body['versions'] as List<dynamic>)
          ProcessedVersion(
            name: (v as Map<String, dynamic>)['name'] as String,
            url: baseUrl.resolve(v['url'] as String),
            bytes: v['bytes'] as int,
          ),
      ],
    );
  }
}

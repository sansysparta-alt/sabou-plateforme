// Format d'enregistrement selon la version d'Android (décision du maître d'œuvre, US-005) :
// Opus 32 kbit/s à partir d'Android 10 (seul Android 10 sait l'écrire), AAC 48 kbit/s sur
// Android 8 et 9. Le serveur réduit le bruit, normalise et convertit en Opus 24 kbit/s.

/// Version minimale prise en charge : Android 8.0 (API 26).
const int minSupportedSdk = 26;

enum RecordingCodec { opus, aac }

class RecordingFormat {
  const RecordingFormat({
    required this.codec,
    required this.bitRate,
    required this.sampleRate,
    required this.extension,
    required this.contentType,
  });

  final RecordingCodec codec;
  final int bitRate;
  final int sampleRate;
  final String extension;

  /// Type annoncé au serveur lors de l'envoi.
  final String contentType;
}

const RecordingFormat opusFormat = RecordingFormat(
  codec: RecordingCodec.opus,
  bitRate: 32000,
  sampleRate: 48000,
  extension: 'ogg',
  contentType: 'audio/ogg',
);

const RecordingFormat aacFormat = RecordingFormat(
  codec: RecordingCodec.aac,
  bitRate: 48000,
  sampleRate: 44100,
  extension: 'm4a',
  contentType: 'audio/mp4',
);

/// Format à utiliser sur un appareil dont la version d'Android est [sdkInt].
RecordingFormat recordingFormatFor(int sdkInt) {
  if (sdkInt < minSupportedSdk) {
    throw UnsupportedError('Android 8.0 ou plus récent est nécessaire.');
  }
  return sdkInt >= 29 ? opusFormat : aacFormat;
}

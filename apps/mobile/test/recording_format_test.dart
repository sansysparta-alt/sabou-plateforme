import 'package:flutter_test/flutter_test.dart';
import 'package:sabou_mobile/recording_format.dart';

void main() {
  group('Format d’enregistrement selon Android (US-005)', () {
    test('Android 10 et plus : Opus 32 kbit/s en Ogg', () {
      for (final sdk in [29, 34, 36]) {
        final format = recordingFormatFor(sdk);
        expect(format.codec, RecordingCodec.opus);
        expect(format.bitRate, 32000);
        expect(format.contentType, 'audio/ogg');
      }
    });

    test('Android 8 et 9 : AAC 48 kbit/s en MP4', () {
      for (final sdk in [26, 27, 28]) {
        final format = recordingFormatFor(sdk);
        expect(format.codec, RecordingCodec.aac);
        expect(format.bitRate, 48000);
        expect(format.contentType, 'audio/mp4');
      }
    });

    test('90 s d’enregistrement : 360 Ko en Opus, 540 Ko en AAC', () {
      expect(opusFormat.bitRate * 90 / 8, 360000);
      expect(aacFormat.bitRate * 90 / 8, 540000);
    });

    test('avant Android 8 : refusé', () {
      expect(() => recordingFormatFor(25), throwsUnsupportedError);
    });
  });
}

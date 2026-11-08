// US-040b, critère 2 : la photo est compressée avant l'envoi et passe en 3G. Image de 12
// mégapixels bruitée (le pire cas pour JPEG), avec position GPS et orientation dans l'EXIF,
// comme une photo d'un téléphone récent.
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:sabou_mobile/dossier/photo.dart';

/// Profil 3G du projet (US-006) : 400 kbit/s montants.
const int threeGBytesPerSecond = 400 * 1000 ~/ 8;

Uint8List cameraPhoto({
  int width = 4000,
  int height = 3000,
  int orientation = 6,
}) {
  final rng = Random(40);
  final image = img.Image(width: width, height: height);
  for (final pixel in image) {
    // Dégradé + bruit : beaucoup de détails, comme une vraie scène
    final base = (pixel.x * 255 ~/ width + pixel.y * 255 ~/ height) ~/ 2;
    pixel
      ..r = (base + rng.nextInt(60)).clamp(0, 255)
      ..g = (base + rng.nextInt(60)).clamp(0, 255)
      ..b = (255 - base + rng.nextInt(60)).clamp(0, 255);
  }
  image.exif.imageIfd.orientation = orientation;
  image.exif.imageIfd['Make'] = img.IfdValueAscii('Xiaomi');
  image.exif.gpsIfd['GPSLatitude'] = img.IfdValueRational(11, 1);
  image.exif.gpsIfd['GPSLongitude'] = img.IfdValueRational(12, 1);
  return img.encodeJpg(image, quality: 95);
}

void main() {
  late Uint8List original;
  late Uint8List prepared;
  late img.Image decoded;

  setUpAll(() {
    original = cameraPhoto();
    prepared = preparePhoto(original);
    decoded = img.decodeJpg(prepared)!;
  });

  test(
    'photo de 12 Mpx ramenée à 500 Ko au plus : envoyée en moins de 11 s en 3G',
    () {
      expect(original.length, greaterThan(photoMaxBytes * 2));
      expect(prepared.length, lessThanOrEqualTo(photoMaxBytes));
      expect(prepared.length / threeGBytesPerSecond, lessThan(11));
    },
  );

  test(
    'plus grand côté à 1600 px, orientation appliquée aux pixels (portrait)',
    () {
      // Orientation 6 : photo prise téléphone tenu droit, 4000 × 3000 couché dans le fichier
      expect(decoded.width, 1200);
      expect(decoded.height, 1600);
    },
  );

  test('aucune métadonnée envoyée : ni position GPS, ni modèle du téléphone, ni orientation', () {
    expect(decoded.exif.gpsIfd.isEmpty, isTrue);
    expect(decoded.exif.imageIfd.hasOrientation, isFalse);
    expect(decoded.exif.imageIfd['Make'], isNull);
    // Aucun segment APP1 (EXIF ou XMP) dans le fichier
    for (var i = 0; i + 1 < prepared.length; i++) {
      // Début des données de l'image : fin des en-têtes
      if (prepared[i] == 0xFF && prepared[i + 1] == 0xDA) break;
      expect(prepared[i] == 0xFF && prepared[i + 1] == 0xE1, isFalse);
    }
  });

  test('une petite image garde sa taille, sans métadonnées', () {
    final small = preparePhoto(
      cameraPhoto(width: 800, height: 600, orientation: 1),
    );
    final image = img.decodeJpg(small)!;
    expect([image.width, image.height], [800, 600]);
    expect(image.exif.gpsIfd.isEmpty, isTrue);
  });

  test(
    'un fichier qui n’est pas une image est refusé avec un message clair',
    () {
      expect(
        () => preparePhoto(Uint8List.fromList(List.filled(100, 7))),
        throwsA(isA<PhotoException>()),
      );
    },
  );
}

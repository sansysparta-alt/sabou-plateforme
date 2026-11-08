// Photo jointe au dossier (US-040b, critère 2) : compressée sur le téléphone avant l'envoi,
// pour passer en 3G (profil du projet : 400 kbit/s montants, 400 ms de latence).
// - plus grand côté ramené à 1600 px : lisible pour une pièce d'identité ou un portrait ;
// - JPEG, qualité 80, abaissée par paliers jusqu'à tenir dans 500 Ko (≈ 10 s en 3G) ;
// - orientation appliquée aux pixels, puis toutes les métadonnées retirées (EXIF : position
//   GPS du domicile, modèle du téléphone, date) : rien d'autre que l'image ne quitte le
//   téléphone.

import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';

const int photoMaxSide = 1600;
const int photoMaxBytes = 500 * 1024;
const List<int> _qualities = [80, 70, 60, 50];

class PhotoException implements Exception {
  const PhotoException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Prépare la photo pour l'envoi. Calcul lourd : appelé par [preparePhotoInBackground]
/// pour ne pas figer l'écran.
Uint8List preparePhoto(Uint8List original) {
  final decoded = img.decodeImage(original);
  if (decoded == null) {
    throw const PhotoException(
      'Cette image n’a pas pu être lue. Prenez une autre photo.',
    );
  }
  var image = img.bakeOrientation(decoded);
  final longest = image.width > image.height ? image.width : image.height;
  if (longest > photoMaxSide) {
    image = image.width >= image.height
        ? img.copyResize(
            image,
            width: photoMaxSide,
            interpolation: img.Interpolation.average,
          )
        : img.copyResize(
            image,
            height: photoMaxSide,
            interpolation: img.Interpolation.average,
          );
  }
  // Aucune métadonnée dans le fichier envoyé
  image.exif = img.ExifData();
  image.iccProfile = null;
  image.textData = null;
  for (final quality in _qualities) {
    final jpeg = img.encodeJpg(image, quality: quality);
    if (jpeg.length <= photoMaxBytes) return jpeg;
  }
  throw const PhotoException(
    'La photo reste trop lourde pour être envoyée. Prenez-la d’un peu plus loin.',
  );
}

/// [preparePhoto] dans un isolat séparé : l'écran reste fluide sur un téléphone d'entrée de
/// gamme.
Future<Uint8List> preparePhotoInBackground(Uint8List original) =>
    compute(preparePhoto, original);

enum PhotoOrigin { camera, gallery }

/// Choix de la photo ; remplaçable dans les tests.
abstract interface class PhotoPicker {
  /// Octets de l'image choisie, ou null si le praticien a renoncé.
  Future<Uint8List?> pick(PhotoOrigin origin);
}

/// Appareil photo ou galerie du téléphone. Première réduction faite par le système
/// (2400 px) : l'image décodée ensuite tient dans la mémoire d'un téléphone modeste.
class DevicePhotoPicker implements PhotoPicker {
  DevicePhotoPicker([ImagePicker? picker]) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  @override
  Future<Uint8List?> pick(PhotoOrigin origin) async {
    final file = await _picker.pickImage(
      source: origin == PhotoOrigin.camera
          ? ImageSource.camera
          : ImageSource.gallery,
      maxWidth: 2400,
      maxHeight: 2400,
      imageQuality: 92,
      requestFullMetadata: false,
    );
    return file?.readAsBytes();
  }
}

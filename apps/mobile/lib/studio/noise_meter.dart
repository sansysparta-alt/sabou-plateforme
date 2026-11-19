// Alerte de bruit (US-081, UC-21 2a) : pendant l'enregistrement, le niveau du micro est relevé
// plusieurs fois par seconde (dBFS, 0 = saturation). La parole fait monter le niveau par
// moments ; le bruit de fond, lui, reste entre les mots. On juge donc le « plancher » : le
// niveau que dépassent 90 % des relevés (10e centile). Un plancher élevé veut dire que le bruit
// couvre la voix même quand le praticien se tait. La réduction du bruit du téléphone et celle
// du serveur (US-070) ne rattrapent pas un fond trop fort : on propose de recommencer.

/// Plancher au-delà duquel le fond est jugé trop bruyant (dBFS). Valeur de départ (pièce
/// calme vers −55, rue ou marché vers −30), à confirmer par mesure sur le téléphone d'essai.
const noiseFloorLimitDb = -35.0;

/// Relevés nécessaires avant de juger (environ 2 s à 10 relevés par seconde).
const noiseMinSamples = 20;

/// Niveau trop fort presque tout le temps : la voix sature (micro trop près, cri).
const clippingLimitDb = -1.0;

enum NoiseVerdict { ok, noisy, clipping, tooShort }

class NoiseMeter {
  final _levels = <double>[];

  void add(double dbfs) {
    if (dbfs.isFinite) _levels.add(dbfs.clamp(-160.0, 0.0));
  }

  void reset() => _levels.clear();

  int get samples => _levels.length;

  NoiseVerdict verdict() {
    if (_levels.length < noiseMinSamples) return NoiseVerdict.tooShort;
    final sorted = [..._levels]..sort();
    final floor = sorted[(sorted.length * 0.1).floor()];
    final loud = sorted[(sorted.length * 0.5).floor()];
    if (loud >= clippingLimitDb) return NoiseVerdict.clipping;
    if (floor >= noiseFloorLimitDb) return NoiseVerdict.noisy;
    return NoiseVerdict.ok;
  }
}

/// Message dit au praticien selon le verdict ; null si tout va bien.
String? noiseMessage(NoiseVerdict verdict) => switch (verdict) {
  NoiseVerdict.ok => null,
  NoiseVerdict.noisy =>
    'Il y a beaucoup de bruit autour de vous : votre voix risque de mal s’entendre. '
        'Mettez-vous dans un endroit calme, puis enregistrez de nouveau.',
  NoiseVerdict.clipping => 'Le son sature : éloignez un peu le téléphone de votre bouche, puis enregistrez de nouveau.',
  NoiseVerdict.tooShort =>
    'L’enregistrement est trop court. Parlez au moins quelques secondes.',
};

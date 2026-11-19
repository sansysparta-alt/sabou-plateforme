// Registre des rubriques de l'application mobile (US-018).
// Ajouter une rubrique = ajouter une entrée ici, avec les profils qui la voient. La barre
// de navigation du bas paraît d'elle-même dès qu'un profil a deux rubriques.
// Rubriques prévues au backlog :
// - agent préfectoral : numérisation d'une recette et dossier sur le terrain (US-082, S8),
//   agenda des visites et compte rendu signé (US-083, S8).
import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'dossier/dossier_api.dart';
import 'dossier/photo.dart';
import 'dossier/practitioner_pages.dart';
import 'shell/rubric.dart';
import 'studio/studio_api.dart';
import 'studio/studio_pages.dart';
import 'studio/studio_offline.dart';
import 'studio/voice_field.dart';

/// Toutes les rubriques, dans l'ordre des onglets.
List<Rubric> appRubrics({
  required DossierApi dossierApi,
  required StudioApi studioApi,
  required PhotoPicker picker,
  Future<Uint8List> Function(Uint8List) prepare = preparePhotoInBackground,
  VoiceTools? voiceTools,
  StudioStore? studioStore,
}) => [
  Rubric(
    id: 'dossier',
    label: 'Mon dossier',
    icon: Icons.assignment_outlined,
    selectedIcon: Icons.assignment,
    profiles: const {SabouProfile.practitioner},
    builder: (context, rubric) => DossierPage(
      api: dossierApi,
      picker: picker,
      prepare: prepare,
      onSignedOut: rubric.onSignedOut,
    ),
  ),
  // Studio SABOU mobile (US-067), avec la voix du praticien (US-081)
  Rubric(
    id: 'studio',
    label: 'Studio',
    icon: Icons.edit_note_outlined,
    selectedIcon: Icons.edit_note,
    profiles: const {SabouProfile.practitioner},
    builder: (context, rubric) => TreatmentsPage(
      api: studioApi,
      onSignedOut: rubric.onSignedOut,
      voiceTools: voiceTools,
      store: studioStore,
    ),
  ),
];

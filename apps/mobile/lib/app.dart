// Registre des rubriques de l'application mobile (US-018).
// Ajouter une rubrique = ajouter une entrée ici, avec les profils qui la voient. La barre
// de navigation du bas paraît d'elle-même dès qu'un profil a deux rubriques.
// Rubriques prévues au backlog :
// - praticien : Studio, enregistrement de la recette (US-081, S7) ;
// - agent préfectoral : numérisation d'une recette et dossier sur le terrain (US-082, S8),
//   agenda des visites et compte rendu signé (US-083, S8).
import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'dossier/dossier_api.dart';
import 'dossier/photo.dart';
import 'dossier/practitioner_pages.dart';
import 'shell/rubric.dart';

/// Toutes les rubriques, dans l'ordre des onglets.
List<Rubric> appRubrics({
  required DossierApi dossierApi,
  required PhotoPicker picker,
  Future<Uint8List> Function(Uint8List) prepare = preparePhotoInBackground,
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
];

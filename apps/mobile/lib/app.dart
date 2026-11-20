// Registre des rubriques de l'application mobile (US-018).
// Ajouter une rubrique = ajouter une entrée ici, avec les profils qui la voient. La barre
// de navigation du bas paraît d'elle-même dès qu'un profil a deux rubriques.
// Praticien : tableau de bord en premier onglet (US-090).
// Agent préfectoral : agenda des visites et compte rendu signé (US-083), numérisation d'une
// recette et dossier sur le terrain (US-082).
import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'dashboard/dashboard_api.dart';
import 'dashboard/dashboard_page.dart';
import 'disputes/disputes_api.dart';
import 'disputes/disputes_pages.dart';
import 'dossier/dossier_api.dart';
import 'dossier/photo.dart';
import 'dossier/practitioner_pages.dart';
import 'field/field_api.dart';
import 'field/field_pages.dart';
import 'field/field_visits_pages.dart';
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
  FieldApi? fieldApi,
  FieldStudioFactory? fieldStudio,
  OpenExternal? openExternal,
  DisputesApi? disputesApi,
  DashboardApi? dashboardApi,
}) => [
  // US-090 : tableau de bord du praticien (traitements, frise de certification, certificat)
  if (dashboardApi != null)
    Rubric(
      id: 'accueil',
      label: 'Accueil',
      icon: Icons.dashboard_outlined,
      selectedIcon: Icons.dashboard,
      profiles: const {SabouProfile.practitioner},
      builder: (context, rubric) =>
          DashboardPage(api: dashboardApi, onSignedOut: rubric.onSignedOut),
    ),
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
  // US-101 : litiges et recours de 30 jours après un rejet définitif
  if (disputesApi != null)
    Rubric(
      id: 'litiges',
      label: 'Litiges',
      icon: Icons.gavel_outlined,
      selectedIcon: Icons.gavel,
      profiles: const {SabouProfile.practitioner},
      builder: (context, rubric) => DisputesPage(
        api: disputesApi,
        picker: picker,
        prepare: prepare,
        onSignedOut: rubric.onSignedOut,
      ),
    ),
  // US-082 : agent préfectoral, numérisation au nom du praticien et dossier terrain
  if (fieldApi != null && fieldStudio != null && openExternal != null) ...[
    // US-083 : tournée du jour, itinéraire par localité, compte rendu signé sans réseau
    Rubric(
      id: 'visites',
      label: 'Visites',
      icon: Icons.event_note_outlined,
      selectedIcon: Icons.event_note,
      profiles: const {SabouProfile.fieldAgent},
      builder: (context, rubric) => FieldVisitsPage(
        api: fieldApi,
        picker: picker,
        prepare: prepare,
        openExternal: openExternal,
        onSignedOut: rubric.onSignedOut,
      ),
    ),
    Rubric(
      id: 'numeriser',
      label: 'Numériser',
      icon: Icons.record_voice_over_outlined,
      selectedIcon: Icons.record_voice_over,
      profiles: const {SabouProfile.fieldAgent},
      builder: (context, rubric) => FieldPractitionersPage(
        api: fieldApi,
        studioFor: fieldStudio,
        onSignedOut: rubric.onSignedOut,
      ),
    ),
    Rubric(
      id: 'dossiers-terrain',
      label: 'Dossiers',
      icon: Icons.folder_shared_outlined,
      selectedIcon: Icons.folder_shared,
      profiles: const {SabouProfile.fieldAgent},
      builder: (context, rubric) => FieldDossiersPage(
        api: fieldApi,
        picker: picker,
        prepare: prepare,
        onSignedOut: rubric.onSignedOut,
      ),
    ),
  ],
];

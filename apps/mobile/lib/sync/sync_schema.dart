// Tables locales synchronisées par PowerSync (US-004). Elles reprennent les colonnes
// diffusées par packages/db/sync/sync-rules.yaml ; l'identifiant (id) est implicite.
import 'package:powersync/powersync.dart';

const saisieTable = 'saisie_terrain';
const avisTable = 'saisie_terrain_avis';

const syncSchema = Schema([
  Table(saisieTable, [
    Column.text('type'),
    Column.integer('prefecture_id'),
    Column.integer('auteur_id'),
    // Dossier entier, en JSON : le conflit se règle à ce niveau (R-DON-04)
    Column.text('contenu'),
    Column.text('statut'),
    // Version du serveur ; jamais modifiée sur le téléphone (base d'un conflit)
    Column.integer('version'),
    Column.text('origine_id'),
    Column.text('recue_le'),
  ]),
  Table(avisTable, [
    Column.text('saisie_id'),
    Column.text('motif'),
    Column.text('copie_id'),
    Column.text('cree_le'),
  ]),
]);

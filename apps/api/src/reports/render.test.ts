// US-091 : rendu des exports PDF et XLSX à partir du même modèle de document. Le PDF est
// balisé (accessibilité), en français, avec sa police embarquée ; le XLSX garde des nombres.
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { PrefectoralIndicators, PrefectoralReportContent } from '@sabou/types';
import {
  dashboardDocument,
  DOCUMENT_NOTICE,
  formatMonth,
  monthlyReportDocument,
  type MonthlyReportSnapshot,
} from './document';
import { renderPdf } from './pdf';
import { renderXlsx } from './xlsx';

const AT = '2026-11-20T10:00:00Z';

const INDICATORS: PrefectoralIndicators = {
  profil: 'prefectoral',
  enregistres: 186,
  certifies: 140,
  enAttente: 46,
  recettesNumerisees: 6,
  parSpecialite: [{ specialite: 'Herboristerie', praticiens: 120 }],
  aValider: {
    total: 1,
    dossiers: [{ dossier: 'DS-1041', praticien: 'Sékou Kourouma', depuis: AT }],
  },
};

const CONTENT: PrefectoralReportContent = {
  activite: {
    nouveauxPraticiens: 3,
    dossiersSoumis: 4,
    visitesRealisees: 2,
    recettesNumerisees: 1,
    praticiensPublies: 1,
  },
  delais: {
    passages: 4,
    valides: 3,
    renvoyes: 1,
    moyenneJours: 2.5,
    horsDelai: 1,
    objectifJours: 3,
  },
  anomalies: { dossiersBloques: [], alertesOuvertes: 1 },
  registre: { enregistres: 186, certifies: 140, enAttente: 46 },
};

const REPORT: MonthlyReportSnapshot = {
  niveau: 'prefectoral',
  mois: '2026-10-01',
  version: 2,
  statut: 'envoye',
  zone: 'Labé',
  region: 'Labé',
  auteur: 'Ibrahima Sow',
  calculeLe: AT,
  envoyeLe: AT,
  renvoiMotif: null,
  contenu: CONTENT,
  commentaire: 'Deux visites reportées pour cause de pluie.',
};

const board = dashboardDocument({ zone: 'Labé', indicateurs: INDICATORS }, 'Ibrahima Sow', AT);

describe('modèle de document', () => {
  it('tableau de bord : mêmes indicateurs que l’écran, zone et date de la photographie', () => {
    expect(board.title).toBe('Tableau de bord · Labé');
    expect(board.sections[0]).toEqual({
      kind: 'figures',
      heading: 'Chiffres clés',
      rows: [
        ['Praticiens enregistrés', 186],
        ['Praticiens certifiés', 140],
        ['En attente de certification', 46],
        ['Recettes numérisées par un agent', 6],
      ],
    });
    expect(board.meta.map(([label]) => label)).toEqual(['Zone', 'Exporté par', 'Chiffres du']);
  });

  it('rapport mensuel : mois en clair, état, délais et commentaire', () => {
    const doc = monthlyReportDocument(REPORT, AT);
    expect(formatMonth('2026-10-01')).toBe('octobre 2026');
    expect(doc.title).toBe('Rapport mensuel préfectoral · Labé · octobre 2026');
    expect(doc.meta).toContainEqual(['État', 'Envoyé']);
    expect(doc.sections.find((s) => s.heading.startsWith('Délais'))).toMatchObject({
      rows: expect.arrayContaining([['Délai moyen (jours)', 2.5]]),
    });
    expect(doc.sections.at(-1)).toEqual({
      kind: 'text',
      heading: 'Commentaire',
      text: 'Deux visites reportées pour cause de pluie.',
    });
  });
});

describe('PDF', () => {
  it('PDF 1.7 balisé, en français, titre affiché, police embarquée', async () => {
    const pdf = await renderPdf(board);
    const raw = pdf.toString('latin1');
    expect(raw.startsWith('%PDF-1.7')).toBe(true);
    expect(raw).toContain('/StructTreeRoot');
    expect(raw).toContain('/MarkInfo');
    expect(raw).toContain('/Marked true');
    expect(raw).toContain('/Lang (fr-FR)');
    expect(raw).toContain('/DisplayDocTitle true');
    expect(raw).toContain('/FontFile2');
    // Tableaux balisés avec cellules d'en-tête
    expect(raw).toContain('/S /TH');
    expect(raw).toContain('/S /H1');
  });

  it('régénéré à l’identique à partir de la même photographie', async () => {
    const [a, b] = await Promise.all([renderPdf(board), renderPdf(board)]);
    expect(a.toString('base64')).toBe(b.toString('base64'));
  });
});

describe('XLSX', () => {
  it('titre, indicateurs en nombres, mention finale', async () => {
    const book = new ExcelJS.Workbook();
    const file = await renderXlsx(monthlyReportDocument(REPORT, AT));
    // Types d'ExcelJS antérieurs aux Buffer génériques de Node : ArrayBuffer équivalent
    await book.xlsx.load(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
    );
    const sheet = book.getWorksheet('Rapport')!;
    const values: unknown[][] = [];
    sheet.eachRow((row) => values.push((row.values as unknown[]).slice(1)));
    expect(values[0]).toEqual(['Rapport mensuel préfectoral · Labé · octobre 2026']);
    expect(values).toContainEqual(['Dossiers soumis', 4]);
    expect(values).toContainEqual(['Délai moyen (jours)', 2.5]);
    expect(values.at(-1)).toEqual([DOCUMENT_NOTICE]);
  });
});

import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { DOCUMENT_NOTICE, type Cell, type ReportDocument } from './document';

// Rendu PDF des exports (US-091, 05 §2.91) : pdfkit dans l'API, sans navigateur ni service à
// part. PDF balisé (titres, paragraphes, tableaux avec en-têtes) en français, police Noto Sans
// embarquée (OFL) : lisible par un lecteur d'écran, identique sur tous les postes.

export const FONTS_DIR = join(__dirname, '..', '..', 'assets', 'fonts');

// Couleurs de la charte (packages/ui/src/tokens.css)
const FOREST = '#0b3d2e';
const TEXT = '#17201c';
const MUTED = '#4a5551';
const BORDER = '#dce3e0';
const MIST = '#e6f4ec';

const cell = (value: Cell) => (value === null ? '—' : String(value));

// Crée un document A4 balisé ; renvoie aussi l'élément racine de la structure
export function createPdf(title: string, subject: string, createdAt: string) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 64, left: 56, right: 56 },
    pdfVersion: '1.7',
    tagged: true,
    lang: 'fr-FR',
    displayTitle: true,
    bufferPages: true,
    info: {
      Title: title,
      Subject: subject,
      Author: 'SABOU',
      Creator: 'SABOU',
      // Date de la photographie : le même export donne le même document
      CreationDate: new Date(createdAt),
    },
  });
  doc.registerFont('regular', join(FONTS_DIR, 'NotoSans-Regular.ttf'));
  doc.registerFont('bold', join(FONTS_DIR, 'NotoSans-Bold.ttf'));
  doc.font('regular').fillColor(TEXT);
  const root = doc.struct('Document');
  doc.addStructure(root);
  return { doc, root };
}

// Pied de page (numéro et mention), hors de la structure du document (artefact de pagination)
function footer(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.markContent('Artifact', { type: 'Pagination' });
    doc
      .font('regular')
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `${DOCUMENT_NOTICE}   Page ${i + 1} sur ${range.count}`,
        doc.page.margins.left,
        doc.page.height - 40,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' },
      );
    doc.endMarkedContent();
    doc.page.margins.bottom = bottom;
  }
}

export function finishPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    footer(doc);
    doc.end();
  });
}

export function renderPdf(report: ReportDocument): Promise<Buffer> {
  const { doc, root } = createPdf(report.title, report.subtitle, report.generatedAt);
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc
    .font('bold')
    .fontSize(18)
    .fillColor(FOREST)
    .text(report.title, { structParent: root, structType: 'H1' });
  doc
    .font('regular')
    .fontSize(11)
    .fillColor(MUTED)
    .text(report.subtitle, { structParent: root, structType: 'P' });
  doc.moveDown(0.5);
  doc.fillColor(TEXT).fontSize(10);
  for (const [label, value] of report.meta) {
    doc.text(`${label} : ${value}`, { structParent: root, structType: 'P' });
  }

  for (const section of report.sections) {
    doc.moveDown(1);
    // Titre gardé avec le début de son contenu
    if (doc.y > doc.page.height - doc.page.margins.bottom - 80) doc.addPage();
    doc
      .font('bold')
      .fontSize(13)
      .fillColor(FOREST)
      .text(section.heading, doc.page.margins.left, doc.y, {
        structParent: root,
        structType: 'H2',
      });
    doc.moveDown(0.3).font('regular').fontSize(10).fillColor(TEXT);
    if (section.kind === 'text') {
      doc.text(section.text, { structParent: root, structType: 'P', width });
      continue;
    }
    const header = section.kind === 'figures' ? ['Indicateur', 'Valeur'] : section.columns;
    const rows: Cell[][] = section.rows;
    if (rows.length === 0) {
      doc.fillColor(MUTED).text(section.kind === 'table' ? section.empty : '', {
        structParent: root,
        structType: 'P',
      });
      continue;
    }
    // structParent : option de pdfkit 0.20 absente des types @types/pdfkit 0.17 (tableau balisé)
    doc.table({
      ...({ structParent: root } as object),
      position: { x: doc.page.margins.left, y: doc.y },
      maxWidth: width,
      columnStyles: section.kind === 'figures' ? ['70%', '30%'] : undefined,
      defaultStyle: {
        border: { top: 0, right: 0, bottom: 0.5, left: 0 },
        borderColor: BORDER,
        padding: 4,
      },
      data: [
        header.map((text) => ({
          text,
          type: 'TH',
          scope: 'column',
          font: { src: 'bold' },
          backgroundColor: MIST,
        })),
        ...rows.map((row) => row.map((value) => ({ text: cell(value) }))),
      ],
    });
    doc.x = doc.page.margins.left;
  }
  return finishPdf(doc);
}

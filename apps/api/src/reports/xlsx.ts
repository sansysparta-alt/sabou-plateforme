import ExcelJS from 'exceljs';
import { DOCUMENT_NOTICE, type ReportDocument } from './document';

// Rendu XLSX des exports (US-091, 05 §2.91) : ExcelJS, une feuille par document. Les nombres
// restent des nombres (triables, calculables) ; les en-têtes sont en gras et la première
// colonne figée sur la largeur du libellé.

const MIST = 'FFE6F4EC';

export async function renderXlsx(report: ReportDocument): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = 'SABOU';
  // Date de la photographie : le même export donne le même classeur
  book.created = new Date(report.generatedAt);
  book.modified = book.created;
  book.title = report.title;
  const sheet = book.addWorksheet('Rapport', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  });

  sheet.addRow([report.title]).font = { bold: true, size: 14 };
  sheet.addRow([report.subtitle]);
  for (const [label, value] of report.meta) sheet.addRow([label, value]);

  let widest = 1;
  for (const section of report.sections) {
    sheet.addRow([]);
    sheet.addRow([section.heading]).font = { bold: true, size: 12 };
    if (section.kind === 'text') {
      sheet.addRow([section.text]).alignment = { wrapText: true, vertical: 'top' };
      continue;
    }
    const header = section.kind === 'figures' ? ['Indicateur', 'Valeur'] : section.columns;
    widest = Math.max(widest, header.length);
    const head = sheet.addRow(header);
    head.font = { bold: true };
    head.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MIST } };
    });
    if (section.rows.length === 0 && section.kind === 'table') sheet.addRow([section.empty]);
    for (const row of section.rows) sheet.addRow(row.map((v) => (v === null ? '' : v)));
  }
  sheet.addRow([]);
  sheet.addRow([DOCUMENT_NOTICE]).font = { italic: true };

  sheet.getColumn(1).width = 48;
  for (let c = 2; c <= Math.max(widest, 2); c++) sheet.getColumn(c).width = 22;
  return Buffer.from(await book.xlsx.writeBuffer());
}

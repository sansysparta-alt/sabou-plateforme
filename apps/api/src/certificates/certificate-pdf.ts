import QRCode from 'qrcode';
import type { CertificateView } from '@sabou/types';
import { createPdf, finishPdf } from '../reports/pdf';

// PDF du certificat signé (US-091 ; annoncé par la décision du maître d'œuvre du 12 novembre
// 2026, 05 §2.91) : mêmes mentions que la page imprimable, QR signé dessiné en vectoriel
// (net à toute taille d'impression), document balisé.

const FOREST = '#0b3d2e';
const MUTED = '#4a5551';

const STATUS: Record<CertificateView['statut'], string> = {
  actif: 'Actif',
  expire: 'Expiré',
  revoque: 'Révoqué',
};

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { dateStyle: 'long', timeZone: 'UTC' });
// Empreinte en blocs de 4 caractères, comme sur la page de vérification (05 §2.16)
const blocks = (hex: string) => hex.match(/.{1,4}/g)?.join(' ') ?? hex;

export async function renderCertificatePdf(
  certificate: Omit<CertificateView, 'qrSvg'>,
  qr: string | null,
): Promise<Buffer> {
  const title = `Certificat de tradipraticien ${certificate.numero}`;
  // Date du document : émission du certificat (le même certificat donne le même fichier)
  const { doc, root } = createPdf(title, certificate.titulaire, `${certificate.emisLe}T00:00:00Z`);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  doc
    .font('regular')
    .fontSize(10)
    .fillColor(MUTED)
    .text(`République de Guinée · ${certificate.autorite}`, {
      structParent: root,
      structType: 'P',
    });
  doc.moveDown(0.5);
  doc
    .font('bold')
    .fontSize(22)
    .fillColor(FOREST)
    .text('Certificat de tradipraticien', { structParent: root, structType: 'H1' });
  doc
    .font('regular')
    .fontSize(12)
    .fillColor('#17201c')
    .text(`N° ${certificate.numero} · ${STATUS[certificate.statut]}`, {
      structParent: root,
      structType: 'P',
    });
  doc.moveDown(1);

  const facts: [string, string][] = [
    ['Titulaire', certificate.titulaire],
    ['Praticien', certificate.praticien],
    ['Spécialité', certificate.specialite],
    ['Préfecture', certificate.prefecture],
    ['Émis le', day(certificate.emisLe)],
    ['Valable jusqu’au', `${day(certificate.expireLe)} inclus`],
    ['Dossier', certificate.dossier],
  ];
  doc.table({
    // structParent : option de pdfkit 0.20 absente des types @types/pdfkit 0.17 (tableau balisé)
    ...({ structParent: root } as object),
    position: { x: left, y: doc.y },
    maxWidth: width * 0.6,
    columnStyles: ['40%', '60%'],
    defaultStyle: { border: 0, padding: 3 },
    data: facts.map(([label, value]) => [
      { text: label, type: 'TH' as const, scope: 'row' as const, font: { src: 'bold' } },
      { text: value },
    ]),
  });

  const top = doc.y + 16;
  if (qr) {
    // QR signé, correction M et marge de 4 modules, comme la page imprimable
    const code = QRCode.create(qr, { errorCorrectionLevel: 'M' });
    const size = code.modules.size;
    const side = 170;
    const quiet = 4;
    const unit = side / (size + 2 * quiet);
    const x0 = left;
    const y0 = top;
    const figure = doc.struct(
      'Figure',
      {
        alt: `QR code signé du certificat ${certificate.numero}`,
      },
      () => {
        doc.save().fillColor('#000000');
        for (let r = 0; r < size; r++)
          for (let c = 0; c < size; c++)
            if (code.modules.get(r, c))
              doc.rect(x0 + (c + quiet) * unit, y0 + (r + quiet) * unit, unit, unit);
        doc.fill().restore();
      },
    );
    root.add(figure);
    figure.end();
    doc
      .fontSize(9)
      .fillColor(MUTED)
      .text(
        'Vérifiez ce certificat sur le site SABOU, page « Vérifier un certificat ».',
        x0,
        y0 + side + 4,
        { structParent: root, structType: 'Caption', width: side + 120 },
      );
  } else {
    doc.fontSize(10).fillColor(MUTED).text('Certificat d’exemple, sans QR signé.', left, top, {
      structParent: root,
      structType: 'P',
    });
  }

  doc.moveDown(2).fontSize(9).fillColor('#17201c');
  for (const line of [
    `Empreinte SHA3-256 : ${blocks(certificate.empreinte)}`,
    `Signé électroniquement (Ed25519) par la Direction Générale · clé ${certificate.cle}`,
    'La plateforme SABOU atteste la certification du praticien. Elle informe ; elle ne prescrit pas.',
  ]) {
    doc.text(line, left, doc.y, { structParent: root, structType: 'P', width });
  }
  return finishPdf(doc);
}

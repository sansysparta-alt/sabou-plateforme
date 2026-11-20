import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import QRCode from 'qrcode';
import { verifyCertificateQr, type CertificateData } from '@sabou/qr';
import { keyIdFor, signCertificateQrWith } from '@sabou/qr/sign';
import type {
  ApprovalItem,
  ApprovalResult,
  CertificateView,
  ZoneListQuery,
  ZonePage,
} from '@sabou/types';
import { normalizeIp } from '../audit/audit.log';
import {
  DecisionNotAllowedError,
  DossierNotFoundError,
  StaleDossierError,
} from '../certification/certification.repository';
import { DATABASE, type Database } from '../database/database';
import { zonePage } from '../database/paging';
import { inZone } from '../database/zone';
import { CERTIFICATE_SIGNER, SignerUnavailableError, type CertificateSigner } from './vault-signer';

// Autorité émettrice, écrite dans les données signées du QR (R-QR-02)
export const AUTHORITY = 'Direction générale SABOU';

// Données du certificat et texte de son QR signé (null pour un certificat fictif du jeu d'exemple)
export interface CertificateSource {
  view: Omit<CertificateView, 'qrSvg'>;
  qr: string | null;
}

export class CertificateNotFoundError extends Error {}

// Messages des fonctions certificat_* (migration 20261113140000) ; chaque branche est
// couverte par un test sur un vrai PostgreSQL (packages/db/test/certificat-signe.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (message.includes('non habilité')) throw new DecisionNotAllowedError();
  if (message.includes('étape 5 seulement')) throw new StaleDossierError();
  throw error;
}

// Fait signer les données d'un certificat par le coffre (US-045) et contre-vérifie le QR avec
// la clé publique annoncée : il doit être vert pour le vérificateur du site. Partagé avec le
// recours accepté (US-101), qui émet un nouveau certificat.
export async function signCertificate(signer: CertificateSigner, data: CertificateData) {
  const key = await signer.currentKey();
  const kid = keyIdFor(key.publicKey);
  const x = Buffer.from(key.publicKey).toString('base64url');
  const signed = await signCertificateQrWith(data, kid, (input) => signer.sign(input, key.version));
  const verdict = verifyCertificateQr(
    signed.qr,
    [{ kty: 'OKP', crv: 'Ed25519', kid, x }],
    new Date(`${data.issuedOn}T12:00:00Z`),
  );
  if (verdict.color !== 'vert') {
    throw new SignerUnavailableError('Signature du coffre invalide pour sa clé publique');
  }
  return { signed, kid, x };
}

@Injectable()
export class CertificatesRepository {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CERTIFICATE_SIGNER) private readonly signer: CertificateSigner,
  ) {}

  // Dossiers en attente d'approbation par la DG (étape 5), toutes régions
  listApproval(sub: string, query: ZoneListQuery): Promise<ZonePage<ApprovalItem>> {
    return inZone(this.db, sub, async (trx) => {
      return zonePage<ApprovalItem>(
        trx,
        sql`
        SELECT d.code, p.code AS praticien, u.prenom || ' ' || u.nom AS "praticienNom",
               sp.libelle_fr AS specialite, pf.nom AS prefecture, ra.nom AS region, d.type,
               to_char(d.etape_entree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "expertiseLe",
               EXISTS (SELECT 1 FROM sabou.visite_terrain vt
                        WHERE vt.dossier_id = d.id AND vt.statut = 'realisee') AS "visiteRealisee",
               (SELECT c.numero FROM sabou.certificat c
                 WHERE c.praticien_id = p.id AND c.statut = 'actif') AS "certificatActuel"
          FROM sabou.dossier_certification d
          JOIN sabou.praticien p      ON p.id = d.praticien_id
          JOIN sabou.utilisateur u    ON u.id = p.utilisateur_id
          JOIN sabou.specialite sp    ON sp.id = p.specialite_id
          JOIN sabou.prefecture pf    ON pf.id = p.prefecture_id
          JOIN sabou.region_admin ra  ON ra.id = pf.region_admin_id
         WHERE d.statut = 'en_cours' AND d.etape_courante = 5`,
        query,
        ['praticienNom'],
      );
    });
  }

  // Approbation (UC-60) : la base fixe numéro et dates, le coffre signe, la base enregistre
  // le certificat et fait passer le dossier à l'étape 6, dans une seule transaction. Le
  // dossier reste verrouillé pendant la signature : deux approbations simultanées ne
  // peuvent pas émettre deux certificats.
  approve(sub: string, ip: string | undefined, code: string): Promise<ApprovalResult> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      const { rows } = await sql<{ id: number; etape: number; statut: string }>`
        SELECT id::int, etape_courante::int AS etape, statut
          FROM sabou.dossier_certification WHERE code = ${code} FOR UPDATE`.execute(trx);
      const dossier = rows[0];
      if (!dossier) throw new DossierNotFoundError();
      if (dossier.statut !== 'en_cours' || dossier.etape !== 5) throw new StaleDossierError();

      const prepared = await sql<{
        numero: string;
        titulaire: string;
        emis: string;
        expire: string;
      }>`
        SELECT numero, titulaire, emis_le::text AS emis, expire_le::text AS expire
          FROM sabou.certificat_preparer(${dossier.id}, sabou.contexte_utilisateur())`
        .execute(trx)
        .catch(translate);
      const { numero, titulaire, emis, expire } = prepared.rows[0]!;
      const data: CertificateData = {
        number: numero,
        practitioner: titulaire,
        issuedOn: emis,
        expiresOn: expire,
        authority: AUTHORITY,
      };

      const { signed, kid, x } = await signCertificate(this.signer, data);

      const result = await sql<{ etape: number }>`
        SELECT sabou.certificat_emettre(${dossier.id}, sabou.contexte_utilisateur(), ${numero},
                 ${emis}::date, ${expire}::date, ${signed.digest}, ${signed.signature},
                 ${kid}, ${x}, ${signed.qr})::int AS etape`
        .execute(trx)
        .catch(translate);
      return { code, etape: result.rows[0]!.etape, certificat: numero };
    });
  }

  // Certificat et texte de son QR signé. Le praticien est cloisonné par zone (RLS) : hors
  // zone, introuvable.
  source(sub: string, numero: string): Promise<CertificateSource> {
    return inZone(this.db, sub, async (trx) => {
      const { rows } = await sql<
        Omit<CertificateView, 'autorite' | 'qrSvg'> & { qr: string | null }
      >`
        SELECT c.numero, c.statut, u.prenom || ' ' || u.nom AS titulaire, p.code AS praticien,
               sp.libelle_fr AS specialite, pf.nom AS prefecture,
               c.emis_le::text AS "emisLe", c.expire_le::text AS "expireLe", d.code AS dossier,
               c.empreinte_sha3::text AS empreinte, k.kid AS cle, c.qr
          FROM sabou.certificat c
          JOIN sabou.praticien p             ON p.id = c.praticien_id
          JOIN sabou.utilisateur u           ON u.id = p.utilisateur_id
          JOIN sabou.specialite sp           ON sp.id = p.specialite_id
          -- Territoire de l'émission, figé (US-022) : un redécoupage ne le change pas
          JOIN sabou.prefecture pf           ON pf.id = c.prefecture_origine_id
          JOIN sabou.dossier_certification d ON d.id = c.dossier_id
          JOIN sabou.cle_signature k         ON k.id = c.cle_id
         WHERE c.numero = ${numero}`.execute(trx);
      const row = rows[0];
      if (!row) throw new CertificateNotFoundError();
      const { qr, ...view } = row;
      return { view: { ...view, autorite: AUTHORITY }, qr };
    });
  }

  // Certificat à imprimer (page de l'application de gestion)
  async get(sub: string, numero: string): Promise<CertificateView> {
    const { view, qr } = await this.source(sub, numero);
    return {
      ...view,
      // Correction M, comme le prototype validé (05 §2.16) ; marge de 4 modules (norme)
      qrSvg: qr
        ? await QRCode.toString(qr, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 })
        : null,
    };
  }
}

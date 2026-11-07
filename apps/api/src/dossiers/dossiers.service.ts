import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type {
  DossierError,
  PractitionerDossier,
  PractitionerPieceType,
  PractitionerProfile,
  SubmissionReceipt,
} from '@sabou/types';
import { PIECE_LABELS } from '@sabou/types';
import { SMS_SENDER, type SmsSender } from '../signup/sms';
import { inspectPiece } from './piece-content';
import { PIECE_STORAGE, type PieceStorage } from './piece-storage';
import {
  DossierLockedError,
  DossiersRepository,
  InvalidReferenceError,
  NoDossierError,
  NoProfileError,
  RejectionDelayError,
} from './dossiers.repository';

export class DossierHttpError extends HttpException {
  constructor(status: HttpStatus, body: DossierError) {
    super(body, status);
  }
}

// Texte de l'accusé de réception : en français seulement (langues nationales en voix)
export function receiptMessage(code: string): string {
  return `SABOU : votre dossier ${code} est bien reçu. Il passe à la vérification sur le terrain ; l'administration de votre préfecture vous contactera.`;
}

function toHttp(error: unknown): never {
  if (error instanceof RejectionDelayError) {
    throw new DossierHttpError(HttpStatus.CONFLICT, {
      error: 'rejection_delay',
      message: 'Un nouveau dossier n’est possible que 12 mois après un rejet définitif (R-CER-04).',
    });
  }
  if (error instanceof DossierLockedError) {
    throw new DossierHttpError(HttpStatus.CONFLICT, {
      error: 'locked',
      message: 'Votre dossier est en cours d’examen : il ne peut plus être modifié.',
    });
  }
  if (error instanceof NoProfileError) {
    throw new DossierHttpError(HttpStatus.CONFLICT, {
      error: 'no_profile',
      message: 'Remplissez d’abord votre fiche (spécialité, localité, langue).',
    });
  }
  if (error instanceof NoDossierError) {
    throw new DossierHttpError(HttpStatus.CONFLICT, {
      error: 'no_dossier',
      message: 'Vous n’avez pas de dossier en cours.',
    });
  }
  if (error instanceof InvalidReferenceError) {
    throw new DossierHttpError(HttpStatus.BAD_REQUEST, {
      error: 'invalid',
      message: 'Spécialité, localité ou langue inconnue.',
    });
  }
  throw error;
}

// Dossier de certification du praticien (US-040a) : fiche, pièces, soumission
@Injectable()
export class DossiersService {
  private readonly logger = new Logger('Dossiers');

  constructor(
    private readonly repository: DossiersRepository,
    @Inject(PIECE_STORAGE) private readonly storage: PieceStorage,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  view(sub: string): Promise<PractitionerDossier | null> {
    return this.repository.view(sub);
  }

  async saveProfile(sub: string, profile: PractitionerProfile): Promise<void> {
    await this.repository.saveProfile(sub, profile).catch(toHttp);
  }

  // Le fichier est déposé avant la ligne de la base ; si la base refuse, il est retiré
  async addPiece(sub: string, type: PractitionerPieceType, body: Buffer): Promise<{ id: number }> {
    const content = inspectPiece(body);
    if (!content) {
      throw new DossierHttpError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, {
        error: 'unsupported_file',
        message: 'Formats acceptés : photo JPEG ou PNG, document PDF.',
      });
    }
    // Clé tirée au hasard : ni le nom du fichier ni l'identité du praticien n'y figurent
    const key = `pieces/${randomUUID()}.${content.extension}`;
    await this.storage.put(key, body, content.mime);
    try {
      const { id } = await this.repository.addPiece(sub, {
        type,
        key,
        sha256: content.sha256,
        mime: content.mime,
        size: content.size,
      });
      return { id };
    } catch (error) {
      await this.storage.remove(key).catch((cause: unknown) => {
        this.logger.error(`Fichier ${key} à retirer à la main : ${(cause as Error).message}`);
      });
      return toHttp(error);
    }
  }

  async removePiece(sub: string, pieceId: number): Promise<boolean> {
    const key = await this.repository.removePiece(sub, pieceId).catch(toHttp);
    if (key === null) return false;
    // Ligne retirée : un échec du stockage laisse un fichier orphelin, sans lien ni accès
    await this.storage.remove(key).catch((cause: unknown) => {
      this.logger.error(`Fichier ${key} à retirer à la main : ${(cause as Error).message}`);
    });
    return true;
  }

  // Critères 1 et 2 de US-040 : dossier complet → étape 2 et accusé de réception ;
  // pièce obligatoire manquante → refus avec la liste des pièces
  async submit(sub: string): Promise<SubmissionReceipt> {
    const result = await this.repository.submit(sub).catch(toHttp);
    if (result.status === 'missing') {
      throw new DossierHttpError(HttpStatus.UNPROCESSABLE_ENTITY, {
        error: 'missing_pieces',
        message: `Pièces obligatoires manquantes : ${result.missing
          .map((type) => PIECE_LABELS[type].toLowerCase())
          .join(', ')}.`,
        piecesManquantes: result.missing,
      });
    }
    // Après la validation de la transaction : un SMS ne part jamais pour une soumission
    // annulée. Un échec d'envoi n'annule pas la soumission (l'accusé est aussi à l'écran) ;
    // les nouvelles tentatives arrivent avec US-031.
    if (result.phone) {
      await this.sms.send(result.phone, receiptMessage(result.code)).catch((cause: unknown) => {
        this.logger.error(
          `Accusé de réception de ${result.code} non envoyé : ${(cause as Error).message}`,
        );
      });
    }
    return { code: result.code, etape: 2, soumisLe: result.submittedAt };
  }
}

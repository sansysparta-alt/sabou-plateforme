import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PIECE_LABELS,
  type FieldDossier,
  type FieldDossierCreate,
  type FieldDossierReferentials,
  type PractitionerPieceType,
  type SubmissionReceipt,
} from '@sabou/types';
import { AccountExistsError } from '../accounts/identity-admin';
import { ZoneContextError } from '../database/zone';
import { inspectPiece } from '../dossiers/piece-content';
import { PIECE_STORAGE, type PieceStorage } from '../dossiers/piece-storage';
import { CITIZEN_IDENTITY, type CitizenIdentity } from '../signup/citizen-identity';
import {
  FieldDossierForbiddenError,
  FieldDossierNotFoundError,
  FieldDossiersRepository,
  InvalidFieldReferenceError,
  PhoneTakenError,
} from './field-dossiers.repository';

const PHONE_TAKEN = {
  error: 'phone_taken',
  message:
    'Ce numéro a déjà un compte SABOU : le praticien dépose son dossier depuis l’application mobile.',
};

// Refus rédigés pour l'écran, avec un code pour le client
function toHttp(error: unknown): never {
  if (error instanceof ZoneContextError || error instanceof FieldDossierForbiddenError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message: 'Le dossier terrain est réservé à l’admin préfectoral, pour sa préfecture.',
    });
  }
  if (error instanceof FieldDossierNotFoundError) {
    throw new NotFoundException({
      error: 'not_found',
      message: 'Dossier terrain introuvable, ou déjà soumis.',
    });
  }
  if (error instanceof PhoneTakenError) throw new ConflictException(PHONE_TAKEN);
  if (error instanceof InvalidFieldReferenceError) {
    throw new HttpException(
      {
        error: 'invalid',
        message: 'Spécialité, sous-préfecture ou langue inconnue, ou hors de votre préfecture.',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  throw error;
}

// Dossier terrain (US-040c, §6.4) : l'agent préfectoral crée le compte du praticien (sans mot
// de passe), sa fiche et son dossier, dépose les pièces et soumet. Le praticien reçoit un SMS
// qui l'invite à définir son mot de passe par « mot de passe oublié » (US-069).
@Injectable()
export class FieldDossiersService {
  private readonly logger = new Logger('Dossiers terrain');

  constructor(
    private readonly repository: FieldDossiersRepository,
    @Inject(CITIZEN_IDENTITY) private readonly identity: CitizenIdentity,
    @Inject(PIECE_STORAGE) private readonly storage: PieceStorage,
  ) {}

  // Compte Keycloak d'abord (identifiant : le numéro), puis la base ; si la base refuse, le
  // compte Keycloak est retiré (ni compte orphelin, ni compte sans dossier)
  async open(
    sub: string,
    ip: string | undefined,
    input: FieldDossierCreate,
  ): Promise<{ code: string }> {
    let keycloakId: string;
    try {
      keycloakId = await this.identity.createAccount({
        username: input.telephone,
        firstName: input.prenom,
        lastName: input.nom,
        role: 'praticien',
      });
    } catch (error) {
      if (error instanceof AccountExistsError) throw new ConflictException(PHONE_TAKEN);
      throw error;
    }
    try {
      const created = await this.repository.open(sub, ip, keycloakId, input);
      this.logger.log(`Dossier terrain ${created.code} créé`);
      return created;
    } catch (error) {
      await this.identity.deleteAccount(keycloakId).catch((cause: unknown) => {
        this.logger.error(
          `Compte Keycloak ${keycloakId} à retirer à la main : ${(cause as Error).message}`,
        );
      });
      return toHttp(error);
    }
  }

  referentials(sub: string): Promise<FieldDossierReferentials> {
    return this.repository.referentials(sub).catch(toHttp);
  }

  list(sub: string): Promise<FieldDossier[]> {
    return this.repository.list(sub).catch(toHttp);
  }

  // Le fichier est déposé avant la ligne de la base ; si la base refuse, il est retiré
  async addPiece(
    sub: string,
    code: string,
    type: PractitionerPieceType,
    body: Buffer,
  ): Promise<{ id: number }> {
    const content = inspectPiece(body);
    if (!content) {
      throw new HttpException(
        {
          error: 'unsupported_file',
          message: 'Formats acceptés : photo JPEG ou PNG, document PDF.',
        },
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    const key = `pieces/${randomUUID()}.${content.extension}`;
    await this.storage.put(key, body, content.mime);
    try {
      return await this.repository.addPiece(sub, code, {
        type,
        key,
        sha256: content.sha256,
        mime: content.mime,
        size: content.size,
      });
    } catch (error) {
      await this.storage.remove(key).catch((cause: unknown) => {
        this.logger.error(`Fichier ${key} à retirer à la main : ${(cause as Error).message}`);
      });
      return toHttp(error);
    }
  }

  async removePiece(sub: string, code: string, pieceId: number): Promise<boolean> {
    const key = await this.repository.removePiece(sub, code, pieceId).catch(toHttp);
    if (key === null) return false;
    await this.storage.remove(key).catch((cause: unknown) => {
      this.logger.error(`Fichier ${key} à retirer à la main : ${(cause as Error).message}`);
    });
    return true;
  }

  async submit(sub: string, ip: string | undefined, code: string): Promise<SubmissionReceipt> {
    const result = await this.repository.submit(sub, ip, code).catch(toHttp);
    if (result.status === 'missing') {
      throw new HttpException(
        {
          error: 'missing_pieces',
          message: `Pièces obligatoires manquantes : ${result.missing
            .map((type) => PIECE_LABELS[type].toLowerCase())
            .join(', ')}.`,
          piecesManquantes: result.missing,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return { code: result.code, etape: 2, soumisLe: result.submittedAt };
  }
}

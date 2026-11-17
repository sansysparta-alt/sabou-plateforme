import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import {
  dossierCodeSchema,
  fieldVisitPlanSchema,
  fieldVisitReportSchema,
  type FieldVisit,
} from '@sabou/types';
import { parse } from '../accounts/accounts.controller';
import type { SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ZoneContextError } from '../database/zone';
import { inspectPiece, PieceTooLargeError, readLimited } from '../dossiers/piece-content';
import { PIECE_STORAGE, type PieceStorage } from '../dossiers/piece-storage';
import {
  VisitDateError,
  VisitDossierNotFoundError,
  VisitNotAllowedError,
  VisitPhotoError,
  VisitsRepository,
  VisitStaleError,
} from './visits.repository';

type SessionRequest = Request & { session?: SessionData };

// Types envoyés par le client pour la photo ; le format réel est lu dans le contenu
const UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/octet-stream',
];

// Refus de la base, rédigés pour l'écran, avec un code pour le client
function visitError(error: unknown): never {
  if (error instanceof ZoneContextError) throw new ForbiddenException();
  if (error instanceof VisitDossierNotFoundError) {
    throw new NotFoundException({
      error: 'not_found',
      message: 'Dossier introuvable dans votre zone.',
    });
  }
  if (error instanceof VisitNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message: 'Les visites de ce dossier relèvent de l’admin préfectoral de sa préfecture.',
    });
  }
  if (error instanceof VisitStaleError) {
    throw new ConflictException({
      error: 'stale',
      message: 'Ce dossier ou sa visite a changé entre-temps. Rechargez la liste.',
    });
  }
  if (error instanceof VisitDateError) {
    throw new UnprocessableEntityException({
      error: 'invalid_date',
      message:
        'Date refusée : une visite se planifie dans les 90 prochains jours, et se déclare réalisée entre la soumission du dossier et aujourd’hui.',
    });
  }
  if (error instanceof VisitPhotoError) {
    throw new ConflictException({
      error: 'photo_exists',
      message: 'La photo de la fiche se joint une seule fois, à une visite réalisée.',
    });
  }
  throw error;
}

// Visites terrain de l'admin préfectoral (US-041, UC-30). Réservé aux administrateurs
// connectés avec leur second facteur ; la base vérifie le rôle et la préfecture.
@Controller('api/dossiers/:code/visite')
@UseGuards(AdministratorGuard)
export class VisitsController {
  private readonly logger = new Logger('Visites');

  constructor(
    private readonly repository: VisitsRepository,
    @Inject(PIECE_STORAGE) private readonly storage: PieceStorage,
  ) {}

  // Planifier, ou replanifier : le rappel au praticien part la veille de la nouvelle date
  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  plan(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<FieldVisit> {
    const dossier = parse(dossierCodeSchema, code);
    const input = parse(fieldVisitPlanSchema, body);
    return this.repository
      .plan(req.session!.sub, req.ip, dossier, input.prevueLe)
      .catch(visitError);
  }

  // Enregistrer la visite réalisée avec son compte rendu signé (critère 2)
  @Post('compte-rendu')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  report(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<FieldVisit> {
    const dossier = parse(dossierCodeSchema, code);
    const input = parse(fieldVisitReportSchema, body);
    return this.repository.report(req.session!.sub, req.ip, dossier, input).catch(visitError);
  }

  // Photo facultative de la fiche papier. Corps : le fichier lui-même (5 Mo au plus).
  @Post(':visite/photo')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async photo(
    @Param('code') code: string,
    @Param('visite', ParseIntPipe) visite: number,
    @Req() req: SessionRequest,
  ): Promise<FieldVisit> {
    const dossier = parse(dossierCodeSchema, code);
    if (visite < 1) throw new BadRequestException();
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!UPLOAD_CONTENT_TYPES.includes(contentType)) throw unsupportedFile();
    let body: Buffer;
    try {
      body = await readLimited(req);
    } catch (error) {
      if (error instanceof PieceTooLargeError) {
        throw new HttpException(
          { error: 'too_large', message: 'La photo fait au plus 5 Mo.' },
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
      throw error;
    }
    const content = inspectPiece(body);
    if (!content) throw unsupportedFile();

    // Clé tirée au hasard : ni le dossier ni l'identité du praticien n'y figurent
    const key = `pieces/${randomUUID()}.${content.extension}`;
    await this.storage.put(key, body, content.mime);
    try {
      return await this.repository.attachPhoto(req.session!.sub, req.ip, dossier, visite, {
        key,
        sha256: content.sha256,
        mime: content.mime,
        size: content.size,
      });
    } catch (error) {
      await this.storage.remove(key).catch((cause: unknown) => {
        this.logger.error(`Fichier ${key} à retirer à la main : ${(cause as Error).message}`);
      });
      return visitError(error);
    }
  }
}

function unsupportedFile(): HttpException {
  return new HttpException(
    { error: 'unsupported_file', message: 'Formats acceptés : photo JPEG ou PNG, document PDF.' },
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  );
}

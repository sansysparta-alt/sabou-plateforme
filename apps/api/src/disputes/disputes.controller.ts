import {
  Body,
  Controller,
  ForbiddenException,
  Get,
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
  Query,
  Req,
  Res,
  UseGuards,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  disputeCodeSchema,
  disputeDecisionSchema,
  disputeMessageSchema,
  disputeOpenSchema,
  disputeOpinionSchema,
  zoneListQuerySchema,
  type DisputeDetail,
  type DisputeSummary,
  type PractitionerDisputes,
  type ZonePage,
} from '@sabou/types';
import { parse } from '../accounts/accounts.controller';
import type { SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { SignerUnavailableError } from '../certificates/vault-signer';
import { ZoneContextError } from '../database/zone';
import { PractitionerGuard } from '../dossiers/dossiers.controller';
import { inspectPiece, PieceTooLargeError, readLimited } from '../dossiers/piece-content';
import { PIECE_STORAGE, type PieceStorage } from '../dossiers/piece-storage';
import {
  DisputeNotAllowedError,
  DisputeNotFoundError,
  DisputeRefusedError,
  DisputesRepository,
} from './disputes.repository';

type SessionRequest = Request & { session?: SessionData };
type PractitionerRequest = Request & { practitioner?: { sub: string } };

// Types envoyés pour une pièce ; le format réel est lu dans le contenu
const UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/octet-stream',
];

// Refus de la base, rédigés pour l'écran, avec un code pour le client
function disputeError(error: unknown): never {
  if (error instanceof ZoneContextError) throw new ForbiddenException();
  if (error instanceof DisputeNotFoundError) {
    throw new NotFoundException({ error: 'not_found', message: 'Litige introuvable.' });
  }
  if (error instanceof DisputeNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message:
        'Action réservée à un autre profil ou à une autre étape : le régional instruit, la DG décide des recours après l’avis du régional.',
    });
  }
  if (error instanceof DisputeRefusedError) {
    throw new ConflictException({ error: error.code, message: error.message });
  }
  if (error instanceof SignerUnavailableError) {
    throw new HttpException(
      {
        error: 'signer_unavailable',
        message:
          'Le service de signature est indisponible : la décision n’est pas enregistrée. Réessayez dans quelques minutes.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  throw error;
}

// Lecture et dépôt des pièces, communs au praticien et à l'administration
class DisputeFiles {
  private readonly logger = new Logger('Litiges');

  constructor(
    private readonly repository: DisputesRepository,
    private readonly storage: PieceStorage,
  ) {}

  async upload(sub: string, req: Request, code: string): Promise<{ id: number }> {
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!UPLOAD_CONTENT_TYPES.includes(contentType)) throw unsupported();
    let body: Buffer;
    try {
      body = await readLimited(req);
    } catch (error) {
      if (error instanceof PieceTooLargeError) {
        throw new HttpException(
          { error: 'too_large', message: 'Une pièce fait au plus 5 Mo.' },
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
      throw error;
    }
    const content = inspectPiece(body);
    if (!content) throw unsupported();
    // Clé tirée au hasard : ni le litige ni l'identité du praticien n'y figurent
    const key = `litiges/${randomUUID()}.${content.extension}`;
    await this.storage.put(key, body, content.mime);
    try {
      return await this.repository.addPiece(sub, req.ip, code, {
        key,
        sha256: content.sha256,
        mime: content.mime,
        size: content.size,
      });
    } catch (error) {
      await this.storage.remove(key).catch((cause: unknown) => {
        this.logger.error(`Fichier ${key} à retirer à la main : ${(cause as Error).message}`);
      });
      return disputeError(error);
    }
  }

  async send(sub: string, code: string, id: number, res: Response): Promise<void> {
    const piece = await this.repository.piece(sub, code, id).catch(disputeError);
    const body = await this.storage.get(piece.key);
    if (!body) throw new NotFoundException({ error: 'not_found', message: 'Pièce introuvable.' });
    res
      .status(200)
      .set({
        'Content-Type': piece.mime,
        'Content-Length': String(body.length),
        'Content-Disposition': 'attachment',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      })
      .end(body);
  }
}

const unsupported = () =>
  new HttpException(
    { error: 'unsupported_file', message: 'Formats acceptés : photo JPEG ou PNG, document PDF.' },
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  );

// Espace du praticien (application mobile, jeton du client « sabou-mobile ») : il ouvre son
// litige ou son recours, écrit, joint des pièces et lit la décision motivée.
@Controller('api/praticien/litiges')
@UseGuards(PractitionerGuard)
export class PractitionerDisputesController {
  private readonly files: DisputeFiles;

  constructor(
    private readonly repository: DisputesRepository,
    @Inject(PIECE_STORAGE) storage: PieceStorage,
  ) {
    this.files = new DisputeFiles(repository, storage);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  mine(@Req() req: PractitionerRequest): Promise<PractitionerDisputes> {
    return this.repository.mine(req.practitioner!.sub).catch(disputeError);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  open(@Body() body: unknown, @Req() req: PractitionerRequest): Promise<{ code: string }> {
    return this.repository
      .open(req.practitioner!.sub, req.ip, parse(disputeOpenSchema, body))
      .catch(disputeError);
  }

  // L'avis du régional s'adresse à la DG : le praticien le lit une fois le recours décidé
  @Get(':code')
  @Header('Cache-Control', 'no-store')
  async detail(
    @Param('code') code: string,
    @Req() req: PractitionerRequest,
  ): Promise<DisputeDetail> {
    const detail = await this.repository
      .detail(req.practitioner!.sub, parse(disputeCodeSchema, code))
      .catch(disputeError);
    return detail.statut === 'resolu'
      ? detail
      : { ...detail, avisSens: null, avis: null, avisLe: null };
  }

  @Post(':code/messages')
  @HttpCode(204)
  message(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: PractitionerRequest,
  ): Promise<void> {
    const { contenu } = parse(disputeMessageSchema, body);
    return this.repository
      .message(req.practitioner!.sub, req.ip, parse(disputeCodeSchema, code), contenu)
      .catch(disputeError);
  }

  @Post(':code/pieces')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  upload(@Param('code') code: string, @Req() req: PractitionerRequest): Promise<{ id: number }> {
    return this.files.upload(req.practitioner!.sub, req, parse(disputeCodeSchema, code));
  }

  @Get(':code/pieces/:id')
  piece(
    @Param('code') code: string,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: PractitionerRequest,
    @Res() res: Response,
  ): Promise<void> {
    return this.files.send(req.practitioner!.sub, parse(disputeCodeSchema, code), id, res);
  }
}

// Administration (application de gestion, second facteur) : le régional instruit et décide
// les litiges ordinaires, rend un avis sur les recours ; la DG décide des recours.
@Controller('api/litiges')
@UseGuards(AdministratorGuard)
export class DisputesController {
  private readonly files: DisputeFiles;

  constructor(
    private readonly repository: DisputesRepository,
    @Inject(PIECE_STORAGE) storage: PieceStorage,
  ) {
    this.files = new DisputeFiles(repository, storage);
  }

  @Get('a-arbitrer')
  @Header('Cache-Control', 'no-store')
  queue(@Query() query: unknown, @Req() req: SessionRequest): Promise<ZonePage<DisputeSummary>> {
    return this.repository
      .queue(req.session!.sub, parse(zoneListQuerySchema, query))
      .catch(disputeError);
  }

  @Get(':code')
  @Header('Cache-Control', 'no-store')
  detail(@Param('code') code: string, @Req() req: SessionRequest): Promise<DisputeDetail> {
    return this.repository
      .detail(req.session!.sub, parse(disputeCodeSchema, code))
      .catch(disputeError);
  }

  @Post(':code/messages')
  @HttpCode(204)
  message(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<void> {
    const { contenu } = parse(disputeMessageSchema, body);
    return this.repository
      .message(req.session!.sub, req.ip, parse(disputeCodeSchema, code), contenu)
      .catch(disputeError);
  }

  @Post(':code/pieces')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  upload(@Param('code') code: string, @Req() req: SessionRequest): Promise<{ id: number }> {
    return this.files.upload(req.session!.sub, req, parse(disputeCodeSchema, code));
  }

  @Get(':code/pieces/:id')
  piece(
    @Param('code') code: string,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: SessionRequest,
    @Res() res: Response,
  ): Promise<void> {
    return this.files.send(req.session!.sub, parse(disputeCodeSchema, code), id, res);
  }

  @Post(':code/avis')
  @HttpCode(204)
  opinion(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<void> {
    return this.repository
      .opinion(
        req.session!.sub,
        req.ip,
        parse(disputeCodeSchema, code),
        parse(disputeOpinionSchema, body),
      )
      .catch(disputeError);
  }

  @Post(':code/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  decide(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<{ certificat: string | null }> {
    return this.repository
      .decide(
        req.session!.sub,
        req.ip,
        parse(disputeCodeSchema, code),
        parse(disputeDecisionSchema, body),
      )
      .catch(disputeError);
  }
}

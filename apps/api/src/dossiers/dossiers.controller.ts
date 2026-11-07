import {
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Body,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  pieceTypeSchema,
  practitionerProfileSchema,
  type PractitionerDossier,
  type SubmissionReceipt,
} from '@sabou/types';
import { CITIZEN_SESSION_COOKIE, readCookie } from '../auth/auth.controller';
import { SESSION_STORE, type SessionData, type SessionStore } from '../auth/session.store';
import { ENV, type Env } from '../config/env';
import { ZoneContextError } from '../database/zone';
import { PieceTooLargeError, readLimited } from './piece-content';
import { DossierHttpError, DossiersService } from './dossiers.service';

type SessionRequest = Request & { session?: SessionData };

const PRACTITIONER_ROLE = 'praticien';
// Types envoyés par le client pour un dépôt ; le format réel est lu dans le contenu
const UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/octet-stream',
];

// Praticien connecté au domaine public (session du site, lot D). Les écritures n'acceptent
// que l'origine du site : une autre page ne peut pas agir en son nom.
@Injectable()
export class PractitionerGuard implements CanActivate {
  private readonly siteOrigin: string;

  constructor(
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(ENV) env: Env,
  ) {
    this.siteOrigin = new URL(env.SITE_URL).origin;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SessionRequest>();
    const id = readCookie(req, CITIZEN_SESSION_COOKIE);
    const session = id ? await this.sessions.touch(id) : null;
    if (!session) throw new UnauthorizedException();
    if (!session.roles.includes(PRACTITIONER_ROLE)) throw new ForbiddenException();
    if (req.method !== 'GET' && req.headers.origin !== this.siteOrigin) {
      throw new ForbiddenException();
    }
    req.session = session;
    return true;
  }
}

// Compte inconnu ou suspendu entre-temps : refus, sans dire lequel des deux
async function asPractitioner<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ZoneContextError) throw new ForbiddenException();
    throw error;
  }
}

function invalid(message: string): DossierHttpError {
  return new DossierHttpError(HttpStatus.BAD_REQUEST, { error: 'invalid', message });
}

// Dossier de certification du praticien connecté (US-040a, UC-20). Aucun identifiant de
// praticien ni de dossier n'est accepté : c'est toujours le sien, lu en base.
@Controller('api/praticien')
@UseGuards(PractitionerGuard)
export class DossiersController {
  constructor(private readonly service: DossiersService) {}

  @Get('dossier')
  @Header('Cache-Control', 'no-store')
  async view(@Req() req: SessionRequest): Promise<PractitionerDossier> {
    const view = await asPractitioner(() => this.service.view(req.session!.sub));
    if (!view) throw new NotFoundException();
    return view;
  }

  @Put('fiche')
  @HttpCode(204)
  async saveProfile(@Body() body: unknown, @Req() req: SessionRequest): Promise<void> {
    const parsed = practitionerProfileSchema.safeParse(body);
    if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Fiche refusée.');
    await asPractitioner(() => this.service.saveProfile(req.session!.sub, parsed.data));
  }

  // Corps de la requête : le fichier lui-même (5 Mo au plus), sans formulaire multipart
  @Post('dossier/pieces/:type')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async addPiece(@Param('type') type: string, @Req() req: SessionRequest): Promise<{ id: number }> {
    const pieceType = pieceTypeSchema.safeParse(type);
    if (!pieceType.success) throw invalid('Type de pièce inconnu.');
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!UPLOAD_CONTENT_TYPES.includes(contentType)) {
      throw new DossierHttpError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, {
        error: 'unsupported_file',
        message: 'Formats acceptés : photo JPEG ou PNG, document PDF.',
      });
    }
    let body: Buffer;
    try {
      body = await readLimited(req);
    } catch (error) {
      if (error instanceof PieceTooLargeError) {
        throw new DossierHttpError(HttpStatus.PAYLOAD_TOO_LARGE, {
          error: 'too_large',
          message: 'Une pièce fait au plus 5 Mo.',
        });
      }
      throw error;
    }
    return asPractitioner(() => this.service.addPiece(req.session!.sub, pieceType.data, body));
  }

  @Delete('dossier/pieces/:id')
  @HttpCode(204)
  async removePiece(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: SessionRequest,
  ): Promise<void> {
    const removed = await asPractitioner(() => this.service.removePiece(req.session!.sub, id));
    if (!removed) throw new NotFoundException();
  }

  @Post('dossier/soumission')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  submit(@Req() req: SessionRequest): Promise<SubmissionReceipt> {
    return asPractitioner(() => this.service.submit(req.session!.sub));
  }
}

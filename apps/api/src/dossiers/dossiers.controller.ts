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
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  pieceTypeSchema,
  practitionerProfileSchema,
  type PractitionerDossier,
  type PractitionerReferentials,
  type SubmissionReceipt,
} from '@sabou/types';
import { CITIZEN_SESSION_COOKIE, readCookie } from '../auth/auth.controller';
import {
  BEARER,
  InvalidMobileTokenError,
  MOBILE_TOKEN_VERIFIER,
  type MobileIdentity,
  type MobileTokenVerifier,
} from '../auth/mobile-token';
import { SESSION_STORE, type SessionStore } from '../auth/session.store';
import { ENV, type Env } from '../config/env';
import { ZoneContextError } from '../database/zone';
import { PieceTooLargeError, readLimited } from './piece-content';
import { DossierHttpError, DossiersService } from './dossiers.service';

type PractitionerRequest = Request & { practitioner?: { sub: string } };

const PRACTITIONER_ROLE = 'praticien';
// Types envoyés par le client pour un dépôt ; le format réel est lu dans le contenu
const UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/octet-stream',
];

// Praticien connecté au domaine public, par l'une des deux voies :
// - le site (lot D) : cookie de session ; les écritures n'acceptent que l'origine du site,
//   une autre page ne peut pas agir en son nom ;
// - l'application mobile (US-040b, §2.29) : jeton d'accès « Bearer » du client
//   « sabou-mobile ». Aucun identifiant n'est envoyé d'office par le navigateur : pas de
//   contrôle d'origine (rien à forger d'une autre page).
// Dans les deux cas, le compte est relu en base à chaque requête : un compte suspendu est
// refusé aussitôt, même avec un jeton encore valable.
@Injectable()
export class PractitionerGuard implements CanActivate {
  private readonly siteOrigin: string;

  constructor(
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(MOBILE_TOKEN_VERIFIER) private readonly mobileTokens: MobileTokenVerifier,
    @Inject(ENV) env: Env,
  ) {
    this.siteOrigin = new URL(env.SITE_URL).origin;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PractitionerRequest>();
    const authorization = req.headers.authorization;
    const identity =
      authorization === undefined
        ? await this.fromCookie(req)
        : await this.fromBearer(authorization);
    if (!identity.roles.includes(PRACTITIONER_ROLE)) throw new ForbiddenException();
    req.practitioner = { sub: identity.sub };
    return true;
  }

  private async fromCookie(req: PractitionerRequest): Promise<MobileIdentity> {
    const id = readCookie(req, CITIZEN_SESSION_COOKIE);
    const session = id ? await this.sessions.touch(id) : null;
    if (!session) throw new UnauthorizedException();
    if (req.method !== 'GET' && req.headers.origin !== this.siteOrigin) {
      throw new ForbiddenException();
    }
    return session;
  }

  // En-tête présent mais mal formé ou jeton refusé : 401, sans retomber sur le cookie
  private async fromBearer(authorization: string): Promise<MobileIdentity> {
    const token = BEARER.exec(authorization)?.[1];
    if (!token) throw new UnauthorizedException();
    try {
      return await this.mobileTokens.verify(token);
    } catch (error) {
      if (error instanceof InvalidMobileTokenError) throw new UnauthorizedException();
      // Clés de Keycloak injoignables : l'application réessaiera, sa connexion reste valable
      throw new ServiceUnavailableException();
    }
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

  // Listes de la fiche (application mobile) ; petites, peu changeantes : cache privé d'une heure
  @Get('referentiels')
  @Header('Cache-Control', 'private, max-age=3600')
  referentials(): Promise<PractitionerReferentials> {
    return this.service.referentials();
  }

  @Get('dossier')
  @Header('Cache-Control', 'no-store')
  async view(@Req() req: PractitionerRequest): Promise<PractitionerDossier> {
    const view = await asPractitioner(() => this.service.view(req.practitioner!.sub));
    if (!view) throw new NotFoundException();
    return view;
  }

  @Put('fiche')
  @HttpCode(204)
  async saveProfile(@Body() body: unknown, @Req() req: PractitionerRequest): Promise<void> {
    const parsed = practitionerProfileSchema.safeParse(body);
    if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Fiche refusée.');
    await asPractitioner(() => this.service.saveProfile(req.practitioner!.sub, parsed.data));
  }

  // Corps de la requête : le fichier lui-même (5 Mo au plus), sans formulaire multipart
  @Post('dossier/pieces/:type')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async addPiece(
    @Param('type') type: string,
    @Req() req: PractitionerRequest,
  ): Promise<{ id: number }> {
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
    return asPractitioner(() => this.service.addPiece(req.practitioner!.sub, pieceType.data, body));
  }

  @Delete('dossier/pieces/:id')
  @HttpCode(204)
  async removePiece(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: PractitionerRequest,
  ): Promise<void> {
    const removed = await asPractitioner(() => this.service.removePiece(req.practitioner!.sub, id));
    if (!removed) throw new NotFoundException();
  }

  @Post('dossier/soumission')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  submit(@Req() req: PractitionerRequest): Promise<SubmissionReceipt> {
    return asPractitioner(() => this.service.submit(req.practitioner!.sub));
  }
}

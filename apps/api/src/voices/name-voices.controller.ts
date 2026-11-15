import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  nameVoiceMoveSchema,
  nameVoiceRecordSchema,
  nameVoiceTargetSchema,
  type NameVoices,
  type NameVoiceTarget,
} from '@sabou/types';
import { parse, type SessionRequest } from '../accounts/accounts.controller';
import { AdministratorGuard } from '../certification/certification.controller';
import { ZoneContextError } from '../database/zone';
import { PIECE_STORAGE, type PieceStorage } from '../dossiers/piece-storage';
import {
  NameVoiceConsentError,
  NameVoiceDepositError,
  NameVoiceNotAllowedError,
  NameVoiceNotFoundError,
  NameVoicesRepository,
  NameVoiceSelfValidationError,
  NameVoiceTransitionError,
} from './name-voices.repository';

function nameVoiceError(error: unknown): never {
  if (error instanceof ZoneContextError) throw new ForbiddenException();
  if (error instanceof NameVoiceSelfValidationError) {
    throw new ForbiddenException({
      error: 'self_validation',
      message: 'Vous avez enregistré cette voix : un autre valideur de la langue doit la valider.',
    });
  }
  if (error instanceof NameVoiceNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message: 'Ce geste ne fait pas partie de vos droits dans cette langue.',
    });
  }
  if (error instanceof NameVoiceNotFoundError) {
    throw new NotFoundException({ error: 'not_found', message: 'Voix ou fiche introuvable.' });
  }
  if (error instanceof NameVoiceConsentError) {
    throw new ConflictException({
      error: 'consent_missing',
      message:
        'Publication impossible : la personne qui parle n’a pas consenti à la publication de sa voix.',
    });
  }
  if (error instanceof NameVoiceTransitionError) {
    throw new ConflictException({
      error: 'stale',
      message: 'Le statut de cette voix a changé entre-temps. Rechargez la page.',
    });
  }
  if (error instanceof NameVoiceDepositError) {
    throw new ConflictException({
      error: 'voice_not_ready',
      message: 'La voix n’est pas encore traitée, ou elle a été déposée par un autre compte.',
    });
  }
  throw error;
}

// Voix du nom des plantes et des maladies (US-071) : tout administrateur connecté avec son
// second facteur consulte et écoute ; la base n'accepte chaque geste que du compte qui en a le
// droit dans la langue (enregistrer, traduire, valider) ou de la DG (publier).
@Controller('api/voix-des-noms')
@UseGuards(AdministratorGuard)
export class NameVoicesController {
  constructor(
    private readonly repository: NameVoicesRepository,
    @Inject(PIECE_STORAGE) private readonly storage: PieceStorage,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  targets(@Req() req: SessionRequest): Promise<NameVoiceTarget[]> {
    return this.repository.targets(req.session!.sub).catch(nameVoiceError);
  }

  @Get(':objet/:code')
  @Header('Cache-Control', 'no-store')
  detail(
    @Param('objet') objet: string,
    @Param('code') code: string,
    @Req() req: SessionRequest,
  ): Promise<NameVoices> {
    const target = parse(nameVoiceTargetSchema, { objet, code, langue: 'fr' });
    return this.repository
      .detail(req.session!.sub, target.objet, target.code)
      .catch(nameVoiceError);
  }

  // Enregistrer (ou remplacer) la voix : dépôt traité (POST /api/voix) du même compte
  @Post(':objet/:code/:langue')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  record(
    @Param() params: Record<string, string>,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<NameVoices> {
    const target = parse(nameVoiceTargetSchema, params);
    const { depot } = parse(nameVoiceRecordSchema, body);
    return this.repository
      .record(req.session!.sub, req.ip, target.objet, target.code, target.langue, depot)
      .catch(nameVoiceError);
  }

  @Post(':objet/:code/:langue/statut')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  move(
    @Param() params: Record<string, string>,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<NameVoices> {
    const target = parse(nameVoiceTargetSchema, params);
    const { vers, motif } = parse(nameVoiceMoveSchema, body);
    return this.repository
      .move(req.session!.sub, req.ip, target.objet, target.code, target.langue, vers, motif)
      .catch(nameVoiceError);
  }

  // Écoute : Opus (WebM) par défaut, secours AAC avec ?format=aac
  @Get(':objet/:code/:langue/audio')
  async audio(
    @Param() params: Record<string, string>,
    @Query('format') format: string | undefined,
    @Req() req: SessionRequest,
    @Res() res: Response,
  ): Promise<void> {
    const target = parse(nameVoiceTargetSchema, params);
    const file = await this.repository
      .file(req.session!.sub, target.objet, target.code, target.langue, format === 'aac')
      .catch(nameVoiceError);
    const body = await this.storage.get(file.key);
    if (!body) throw new NotFoundException({ error: 'not_found', message: 'Voix introuvable.' });
    res
      .status(200)
      .set({
        'Content-Type': file.mime,
        'Content-Length': String(body.length),
        // Un nouvel enregistrement change de fichier ; l'adresse, elle, reste : pas de cache long
        'Cache-Control': 'private, no-cache',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      })
      .end(body);
  }
}

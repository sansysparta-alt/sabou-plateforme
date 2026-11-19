import {
  BadRequestException,
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
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  nameVoiceRecordSchema,
  treatmentCodeSchema,
  treatmentSectionReviseSchema,
  treatmentSectionTargetSchema,
  treatmentVoiceMoveSchema,
  treatmentPlantVoiceTargetSchema,
  treatmentVoiceTargetSchema,
  voicePublicationSchema,
  type TreatmentVoices,
  type TreatmentVoiceTarget,
  type VoiceCoverage,
  type VoicePublication,
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
  NameVoiceSelfValidationError,
  NameVoiceTransitionError,
} from './name-voices.repository';
import {
  TreatmentNotRevisableError,
  TreatmentTextError,
  TreatmentVoicesRepository,
} from './treatment-voices.repository';

function treatmentVoiceError(error: unknown): never {
  if (error instanceof ZoneContextError) throw new ForbiddenException();
  if (error instanceof NameVoiceSelfValidationError) {
    throw new ForbiddenException({
      error: 'self_validation',
      message: 'Vous avez enregistré ou envoyé cette voix : un autre valideur doit la valider.',
    });
  }
  if (error instanceof NameVoiceNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message: 'Ce geste ne fait pas partie de vos droits sur ce traitement ou dans cette langue.',
    });
  }
  if (error instanceof NameVoiceNotFoundError) {
    throw new NotFoundException({ error: 'not_found', message: 'Traitement ou voix introuvable.' });
  }
  if (error instanceof TreatmentNotRevisableError) {
    throw new ConflictException({
      error: 'not_revisable',
      message: 'Ce traitement n’est plus modifiable à cette étape. Rechargez la page.',
    });
  }
  if (error instanceof TreatmentTextError) {
    throw new BadRequestException({
      error: 'invalid_text',
      message: 'Texte de la section : 1 à 4000 caractères.',
    });
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

// Voix des sections des traitements (US-075, puis US-072 à US-074) : tout administrateur
// connecté avec son second facteur consulte les traitements de sa zone ; la base n'accepte
// chaque geste que du compte qui en a le droit (préfectoral de la préfecture, droits par langue).
@Controller('api/voix-des-traitements')
@UseGuards(AdministratorGuard)
export class TreatmentVoicesController {
  constructor(
    private readonly repository: TreatmentVoicesRepository,
    @Inject(PIECE_STORAGE) private readonly storage: PieceStorage,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  targets(@Req() req: SessionRequest): Promise<TreatmentVoiceTarget[]> {
    return this.repository.targets(req.session!.sub).catch(treatmentVoiceError);
  }

  // Déclarées avant « :code » : couverture et publication groupée de la DG (US-074)
  @Get('couverture')
  @Header('Cache-Control', 'no-store')
  coverage(@Req() req: SessionRequest): Promise<VoiceCoverage> {
    return this.repository.coverage(req.session!.sub).catch(treatmentVoiceError);
  }

  @Post('publication')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  publish(@Body() body: unknown, @Req() req: SessionRequest): Promise<VoicePublication> {
    const { langue } = parse(voicePublicationSchema, body);
    return this.repository.publish(req.session!.sub, req.ip, langue).catch(treatmentVoiceError);
  }

  @Get(':code')
  @Header('Cache-Control', 'no-store')
  detail(@Param('code') code: string, @Req() req: SessionRequest): Promise<TreatmentVoices> {
    return this.repository
      .detail(req.session!.sub, parse(treatmentCodeSchema, code))
      .catch(treatmentVoiceError);
  }

  // Révision du texte français d'une section (préfectoral, traitement soumis)
  @Patch(':code/:type')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  revise(
    @Param() params: Record<string, string>,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<TreatmentVoices> {
    const target = parse(treatmentSectionTargetSchema, params);
    const text = parse(treatmentSectionReviseSchema, body);
    return this.repository
      .revise(req.session!.sub, req.ip, target.code, target.type, text)
      .catch(treatmentVoiceError);
  }

  // Enregistrer (ou remplacer) la voix : dépôt traité (POST /api/voix) du même compte
  @Post(':code/:type/:langue')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  record(
    @Param() params: Record<string, string>,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<TreatmentVoices> {
    const target = parse(treatmentVoiceTargetSchema, params);
    const { depot } = parse(nameVoiceRecordSchema, body);
    return this.repository
      .record(req.session!.sub, req.ip, target.code, target.type, target.langue, depot)
      .catch(treatmentVoiceError);
  }

  @Post(':code/:type/:langue/statut')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  move(
    @Param() params: Record<string, string>,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<TreatmentVoices> {
    const target = parse(treatmentVoiceTargetSchema, params);
    const move = parse(treatmentVoiceMoveSchema, body);
    return this.repository
      .move(req.session!.sub, req.ip, target.code, target.type, target.langue, move)
      .catch(treatmentVoiceError);
  }

  // US-081 : écoute du nom d'une plante dit par le praticien (préfectoral, Comité)
  @Get(':code/plante/:plante/audio')
  async plantAudio(
    @Param() params: Record<string, string>,
    @Query('format') format: string | undefined,
    @Req() req: SessionRequest,
    @Res() res: Response,
  ): Promise<void> {
    const target = parse(treatmentPlantVoiceTargetSchema, params);
    const file = await this.repository
      .plantFile(req.session!.sub, target.code, target.plante, format === 'aac')
      .catch(treatmentVoiceError);
    await this.send(res, file);
  }

  // Écoute : Opus (WebM) par défaut, secours AAC avec ?format=aac
  @Get(':code/:type/:langue/audio')
  async audio(
    @Param() params: Record<string, string>,
    @Query('format') format: string | undefined,
    @Req() req: SessionRequest,
    @Res() res: Response,
  ): Promise<void> {
    const target = parse(treatmentVoiceTargetSchema, params);
    const file = await this.repository
      .file(req.session!.sub, target.code, target.type, target.langue, format === 'aac')
      .catch(treatmentVoiceError);
    await this.send(res, file);
  }

  private async send(res: Response, file: { key: string; mime: string }): Promise<void> {
    const body = await this.storage.get(file.key);
    if (!body) throw new NotFoundException({ error: 'not_found', message: 'Voix introuvable.' });
    res
      .status(200)
      .set({
        'Content-Type': file.mime,
        'Content-Length': String(body.length),
        'Cache-Control': 'private, no-cache',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      })
      .end(body);
  }
}

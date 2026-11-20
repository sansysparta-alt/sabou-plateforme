import {
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import {
  practitionerVoiceKeySchema,
  practitionerVoiceTargetSchema,
  type PractitionerVoice,
} from '@sabou/types';
import {
  StudioActorGuard,
  studioSubject,
  withoutPractitioner,
  type StudioRequest,
} from './studio-actor';
import { parse } from '../accounts/accounts.controller';
import { PieceTooLargeError, readLimited } from '../dossiers/piece-content';
import { PIECE_STORAGE, type PieceStorage } from '../dossiers/piece-storage';
import { inspectVoice, VOICE_MAX_BYTES } from '../voices/voice-processing';
import { studioError } from './studio.controller';
import {
  StudioVoicesRepository,
  VoiceAbsentError,
  VoiceConsentRequiredError,
  VoiceRateLimitError,
} from './studio-voices.repository';

function voiceError(error: unknown): never {
  if (error instanceof VoiceConsentRequiredError) {
    throw new ConflictException({
      error: 'consent_required',
      message: 'Donnez votre consentement avant d’enregistrer votre voix.',
    });
  }
  if (error instanceof VoiceRateLimitError) {
    throw new HttpException(
      { error: 'too_many', message: 'Trop d’enregistrements en une heure. Réessayez plus tard.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (error instanceof VoiceAbsentError) {
    throw new NotFoundException({ error: 'not_found', message: 'Voix introuvable.' });
  }
  return studioError(error);
}

// US-081 : voix du praticien au Studio mobile, une par section et par nom de plante. Le corps
// est le fichier enregistré ; la clé ?cle= est tirée sur le téléphone, pour qu'un envoi rejoué
// au retour du réseau ne crée pas de doublon (R-DON-04, file d'envoi de l'application).
@Controller([
  'api/praticien/traitements/:code/voix/:cible/:objet',
  'api/terrain/praticiens/:praticien/traitements/:code/voix/:cible/:objet',
])
@UseGuards(StudioActorGuard)
export class StudioVoicesController {
  constructor(
    private readonly repository: StudioVoicesRepository,
    @Inject(PIECE_STORAGE) private readonly storage: PieceStorage,
  ) {}

  @Put()
  @Header('Cache-Control', 'no-store')
  async record(
    @Param() params: Record<string, string>,
    @Query('cle') key: string | undefined,
    @Req() req: StudioRequest,
  ): Promise<PractitionerVoice[]> {
    const target = parse(practitionerVoiceTargetSchema, withoutPractitioner(params));
    const clientKey = parse(practitionerVoiceKeySchema, key);
    const sub = studioSubject(req);
    // Envoi rejoué après une coupure : déjà reçu, le fichier n'est pas rangé une seconde fois
    if (await this.repository.known(sub, clientKey)) {
      return this.repository.list(sub, target.code).catch(voiceError);
    }
    let body: Buffer;
    try {
      body = await readLimited(req, VOICE_MAX_BYTES);
    } catch (error) {
      if (error instanceof PieceTooLargeError) {
        throw new HttpException(
          { error: 'too_large', message: 'L’enregistrement fait au plus 3 Mo.' },
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
      throw error;
    }
    const format = inspectVoice(body);
    if (!format) {
      throw new HttpException(
        { error: 'unsupported_file', message: 'Formats acceptés : M4A, WebM, Ogg, WAV ou MP3.' },
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    // Clé de stockage tirée au hasard ; rien de ce qu'envoie le téléphone n'y entre
    const storageKey = `voix/originaux/${randomUUID()}.${format.extension}`;
    await this.storage.put(storageKey, body, format.mime);
    try {
      await this.repository.deposit(
        sub,
        req.ip,
        target.code,
        target.cible,
        target.objet,
        clientKey,
        {
          key: storageKey,
          mime: format.mime,
          size: body.length,
          sha256: createHash('sha256').update(body).digest('hex'),
        },
      );
    } catch (error) {
      await this.storage.remove(storageKey).catch(() => undefined);
      voiceError(error);
    }
    return this.repository.list(sub, target.code).catch(voiceError);
  }

  @Delete()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async remove(
    @Param() params: Record<string, string>,
    @Req() req: StudioRequest,
  ): Promise<PractitionerVoice[]> {
    const target = parse(practitionerVoiceTargetSchema, withoutPractitioner(params));
    const sub = studioSubject(req);
    await this.repository
      .remove(sub, req.ip, target.code, target.cible, target.objet)
      .catch(voiceError);
    return this.repository.list(sub, target.code).catch(voiceError);
  }

  // Réécoute de la voix traitée (le téléphone efface son fichier après l'envoi)
  @Get('audio')
  async audio(
    @Param() params: Record<string, string>,
    @Req() req: StudioRequest,
    @Res() res: Response,
  ): Promise<void> {
    const target = parse(practitionerVoiceTargetSchema, withoutPractitioner(params));
    const file = await this.repository
      .file(studioSubject(req), target.code, target.cible, target.objet)
      .catch(voiceError);
    const body = await this.storage.get(file.key);
    if (!body) throw new NotFoundException({ error: 'not_found', message: 'Voix introuvable.' });
    res
      .status(200)
      .set({
        'Content-Type': file.mime,
        'Content-Length': String(body.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      })
      .end(body);
  }
}

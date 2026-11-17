import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { SessionRequest } from '../accounts/accounts.controller';
import { AdministratorGuard } from '../certification/certification.controller';
import { ZoneContextError } from '../database/zone';
import { PieceTooLargeError, readLimited } from '../dossiers/piece-content';
import { PIECE_STORAGE, type PieceStorage } from '../dossiers/piece-storage';
import { inspectVoice, VOICE_MAX_BYTES } from './voice-processing';
import {
  VoiceDepositNotAllowedError,
  VoicesRepository,
  type VoiceDepositState,
} from './voices.repository';

function unsupportedVoice(): HttpException {
  return new HttpException(
    {
      error: 'unsupported_file',
      message: 'Formats acceptés : enregistrement WebM, Ogg, M4A, WAV ou MP3.',
    },
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  );
}

// Dépôt d'une voix (US-070, UC-73) par un administrateur connecté avec son second facteur
// (enregistrement des noms de plantes et de maladies, US-071). Le corps est le fichier
// lui-même ; le consentement de la personne qui parle est dans l'adresse (?consentement=true).
// La voix est traitée ensuite par VoiceProcessor ; son état se lit par GET /api/voix/depots/:id.
@Controller('api/voix')
@UseGuards(AdministratorGuard)
export class VoicesController {
  constructor(
    private readonly repository: VoicesRepository,
    @Inject(PIECE_STORAGE) private readonly storage: PieceStorage,
  ) {}

  @Post()
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async deposit(
    @Query('consentement') consent: string | undefined,
    @Req() req: SessionRequest,
  ): Promise<VoiceDepositState> {
    if (consent !== 'true' && consent !== 'false') {
      throw new BadRequestException({
        error: 'consent_required',
        message: 'Indiquez si la personne qui parle consent à la publication de sa voix.',
      });
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
    if (!format) throw unsupportedVoice();
    // Clé tirée au hasard ; le nom du fichier envoyé n'est jamais repris
    const key = `voix/originaux/${randomUUID()}.${format.extension}`;
    await this.storage.put(key, body, format.mime);
    try {
      return await this.repository.deposit(
        req.session!.sub,
        req.ip,
        {
          key,
          mime: format.mime,
          size: body.length,
          sha256: createHash('sha256').update(body).digest('hex'),
        },
        consent === 'true',
      );
    } catch (error) {
      await this.storage.remove(key).catch(() => undefined);
      if (error instanceof ZoneContextError || error instanceof VoiceDepositNotAllowedError) {
        throw new ForbiddenException();
      }
      throw error;
    }
  }

  @Get('depots/:depot')
  @Header('Cache-Control', 'no-store')
  async state(
    @Param('depot', ParseIntPipe) depot: number,
    @Req() req: SessionRequest,
  ): Promise<VoiceDepositState> {
    const state = await this.repository.state(req.session!.sub, depot);
    // Dépôt d'un autre compte : introuvable, comme un dépôt qui n'existe pas
    if (!state) throw new NotFoundException({ error: 'not_found', message: 'Dépôt introuvable.' });
    return state;
  }
}

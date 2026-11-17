import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import {
  PLANT_IMAGE_MAX_BYTES,
  plantCodeSchema,
  plantFieldsSchema,
  plantImageFieldsSchema,
  plantSearchSchema,
  plantUpdateSchema,
  plantValidationSchema,
  type PlantDetail,
  type PlantSummary,
} from '@sabou/types';
import { parse, requireAppOrigin, type SessionRequest } from '../accounts/accounts.controller';
import { SESSION_COOKIE, readCookie } from '../auth/auth.controller';
import { SESSION_STORE, type SessionStore } from '../auth/session.store';
import { ENV, type Env } from '../config/env';
import { ZoneContextError } from '../database/zone';
import { PieceTooLargeError, readLimited } from '../dossiers/piece-content';
import { PIECE_STORAGE, type PieceStorage } from '../dossiers/piece-storage';
import {
  PlantImageNotFoundError,
  PlantNameTakenError,
  PlantNotAllowedError,
  PlantNotFoundError,
  PlantPrincipalImageError,
  PlantsRepository,
  PlantStaleError,
  PlantAlreadyValidatedError,
  PlantValidationNotAllowedError,
} from './plants.repository';

// Fiches plantes réservées à la DG et au Comité scientifique (UC-05, R-PLA-05), connectés
// avec leur second facteur ; la base vérifie aussi le rôle. Une modification ne peut venir que
// de l'application de gestion (en-tête Origin).
@Injectable()
export class PlantEditorGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SessionRequest>();
    requireAppOrigin(req, this.env);
    const id = readCookie(req, SESSION_COOKIE);
    const session = id ? await this.sessions.touch(id) : null;
    if (!session) throw new UnauthorizedException();
    const editor = session.roles.includes('dg') || session.roles.includes('comite');
    if (!editor || !session.secondFactor) throw new ForbiddenException();
    req.session = session;
    return true;
  }
}

// Photos acceptées, reconnues à leur contenu (jamais au type annoncé ni au nom du fichier)
const IMAGE_SIGNATURES: { mime: string; extension: string; matches: (b: Buffer) => boolean }[] = [
  {
    mime: 'image/jpeg',
    extension: 'jpg',
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    extension: 'png',
    matches: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    extension: 'webp',
    matches: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  },
];
const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'];

export function inspectImage(body: Buffer) {
  const match = IMAGE_SIGNATURES.find(({ matches }) => body.length > 12 && matches(body));
  if (!match) return null;
  return {
    mime: match.mime,
    extension: match.extension,
    sha256: createHash('sha256').update(body).digest('hex'),
    size: body.length,
  };
}

// Description d'une photo envoyée avec le fichier : dans l'adresse, le corps étant le fichier
function imageFieldsFromQuery(query: Record<string, unknown>) {
  return parse(plantImageFieldsSchema, {
    alt: query.alt,
    altEn: query.altEn || null,
    type: query.type,
    principale: query.principale === 'true',
  });
}

// Refus de la base, rédigés pour l'écran, avec un code pour le client
function plantError(error: unknown): never {
  if (error instanceof ZoneContextError || error instanceof PlantNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message: 'Les fiches plantes sont réservées à la DG et au Comité scientifique.',
    });
  }
  if (error instanceof PlantValidationNotAllowedError) {
    throw new ForbiddenException({
      error: 'validation_not_allowed',
      message: 'Seul le Comité scientifique valide une fiche plante.',
    });
  }
  if (error instanceof PlantAlreadyValidatedError) {
    throw new ConflictException({
      error: 'already_validated',
      message: 'Cette fiche est déjà validée.',
    });
  }
  if (error instanceof PlantNotFoundError) {
    throw new NotFoundException({ error: 'not_found', message: 'Fiche plante introuvable.' });
  }
  if (error instanceof PlantImageNotFoundError) {
    throw new NotFoundException({ error: 'image_not_found', message: 'Photo introuvable.' });
  }
  if (error instanceof PlantNameTakenError) {
    throw new ConflictException({
      error: 'name_taken',
      message: `Ce nom scientifique est déjà celui de la fiche ${error.code}.`,
    });
  }
  if (error instanceof PlantStaleError) {
    throw new ConflictException({
      error: 'stale',
      message: 'Cette fiche a été modifiée entre-temps. Rechargez-la avant de l’enregistrer.',
    });
  }
  if (error instanceof PlantPrincipalImageError) {
    throw new ConflictException({
      error: 'principal_required',
      message: 'Pour changer de photo principale, marquez une autre photo comme principale.',
    });
  }
  throw error;
}

function unsupportedImage(): HttpException {
  return new HttpException(
    { error: 'unsupported_file', message: 'Formats acceptés : photo JPEG, PNG ou WebP.' },
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  );
}

const plantCode = (code: string) => parse(plantCodeSchema, code);

// Fiches plantes du Dictionnaire (US-050, UC-05)
@Controller('api/plantes')
@UseGuards(PlantEditorGuard)
export class PlantsController {
  private readonly logger = new Logger(PlantsController.name);

  constructor(
    private readonly repository: PlantsRepository,
    @Inject(PIECE_STORAGE) private readonly storage: PieceStorage,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: unknown, @Req() req: SessionRequest): Promise<PlantSummary[]> {
    const { q } = parse(plantSearchSchema, query);
    return this.repository.list(req.session!.sub, q || undefined).catch(plantError);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(@Body() body: unknown, @Req() req: SessionRequest): Promise<PlantDetail> {
    const fields = parse(plantFieldsSchema, body);
    return this.repository.create(req.session!.sub, req.ip, fields).catch(plantError);
  }

  @Get(':code')
  @Header('Cache-Control', 'no-store')
  detail(@Param('code') code: string, @Req() req: SessionRequest): Promise<PlantDetail> {
    return this.repository.detail(req.session!.sub, plantCode(code)).catch(plantError);
  }

  @Patch(':code')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<PlantDetail> {
    const input = parse(plantUpdateSchema, body);
    return this.repository
      .update(req.session!.sub, req.ip, plantCode(code), input)
      .catch(plantError);
  }

  // Validation par le Comité scientifique (US-051, UC-52)
  @Post(':code/validation')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  validate(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<PlantDetail> {
    const { vueLe } = parse(plantValidationSchema, body);
    return this.repository
      .validate(req.session!.sub, req.ip, plantCode(code), vueLe)
      .catch(plantError);
  }

  // Le corps est le fichier lui-même (pas de formulaire multipart) ; sa description est dans
  // l'adresse : ?alt=…&altEn=…&type=feuille&principale=true
  @Post(':code/images')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async addImage(
    @Param('code') code: string,
    @Query() query: Record<string, unknown>,
    @Req() req: SessionRequest,
  ): Promise<PlantDetail> {
    const plant = plantCode(code);
    const fields = imageFieldsFromQuery(query);
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!UPLOAD_CONTENT_TYPES.includes(contentType)) throw unsupportedImage();
    let body: Buffer;
    try {
      body = await readLimited(req, PLANT_IMAGE_MAX_BYTES);
    } catch (error) {
      if (error instanceof PieceTooLargeError) {
        throw new HttpException(
          { error: 'too_large', message: 'La photo fait au plus 5 Mo.' },
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
      throw error;
    }
    const content = inspectImage(body);
    if (!content) throw unsupportedImage();
    // Clé tirée au hasard : le nom du fichier envoyé n'est jamais repris
    const key = `plantes/${randomUUID()}.${content.extension}`;
    await this.storage.put(key, body, content.mime);
    try {
      return await this.repository.addImage(
        req.session!.sub,
        req.ip,
        plant,
        {
          key,
          sha256: content.sha256,
          mime: content.mime,
          size: content.size,
        },
        fields,
      );
    } catch (error) {
      await this.removeFile(key);
      return plantError(error);
    }
  }

  @Patch(':code/images/:image')
  @Header('Cache-Control', 'no-store')
  updateImage(
    @Param('code') code: string,
    @Param('image', ParseIntPipe) image: number,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<PlantDetail> {
    const fields = parse(plantImageFieldsSchema, body);
    return this.repository
      .updateImage(req.session!.sub, req.ip, plantCode(code), image, fields)
      .catch(plantError);
  }

  @Delete(':code/images/:image')
  @Header('Cache-Control', 'no-store')
  async removeImage(
    @Param('code') code: string,
    @Param('image', ParseIntPipe) image: number,
    @Req() req: SessionRequest,
  ): Promise<PlantDetail> {
    const { plant, key } = await this.repository
      .removeImage(req.session!.sub, req.ip, plantCode(code), image)
      .catch(plantError);
    await this.removeFile(key);
    return plant;
  }

  // Photo servie par l'API après contrôle des droits : le stockage n'a pas d'adresse publique
  @Get(':code/images/:image')
  async image(
    @Param('code') code: string,
    @Param('image', ParseIntPipe) image: number,
    @Req() req: SessionRequest,
    @Res() res: Response,
  ): Promise<void> {
    if (image < 1) throw new BadRequestException();
    const file = await this.repository
      .imageFile(req.session!.sub, plantCode(code), image)
      .catch(plantError);
    const body = await this.storage.get(file.key);
    if (!body)
      throw new NotFoundException({ error: 'image_not_found', message: 'Photo introuvable.' });
    res
      .status(200)
      .set({
        'Content-Type': file.mime,
        'Content-Length': String(body.length),
        // Le contenu d'une photo ne change jamais : une nouvelle photo a un autre identifiant
        'Cache-Control': 'private, max-age=86400, immutable',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      })
      .end(body);
  }

  private async removeFile(key: string): Promise<void> {
    await this.storage.remove(key).catch((cause: unknown) => {
      this.logger.error(`Fichier ${key} à retirer à la main : ${(cause as Error).message}`);
    });
  }
}

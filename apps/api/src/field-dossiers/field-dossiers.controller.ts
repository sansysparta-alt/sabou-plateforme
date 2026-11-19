import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  dossierCodeSchema,
  fieldDossierCreateSchema,
  pieceTypeSchema,
  verifierDesignationSchema,
  type FieldDossier,
  type FieldDossierDesignations,
  type FieldDossierReferentials,
  type SubmissionReceipt,
} from '@sabou/types';
import { parse } from '../accounts/accounts.controller';
import type { SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { PieceTooLargeError, readLimited } from '../dossiers/piece-content';
import { FieldDossiersService } from './field-dossiers.service';

type SessionRequest = Request & { session?: SessionData };

// Types envoyés par le client pour un dépôt ; le format réel est lu dans le contenu
const UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/octet-stream',
];

// Dossier terrain de l'admin préfectoral (US-040c, §6.4), dans l'application de gestion.
// Administrateur connecté avec son second facteur, depuis l'application de gestion (garde) ;
// la base vérifie le rôle préfectoral, la préfecture et l'auteur du dossier.
@Controller('api/dossiers-terrain')
@UseGuards(AdministratorGuard)
export class FieldDossiersController {
  constructor(private readonly service: FieldDossiersService) {}

  @Get('referentiels')
  @Header('Cache-Control', 'no-store')
  referentials(@Req() req: SessionRequest): Promise<FieldDossierReferentials> {
    return this.service.referentials(req.session!.sub);
  }

  // US-040d : dossiers terrain de la région et agents désignables (admin régional)
  @Get('designations')
  @Header('Cache-Control', 'no-store')
  designations(@Req() req: SessionRequest): Promise<FieldDossierDesignations> {
    return this.service.designations(req.session!.sub);
  }

  @Post(':code/verificateur')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  designate(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<void> {
    const { agentId } = parse(verifierDesignationSchema, body);
    return this.service.designate(
      req.session!.sub,
      req.ip,
      parse(dossierCodeSchema, code),
      agentId,
    );
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() req: SessionRequest): Promise<FieldDossier[]> {
    return this.service.list(req.session!.sub);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  open(@Body() body: unknown, @Req() req: SessionRequest): Promise<{ code: string }> {
    return this.service.open(req.session!.sub, req.ip, parse(fieldDossierCreateSchema, body));
  }

  // Corps de la requête : le fichier lui-même (5 Mo au plus), sans formulaire multipart
  @Post(':code/pieces/:type')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async addPiece(
    @Param('code') code: string,
    @Param('type') type: string,
    @Req() req: SessionRequest,
  ): Promise<{ id: number }> {
    const dossier = parse(dossierCodeSchema, code);
    const pieceType = parse(pieceTypeSchema, type);
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!UPLOAD_CONTENT_TYPES.includes(contentType)) {
      throw new HttpException(
        {
          error: 'unsupported_file',
          message: 'Formats acceptés : photo JPEG ou PNG, document PDF.',
        },
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
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
    return this.service.addPiece(req.session!.sub, dossier, pieceType, body);
  }

  @Delete(':code/pieces/:id')
  @HttpCode(204)
  async removePiece(
    @Param('code') code: string,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: SessionRequest,
  ): Promise<void> {
    const removed = await this.service.removePiece(
      req.session!.sub,
      parse(dossierCodeSchema, code),
      id,
    );
    if (!removed) throw new NotFoundException();
  }

  @Post(':code/soumission')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  submit(@Param('code') code: string, @Req() req: SessionRequest): Promise<SubmissionReceipt> {
    return this.service.submit(req.session!.sub, req.ip, parse(dossierCodeSchema, code));
  }
}

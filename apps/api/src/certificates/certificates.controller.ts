import {
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  certificateNumberSchema,
  dossierCodeSchema,
  zoneListQuerySchema,
  type ApprovalItem,
  type ApprovalResult,
  type CertificateView,
  type ZonePage,
} from '@sabou/types';
import { parse } from '../accounts/accounts.controller';
import type { SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import {
  DecisionNotAllowedError,
  DossierNotFoundError,
  StaleDossierError,
} from '../certification/certification.repository';
import { ZoneContextError } from '../database/zone';
import { renderCertificatePdf } from './certificate-pdf';
import {
  CertificateNotFoundError,
  CertificatesRepository,
  type CertificateSource,
} from './certificates.repository';
import { SignerUnavailableError } from './vault-signer';

type SessionRequest = Request & { session?: SessionData };

const logger = new Logger('Certificats');

// Refus traduits en réponses : message rédigé pour l'écran, code pour le client
function approvalError(error: unknown): never {
  if (error instanceof ZoneContextError) throw new ForbiddenException();
  if (error instanceof DossierNotFoundError) {
    throw new NotFoundException({ error: 'not_found', message: 'Dossier introuvable.' });
  }
  if (error instanceof DecisionNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message: 'Seule la Direction Générale approuve un dossier et émet le certificat.',
    });
  }
  if (error instanceof StaleDossierError) {
    throw new ConflictException({
      error: 'stale',
      message: 'Ce dossier n’attend plus d’approbation. Rechargez la liste.',
    });
  }
  if (error instanceof SignerUnavailableError) {
    // La cause (coffre injoignable, réponse inattendue) va au journal, pas à l'écran
    logger.error(`Signature impossible : ${error.message}`);
    throw new ServiceUnavailableException({
      error: 'signer_unavailable',
      message:
        'Le service de signature est indisponible : aucun certificat n’a été émis. Réessayez dans quelques minutes.',
    });
  }
  throw error;
}

// Approbation par la DG et certificat signé (US-045, UC-60)
@Controller('api')
@UseGuards(AdministratorGuard)
export class CertificatesController {
  constructor(private readonly repository: CertificatesRepository) {}

  // Dossiers en attente d'approbation (étape 5)
  @Get('dossiers/approbation')
  @Header('Cache-Control', 'no-store')
  approvals(@Query() query: unknown, @Req() req: SessionRequest): Promise<ZonePage<ApprovalItem>> {
    const parsed = parse(zoneListQuerySchema, query);
    return this.repository.listApproval(req.session!.sub, parsed).catch(approvalError);
  }

  // Approuver le dossier et émettre le certificat signé ; le dossier passe à l'étape 6
  @Post('dossiers/:code/approbation')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  approve(@Param('code') code: string, @Req() req: SessionRequest): Promise<ApprovalResult> {
    const dossier = parse(dossierCodeSchema, code);
    return this.repository.approve(req.session!.sub, req.ip, dossier).catch(approvalError);
  }

  // Certificat à imprimer (page de l'application de gestion)
  @Get('certificats/:numero')
  @Header('Cache-Control', 'no-store')
  async certificate(
    @Param('numero') numero: string,
    @Req() req: SessionRequest,
  ): Promise<CertificateView> {
    const parsed = parse(certificateNumberSchema, numero);
    try {
      return await this.repository.get(req.session!.sub, parsed);
    } catch (error) {
      if (error instanceof CertificateNotFoundError) {
        throw new NotFoundException({ error: 'not_found', message: 'Certificat introuvable.' });
      }
      return approvalError(error);
    }
  }

  // PDF du certificat (US-091), même contenu que la page imprimable ; jamais mis en cache
  @Get('certificats/:numero/pdf')
  async certificatePdf(
    @Param('numero') numero: string,
    @Req() req: SessionRequest,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = parse(certificateNumberSchema, numero);
    let source: CertificateSource;
    try {
      source = await this.repository.source(req.session!.sub, parsed);
    } catch (error) {
      if (error instanceof CertificateNotFoundError) {
        throw new NotFoundException({ error: 'not_found', message: 'Certificat introuvable.' });
      }
      return approvalError(error);
    }
    const body = await renderCertificatePdf(source.view, source.qr);
    res
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="certificat-${parsed}.pdf"`,
        'Content-Length': String(body.length),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(body);
  }
}

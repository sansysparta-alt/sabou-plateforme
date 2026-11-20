import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  exportIdSchema,
  exportRequestSchema,
  reportCommentSchema,
  reportIdSchema,
  reportPrepareSchema,
  reportReturnSchema,
  reportSendSchema,
  type ExportEntry,
  type MonthlyReport,
  type MonthlyReportList,
} from '@sabou/types';
import { parse } from '../accounts/accounts.controller';
import type { SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import { ZoneContextError } from '../database/zone';
import {
  dashboardDocument,
  monthlyReportDocument,
  type DashboardSnapshot,
  type MonthlyReportSnapshot,
} from './document';
import { renderPdf } from './pdf';
import {
  ReportNotAllowedError,
  ReportNotFoundError,
  ReportRefusedError,
  ReportsRepository,
  type ExportFile,
} from './reports.repository';
import { renderXlsx } from './xlsx';

type SessionRequest = Request & { session?: SessionData };

function reportError(error: unknown): never {
  if (error instanceof ZoneContextError) throw new ForbiddenException();
  if (error instanceof ReportNotFoundError) {
    throw new NotFoundException({ error: 'not_found', message: 'Introuvable dans votre zone.' });
  }
  if (error instanceof ReportNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message:
        'Action réservée : le préfectoral et le régional rédigent leur rapport ; son destinataire seul peut le renvoyer.',
    });
  }
  if (error instanceof ReportRefusedError) {
    throw new ConflictException({ error: error.code, message: error.message });
  }
  throw error;
}

// Rapports mensuels (US-091, UC-36, R-MOD-09) : préfectoral → régional → DG ; administration
// connectée avec son second facteur ; la base décide de tout (zone, auteur, destinataire).
@Controller('api/rapports-mensuels')
@UseGuards(AdministratorGuard)
export class MonthlyReportsController {
  constructor(private readonly repository: ReportsRepository) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() req: SessionRequest): Promise<MonthlyReportList> {
    return this.repository.list(req.session!.sub).catch(reportError);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  prepare(@Body() body: unknown, @Req() req: SessionRequest): Promise<{ id: number }> {
    const { mois } = parse(reportPrepareSchema, body);
    return this.repository.prepare(req.session!.sub, req.ip, mois).catch(reportError);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  detail(@Param('id') id: string, @Req() req: SessionRequest): Promise<MonthlyReport> {
    return this.repository.detail(req.session!.sub, parse(reportIdSchema, id)).catch(reportError);
  }

  @Patch(':id/commentaire')
  @HttpCode(204)
  comment(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<void> {
    const { commentaire } = parse(reportCommentSchema, body);
    return this.repository
      .comment(req.session!.sub, req.ip, parse(reportIdSchema, id), commentaire)
      .catch(reportError);
  }

  @Post(':id/envoi')
  @HttpCode(204)
  send(@Param('id') id: string, @Body() body: unknown, @Req() req: SessionRequest): Promise<void> {
    const { calculeLe } = parse(reportSendSchema, body);
    return this.repository
      .send(req.session!.sub, req.ip, parse(reportIdSchema, id), calculeLe)
      .catch(reportError);
  }

  @Post(':id/renvoi')
  @HttpCode(204)
  giveBack(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: SessionRequest,
  ): Promise<void> {
    const { motif } = parse(reportReturnSchema, body);
    return this.repository
      .giveBack(req.session!.sub, req.ip, parse(reportIdSchema, id), motif)
      .catch(reportError);
  }
}

const MIME = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

// Nom de fichier sûr : lettres sans accents, chiffres et tirets (en-tête HTTP en ASCII)
export function fileName(file: ExportFile, id: number): string {
  const zone = file.contenu.zone
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  const what =
    file.type === 'tableau_de_bord'
      ? 'tableau-de-bord'
      : `rapport-${(file.contenu as MonthlyReportSnapshot).mois.slice(0, 7)}`;
  return `sabou-${what}-${zone || 'zone'}-${id}.${file.format}`;
}

export async function renderExport(file: ExportFile): Promise<Buffer> {
  const document =
    file.type === 'tableau_de_bord'
      ? dashboardDocument(file.contenu as DashboardSnapshot, file.auteur, file.le)
      : monthlyReportDocument(file.contenu as MonthlyReportSnapshot, file.le);
  return file.format === 'pdf' ? renderPdf(document) : renderXlsx(document);
}

// Exports PDF et XLSX et leur historique (US-091) : la base garde la photographie des données,
// le fichier est régénéré à chaque téléchargement (rien n'est stocké hors de la base)
@Controller('api/exports')
@UseGuards(AdministratorGuard)
export class ExportsController {
  constructor(private readonly repository: ReportsRepository) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  history(@Req() req: SessionRequest): Promise<ExportEntry[]> {
    return this.repository.history(req.session!.sub).catch(reportError);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  create(@Body() body: unknown, @Req() req: SessionRequest): Promise<{ id: number }> {
    return this.repository
      .create(req.session!.sub, req.ip, parse(exportRequestSchema, body))
      .catch(reportError);
  }

  @Get(':id/fichier')
  async download(
    @Param('id') id: string,
    @Req() req: SessionRequest,
    @Res() res: Response,
  ): Promise<void> {
    const exportId = parse(exportIdSchema, id);
    const file = await this.repository.file(req.session!.sub, exportId).catch(reportError);
    const body = await renderExport(file);
    res
      .status(200)
      .set({
        'Content-Type': MIME[file.format],
        'Content-Disposition': `attachment; filename="${fileName(file, exportId)}"`,
        'Content-Length': String(body.length),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(body);
  }
}

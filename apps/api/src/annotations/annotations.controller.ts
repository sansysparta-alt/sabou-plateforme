import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Injectable,
  NotFoundException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { sql } from 'kysely';
import {
  annotationTargetSchema,
  newAnnotationSchema,
  type Annotation,
  type AnnotationTargetRef,
  type NewAnnotation,
} from '@sabou/types';
import { parse, type SessionRequest } from '../accounts/accounts.controller';
import { normalizeIp } from '../audit/audit.log';
import { AdministratorGuard } from '../certification/certification.controller';
import { DATABASE, type Database } from '../database/database';
import { inZone, ZoneContextError, type ZoneTrx } from '../database/zone';

export class AnnotationNotAllowedError extends Error {}
export class AnnotationTargetNotFoundError extends Error {}

// Messages de annotation_ajouter (20261116160000_annotations_comite.sql), prouvés sur un vrai
// PostgreSQL (packages/db/test/annotations-comite.test.ts)
function translate(error: unknown): never {
  const message = (error as { message?: string }).message ?? '';
  if (message.includes('réservées au Comité scientifique')) throw new AnnotationNotAllowedError();
  if (/Objet \w+ \S+ introuvable/.test(message)) throw new AnnotationTargetNotFoundError();
  throw error;
}

// Annotations du Comité (US-064). La lecture est cloisonnée par la base (Comité et DG
// seulement) ; l'écriture passe par annotation_ajouter, qui vérifie le rôle.
@Injectable()
export class AnnotationsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list(sub: string, target: AnnotationTargetRef): Promise<Annotation[]> {
    return inZone(this.db, sub, (trx) => this.read(trx, target));
  }

  add(sub: string, ip: string | undefined, input: NewAnnotation): Promise<Annotation[]> {
    return inZone(this.db, sub, async (trx) => {
      await sql`SELECT sabou.audit_contexte(${normalizeIp(ip)}::inet)`.execute(trx);
      await sql`SELECT 1 FROM sabou.annotation_ajouter(${input.type}, ${input.code},
                                                      ${input.avis}, ${input.contenu})`
        .execute(trx)
        .catch(translate);
      return this.read(trx, input);
    });
  }

  // Plus récentes d'abord
  private async read(trx: ZoneTrx, { type, code }: AnnotationTargetRef): Promise<Annotation[]> {
    const { rows } = await sql<Annotation>`
      SELECT a.id::int, a.avis, a.contenu, u.prenom || ' ' || u.nom AS auteur,
             to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS le
        FROM sabou.annotation_comite a
        JOIN sabou.utilisateur u ON u.id = a.auteur_id
       WHERE a.objet_type = ${type}
         AND a.objet_id = CASE ${type}
               WHEN 'recette' THEN (SELECT r.id FROM sabou.recette r WHERE r.code = ${code})
               ELSE (SELECT p.id FROM sabou.plante p WHERE p.code = ${code}) END
       ORDER BY a.created_at DESC, a.id DESC`.execute(trx);
    return rows;
  }
}

function annotationError(error: unknown): never {
  if (error instanceof ZoneContextError || error instanceof AnnotationNotAllowedError) {
    throw new ForbiddenException({
      error: 'not_allowed',
      message: 'Les annotations sont réservées au Comité scientifique.',
    });
  }
  if (error instanceof AnnotationTargetNotFoundError) {
    throw new NotFoundException({ error: 'not_found', message: 'Objet annoté introuvable.' });
  }
  throw error;
}

// Annotations d'un traitement ou d'une plante (US-064, UC-51) : administrateurs connectés avec
// leur second facteur ; la base ne les montre qu'au Comité et à la DG, et n'accepte que celles
// du Comité.
@Controller('api/annotations')
@UseGuards(AdministratorGuard)
export class AnnotationsController {
  constructor(private readonly repository: AnnotationsRepository) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() query: unknown, @Req() req: SessionRequest): Promise<Annotation[]> {
    const target = parse(annotationTargetSchema, query);
    return this.repository.list(req.session!.sub, target).catch(annotationError);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  add(@Body() body: unknown, @Req() req: SessionRequest): Promise<Annotation[]> {
    const input = parse(newAnnotationSchema, body);
    return this.repository.add(req.session!.sub, req.ip, input).catch(annotationError);
  }
}

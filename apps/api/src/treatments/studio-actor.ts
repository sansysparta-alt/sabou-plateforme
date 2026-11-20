import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionData } from '../auth/session.store';
import { AdministratorGuard } from '../certification/certification.controller';
import type { ZoneSubject } from '../database/zone';
import { PractitionerGuard } from '../dossiers/dossiers.controller';

// Les routes du Studio servent deux auteurs (US-082, décisions du maître d'œuvre du
// 19 novembre 2026) :
// - le praticien, sur ses propres traitements : /api/praticien/… (jeton « sabou-mobile ») ;
// - l'agent préfectoral qui numérise la recette d'un praticien de sa préfecture :
//   /api/terrain/praticiens/:praticien/… (jeton « sabou-terrain » avec second facteur, ou
//   session de la gestion). Le praticien visé est transmis à la base, qui vérifie la
//   préfecture de l'agent et pose la mention « saisi par » (studio_praticien()).
// Une seule source de règles : mêmes routes, mêmes fonctions de la base.

export type StudioRequest = Request & {
  practitioner?: { sub: string };
  session?: SessionData;
};

// Code d'un praticien (PR-1042) ; tout le reste est refusé avant la base
const PRACTITIONER_CODE = /^PR-\d{1,9}$/;

function targetOf(req: StudioRequest): string | undefined {
  const value: unknown = req.params.praticien;
  return typeof value === 'string' ? value : undefined;
}

@Injectable()
export class StudioActorGuard implements CanActivate {
  constructor(
    private readonly practitioners: PractitionerGuard,
    private readonly administrators: AdministratorGuard,
  ) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<StudioRequest>();
    if (req.params.praticien === undefined) return this.practitioners.canActivate(context);
    const target = targetOf(req);
    if (target === undefined || !PRACTITIONER_CODE.test(target)) {
      throw new BadRequestException({ error: 'invalid', message: 'Praticien inconnu.' });
    }
    return this.administrators.canActivate(context);
  }
}

// Auteur de la requête pour la base : le praticien lui-même, ou l'agent pour le praticien visé
export function studioSubject(req: StudioRequest): ZoneSubject {
  const target = targetOf(req);
  if (target === undefined) return req.practitioner!.sub;
  return { sub: req.session!.sub, onBehalfOf: target };
}

// Paramètres de la route sans le praticien visé (les schémas de cible sont stricts)
export function withoutPractitioner(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter(([name]) => name !== 'praticien'));
}

import { ForbiddenException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { SignupHttpError } from './signup.service';

// Outils communs aux requêtes sans session : inscription (US-014, US-066) et mot de passe
// oublié (US-069).

// Corps refusé : 400 avec le premier message de la validation (en français)
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new SignupHttpError(HttpStatus.BAD_REQUEST, {
      error: 'invalid',
      message: result.error.issues[0]?.message ?? 'Données refusées.',
    });
  }
  return result.data;
}

// Requêtes sans session de l'inscription (US-014, US-066) et du mot de passe oublié (US-069).
// Un navigateur envoie toujours l'en-tête Origin avec un POST : seule celle du site est
// acceptée, pour qu'une autre page ne déclenche pas d'envoi de SMS. Une requête sans Origin ne
// vient pas d'un navigateur (application mobile) ; un tel client pourrait de toute façon forger
// l'en-tête : la protection contre les abus reste la limite par numéro et par adresse IP
// (05_Choix_Techniques.md §2.62).
export function requireSiteOrApp(req: Request, siteOrigin: string): void {
  const { origin } = req.headers;
  if (origin !== undefined && origin !== siteOrigin) throw new ForbiddenException();
}

// Limite atteinte : délai d'attente dans l'en-tête Retry-After (RFC 9110)
export async function withRetryAfter<T>(res: Response, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SignupHttpError && error.getStatus() === 429) {
      const { retryAfter } = error.getResponse() as { retryAfter?: number };
      if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
    }
    throw error;
  }
}

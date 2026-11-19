import {
  Body,
  Controller,
  ForbiddenException,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  signupCodeRequestSchema,
  signupCompleteRequestSchema,
  signupVerifyRequestSchema,
  type SignupVerifyResult,
} from '@sabou/types';
import { ENV, type Env } from '../config/env';
import { SignupHttpError, SignupService, type SignupCompleteResult } from './signup.service';

function parse<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new SignupHttpError(HttpStatus.BAD_REQUEST, {
      error: 'invalid',
      message: result.error.issues[0]?.message ?? 'Données refusées.',
    });
  }
  return result.data;
}

// Inscription d'un citoyen (lot D : US-014) ou d'un praticien (US-040a, depuis l'application
// mobile : US-066). Sans session. Un navigateur envoie toujours l'en-tête Origin avec un POST :
// seule celle du site est acceptée, pour qu'une autre page ne déclenche pas d'envoi de SMS.
// Une requête sans Origin ne vient pas d'un navigateur (application mobile) ; un tel client
// pourrait de toute façon forger l'en-tête : la protection contre les abus reste la limite
// par numéro et par adresse IP (05_Choix_Techniques.md §2.62).
@Controller('api/inscription')
export class SignupController {
  private readonly siteOrigin: string;

  constructor(
    @Inject(ENV) env: Env,
    private readonly service: SignupService,
  ) {
    this.siteOrigin = new URL(env.SITE_URL).origin;
  }

  @Post('code')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async code(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    this.requireSiteOrApp(req);
    const { phone } = parse(signupCodeRequestSchema, body);
    await this.withRetryAfter(res, () => this.service.requestCode(phone, req.ip));
  }

  @Post('verification')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  verify(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignupVerifyResult> {
    this.requireSiteOrApp(req);
    const { phone, code } = parse(signupVerifyRequestSchema, body);
    return this.withRetryAfter(res, () => this.service.verify(phone, code, req.ip));
  }

  @Post('compte')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  complete(@Body() body: unknown, @Req() req: Request): Promise<SignupCompleteResult> {
    this.requireSiteOrApp(req);
    const { ticket, profile, firstName, lastName, password } = parse(
      signupCompleteRequestSchema,
      body,
    );
    return this.service.complete(
      ticket,
      { profile, firstName, ...(lastName ? { lastName } : {}) },
      password,
      req.ip,
    );
  }

  private requireSiteOrApp(req: Request): void {
    const { origin } = req.headers;
    if (origin !== undefined && origin !== this.siteOrigin) throw new ForbiddenException();
  }

  // Limite atteinte : délai d'attente dans l'en-tête Retry-After (RFC 9110)
  private async withRetryAfter<T>(res: Response, work: () => Promise<T>): Promise<T> {
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
}

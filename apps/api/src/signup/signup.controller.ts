import { Body, Controller, Header, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  signupCodeRequestSchema,
  signupCompleteRequestSchema,
  signupVerifyRequestSchema,
  type SignupVerifyResult,
} from '@sabou/types';
import { ENV, type Env } from '../config/env';
import { parseBody, requireSiteOrApp, withRetryAfter } from './public-http';
import { SignupService, type SignupCompleteResult } from './signup.service';

// Inscription d'un citoyen (lot D : US-014) ou d'un praticien (US-040a, depuis l'application
// mobile : US-066). Sans session : origine contrôlée par requireSiteOrApp (origin.ts).
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
    requireSiteOrApp(req, this.siteOrigin);
    const { phone } = parseBody(signupCodeRequestSchema, body);
    await withRetryAfter(res, () => this.service.requestCode(phone, req.ip));
  }

  @Post('verification')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  verify(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignupVerifyResult> {
    requireSiteOrApp(req, this.siteOrigin);
    const { phone, code } = parseBody(signupVerifyRequestSchema, body);
    return withRetryAfter(res, () => this.service.verify(phone, code, req.ip));
  }

  @Post('compte')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  complete(@Body() body: unknown, @Req() req: Request): Promise<SignupCompleteResult> {
    requireSiteOrApp(req, this.siteOrigin);
    const { ticket, profile, firstName, lastName, password } = parseBody(
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
}

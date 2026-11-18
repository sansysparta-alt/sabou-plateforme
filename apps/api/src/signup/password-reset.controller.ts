import { Body, Controller, Header, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  passwordResetCodeRequestSchema,
  passwordResetCompleteRequestSchema,
  passwordResetVerifyRequestSchema,
  type PasswordResetVerifyResult,
} from '@sabou/types';
import { ENV, type Env } from '../config/env';
import { PasswordResetService } from './password-reset.service';
import { parseBody, requireSiteOrApp, withRetryAfter } from './public-http';

// Mot de passe oublié par SMS (US-069) : site public (citoyen) et application mobile
// (praticien). Sans session ; origine contrôlée comme pour l'inscription.
@Controller('api/mot-de-passe-oublie')
export class PasswordResetController {
  private readonly siteOrigin: string;

  constructor(
    @Inject(ENV) env: Env,
    private readonly service: PasswordResetService,
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
    const { phone } = parseBody(passwordResetCodeRequestSchema, body);
    await withRetryAfter(res, () => this.service.requestCode(phone, req.ip));
  }

  @Post('verification')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  verify(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PasswordResetVerifyResult> {
    requireSiteOrApp(req, this.siteOrigin);
    const { phone, code } = parseBody(passwordResetVerifyRequestSchema, body);
    return withRetryAfter(res, () => this.service.verify(phone, code, req.ip));
  }

  @Post('nouveau')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async complete(@Body() body: unknown, @Req() req: Request): Promise<void> {
    requireSiteOrApp(req, this.siteOrigin);
    const { ticket, password } = parseBody(passwordResetCompleteRequestSchema, body);
    await this.service.complete(ticket, password, req.ip);
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Header,
  Headers,
  HttpCode,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { verifySyncToken, type SyncAgent } from './sync-token';
import { SYNC_REPOSITORY, type SyncRepository } from './sync.repository';
import { uploadSchema, type UploadResult } from './sync.schema';

// Écritures faites hors réseau, envoyées par le téléphone au retour de la connexion.
// PowerSync ne fait que lire : tout ce qui entre passe ici, puis par la règle R-DON-04.
@Controller('sync')
export class SyncController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SYNC_REPOSITORY) private readonly repository: SyncRepository,
  ) {}

  @Post('upload')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async upload(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<{ results: UploadResult[] }> {
    const agent = await this.authenticate(authorization);
    // Contrôle de principe ; la base revérifie le rôle, le statut et la zone de l'agent
    if (agent.role !== 'prefectoral') throw new ForbiddenException();
    const parsed = uploadSchema.safeParse(body);
    // Le détail de la validation n'est pas renvoyé : il pourrait recopier le contenu
    if (!parsed.success) throw new BadRequestException('Lot invalide');
    return { results: await this.repository.receive(agent.id, parsed.data.operations) };
  }

  private async authenticate(authorization: string | undefined): Promise<SyncAgent> {
    const token = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException();
    try {
      return await verifySyncToken(token, this.env.SYNC_JWT_SECRET);
    } catch {
      throw new UnauthorizedException();
    }
  }
}

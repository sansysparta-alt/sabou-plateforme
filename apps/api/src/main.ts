import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Un lot de synchronisation peut porter plusieurs dossiers de 256 Kio au plus chacun
  app.useBodyParser('json', { limit: '1mb' });
  // Ferme proprement les connexions à la base quand le conteneur s'arrête
  app.enableShutdownHooks();
  await app.listen(app.get<Env>(ENV).PORT);
}

void bootstrap();

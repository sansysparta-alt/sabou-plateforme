import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Ferme proprement les connexions à la base quand le conteneur s'arrête
  app.enableShutdownHooks();
  await app.listen(app.get<Env>(ENV).PORT);
}

void bootstrap();

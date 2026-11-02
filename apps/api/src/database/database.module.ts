import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { createDatabase, DATABASE, type Database } from './database';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ENV],
      useFactory: (env: Env) => createDatabase(env.DATABASE_URL),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // Ferme les connexions à l'arrêt du conteneur (SIGTERM)
  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}

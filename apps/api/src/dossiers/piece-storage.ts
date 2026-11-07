import { AwsClient } from 'aws4fetch';

export const PIECE_STORAGE = Symbol('PIECE_STORAGE');

// Fichiers des pièces, hors de la base (§2.5 : stockage objet S3 auto-hébergé, SeaweedFS).
// La base garde la clé de l'objet et son empreinte ; jamais d'adresse publique : un fichier
// n'est servi que par l'API, après contrôle des droits.
export interface PieceStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface S3Settings {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

// Requêtes S3 signées (SigV4) par aws4fetch : une petite bibliothèque sans dépendance, plutôt
// que le SDK d'AWS et sa centaine de paquets (§2.26)
export class S3PieceStorage implements PieceStorage {
  private readonly client: AwsClient;

  constructor(private readonly settings: S3Settings) {
    this.client = new AwsClient({
      accessKeyId: settings.accessKey,
      secretAccessKey: settings.secretKey,
      service: 's3',
      region: settings.region,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const response = await this.client.fetch(this.url(key), {
      method: 'PUT',
      body: new Uint8Array(body),
      headers: { 'Content-Type': contentType },
    });
    if (!response.ok) throw new Error(`Stockage S3 : dépôt refusé (${response.status})`);
  }

  async remove(key: string): Promise<void> {
    const response = await this.client.fetch(this.url(key), { method: 'DELETE' });
    // 404 : déjà retiré
    if (!response.ok && response.status !== 404) {
      throw new Error(`Stockage S3 : retrait refusé (${response.status})`);
    }
  }

  // Poste local seulement (S3_CREATE_BUCKET) : crée le seau s'il n'existe pas
  async ensureBucket(): Promise<void> {
    const url = `${this.settings.endpoint.replace(/\/$/, '')}/${this.settings.bucket}`;
    const response = await this.client.fetch(url, { method: 'PUT' });
    // 409 : le seau existe déjà
    if (!response.ok && response.status !== 409) {
      throw new Error(`Stockage S3 : création du seau refusée (${response.status})`);
    }
  }

  // Adresse « chemin » (http://hôte/seau/clé), celle que SeaweedFS accepte
  private url(key: string): string {
    const path = key.split('/').map(encodeURIComponent).join('/');
    return `${this.settings.endpoint.replace(/\/$/, '')}/${this.settings.bucket}/${path}`;
  }
}

import { readFile } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

// Signature des certificats par le coffre (US-045, 05_Choix_Techniques.md §2.34) : moteur
// Transit d'OpenBao, clé Ed25519 « sabou-dg » non exportable. L'API envoie les octets à
// signer et reçoit la signature ; la clé privée n'est jamais lue par l'application
// (critère 2). Le jeton de l'API ne permet que deux appels : signer, lire les clés publiques.

export const CERTIFICATE_SIGNER = Symbol('CERTIFICATE_SIGNER');

export interface SigningKeyVersion {
  version: number;
  // Clé publique Ed25519 brute, 32 octets
  publicKey: Uint8Array;
}

export interface CertificateSigner {
  // Version courante de la clé : son identifiant est écrit dans l'en-tête signé du QR
  currentKey(): Promise<SigningKeyVersion>;
  // Signature Ed25519 (64 octets) avec cette version, et pas une autre
  sign(input: Uint8Array, version: number): Promise<Uint8Array>;
}

// Coffre injoignable, refus ou réponse inattendue : l'approbation n'a pas lieu
export class SignerUnavailableError extends Error {}

const TIMEOUT_MS = 5000;
// Taille maximale des octets à signer : un QR fait moins de 1 024 caractères
const INPUT_MAX_BYTES = 2048;

@Injectable()
export class VaultSigner implements CertificateSigner {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async currentKey(): Promise<SigningKeyVersion> {
    const body = await this.call('GET', `transit/keys/${this.env.OPENBAO_KEY}`);
    const data = (body as { data?: { latest_version?: unknown; keys?: unknown; type?: unknown } })
      .data;
    const version = data?.latest_version;
    if (data?.type !== 'ed25519' || !Number.isInteger(version) || (version as number) < 1) {
      throw new SignerUnavailableError('Clé du coffre : type ou version inattendus');
    }
    const entry = (data.keys as Record<string, { public_key?: unknown }> | undefined)?.[
      String(version)
    ];
    const publicKey =
      typeof entry?.public_key === 'string' ? Buffer.from(entry.public_key, 'base64') : null;
    if (!publicKey || publicKey.length !== 32) {
      throw new SignerUnavailableError('Clé du coffre : clé publique invalide');
    }
    return { version: version as number, publicKey: new Uint8Array(publicKey) };
  }

  async sign(input: Uint8Array, version: number): Promise<Uint8Array> {
    if (input.length === 0 || input.length > INPUT_MAX_BYTES) {
      throw new SignerUnavailableError('Données à signer de taille inattendue');
    }
    const body = await this.call('POST', `transit/sign/${this.env.OPENBAO_KEY}`, {
      input: Buffer.from(input).toString('base64'),
      key_version: version,
    });
    const signature = (body as { data?: { signature?: unknown } }).data?.signature;
    // Format de Transit : « vault:v<version>:<base64> » ; la version doit être celle demandée
    const match = typeof signature === 'string' ? /^vault:v(\d+):([A-Za-z0-9+/=]+)$/.exec(signature) : null;
    if (!match || Number(match[1]) !== version) {
      throw new SignerUnavailableError('Signature du coffre : format ou version inattendus');
    }
    const bytes = Buffer.from(match[2]!, 'base64');
    if (bytes.length !== 64) throw new SignerUnavailableError('Signature du coffre : taille inattendue');
    return new Uint8Array(bytes);
  }

  private async call(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<unknown> {
    let token: string;
    try {
      token = (await readFile(this.env.OPENBAO_TOKEN_FILE, 'utf8')).trim();
    } catch {
      throw new SignerUnavailableError('Jeton du coffre illisible');
    }
    let response: Response;
    try {
      response = await fetch(new URL(`/v1/${path}`, this.env.OPENBAO_ADDR), {
        method,
        headers: {
          'X-Vault-Token': token,
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new SignerUnavailableError('Coffre injoignable');
    }
    // Le corps d'une erreur n'est pas recopié : il pourrait citer le chemin ou la politique
    if (!response.ok) throw new SignerUnavailableError(`Coffre : réponse ${response.status}`);
    return response.json().catch(() => {
      throw new SignerUnavailableError('Coffre : réponse illisible');
    });
  }
}

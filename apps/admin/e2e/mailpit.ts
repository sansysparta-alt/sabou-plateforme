// Boîte aux lettres de développement (Mailpit, compose.yaml) : e-mails remis par Keycloak
import { expect } from '@playwright/test';

const env = process.env;
const MAILPIT = `http://localhost:${env.MAILPIT_PORT ?? '8025'}`;

interface MessageSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

export interface Mail {
  subject: string;
  text: string;
}

// E-mails reçus par une adresse, du plus récent au plus ancien
export async function mailsTo(address: string): Promise<Mail[]> {
  const query = encodeURIComponent(`to:"${address}"`);
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${query}`);
  expect(response.ok).toBe(true);
  const { messages } = (await response.json()) as { messages: MessageSummary[] };
  return Promise.all(
    messages.map(async (summary) => {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${summary.ID}`)).json()) as {
        Text: string;
      };
      return { subject: summary.Subject, text: message.Text };
    }),
  );
}

// Attend un e-mail dont l'objet correspond, et le renvoie
export async function waitForMail(address: string, subject: RegExp): Promise<Mail> {
  let found: Mail | undefined;
  await expect
    .poll(
      async () => {
        found = (await mailsTo(address)).find((mail) => subject.test(mail.subject));
        return found !== undefined;
      },
      { timeout: 20_000, intervals: [500] },
    )
    .toBe(true);
  return found!;
}

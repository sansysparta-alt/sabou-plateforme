// US-031 : textes des SMS et envoi de la file ; US-041 : rappel de visite la veille. La file elle-même (transaction, délais,
// nombre d'essais, échec) est tenue et testée par la base : packages/db/test/notification-sms.test.ts.
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import type { NotificationQueue, QueuedSms, SmsOutcome } from './notification-queue';
import { JournalSmsSender, SmsSendError, signupCodeMessage, type SmsSender } from './sms';
import { BATCH_SIZE, SmsDispatcher } from './sms-dispatcher';
import { isSingleGsm7Sms, notificationText, SMS_MAX_LENGTH } from './sms-messages';
import { createSmsSender } from './sms.module';

// Code de dossier le plus long envisagé (un million de dossiers)
const CODE = 'DS-1000000';
const ALL_MESSAGES: [string, number | undefined][] = [
  ['dossier.soumis', 2],
  ['dossier.valide', 3],
  ['dossier.valide', 4],
  ['dossier.valide', 5],
  ['dossier.valide', 6],
  ['dossier.rejete', 1],
  ['dossier.rejete', 2],
  ['dossier.rejete', 3],
  ['dossier.rejete', 4],
  ['dossier.rejet_definitif', 5],
  ['dossier.publie', 6],
];

describe('Textes : un seul SMS par message, en français', () => {
  it.each(ALL_MESSAGES)('%s (étape %s) tient en un SMS GSM 7 bits', (modele, etape) => {
    const text = notificationText({ modele, objet: CODE, parametres: { etape } });
    expect(text).toMatch(/^SABOU : /);
    expect(text).toContain(CODE);
    expect(text!.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
    expect(isSingleGsm7Sms(text!)).toBe(true);
  });

  it('US-041 : le rappel de visite tient en un SMS et donne la date et l’heure', () => {
    const text = notificationText({
      modele: 'visite.rappel',
      objet: CODE,
      parametres: { prevueLe: '2026-11-20T09:30' },
    });
    expect(text).toBe(
      "SABOU : rappel, l'administration de votre préfecture vous rend visite le 20/11/2026 à 09h30 pour votre dossier DS-1000000. Merci de vous rendre disponible.",
    );
    expect(isSingleGsm7Sms(text!)).toBe(true);
  });

  it('US-041 : un rappel sans date valable est une erreur définitive', () => {
    for (const prevueLe of [undefined, '2026-11-20', 'demain']) {
      expect(
        notificationText({ modele: 'visite.rappel', objet: CODE, parametres: { prevueLe } }),
      ).toBe(null);
    }
  });

  it('US-046 : traitements en attente, nombre et raison, en un SMS', () => {
    const text = (quota: number, contenu: number, objet = 'DS-1041') =>
      notificationText({
        modele: 'dossier.traitements_en_attente',
        objet,
        parametres: { etape: 6, quota, contenu },
      });
    expect(text(1, 0)).toBe(
      'SABOU : 1 traitement du dossier DS-1041 est en attente : formule gratuite limitée à 3, certifié au passage à GOLD.',
    );
    expect(text(0, 2)).toBe(
      'SABOU : 2 traitements du dossier DS-1041 sont en attente : plante ou section à compléter.',
    );
    expect(text(2, 0)).toBe(
      'SABOU : 2 traitements du dossier DS-1041 sont en attente : formule gratuite limitée à 3, certifiés au passage à GOLD.',
    );
    // Le plus long : deux raisons, 999 traitements, code de dossier le plus long
    const longest = text(500, 499, CODE)!;
    expect(longest).toContain('certifiés au passage à GOLD ; plante ou section');
    expect(isSingleGsm7Sms(longest)).toBe(true);
    for (const [quota, contenu] of [
      [0, 0],
      [-1, 2],
      [1.5, 0],
      [1000, 0],
    ] as const) {
      expect(text(quota, contenu)).toBe(null);
    }
  });

  it('le code d’inscription tient aussi en un SMS', () => {
    expect(isSingleGsm7Sms(signupCodeMessage('123456', 10))).toBe(true);
  });

  it('dit l’étape suivante à la validation, l’étape de retour au rejet', () => {
    const text = (modele: string, etape: number) =>
      notificationText({ modele, objet: 'DS-1041', parametres: { etape } });
    expect(text('dossier.valide', 4)).toBe(
      "SABOU : votre dossier DS-1041 est validé. Il passe à l'expertise du Comité scientifique.",
    );
    expect(text('dossier.rejete', 2)).toBe(
      'SABOU : votre dossier DS-1041 est renvoyé à la vérification sur le terrain. Le motif est dans votre espace SABOU.',
    );
  });

  // Le motif n'est pas un paramètre du message (la base n'y met que l'étape d'arrivée)
  it('renvoie à l’espace du praticien pour le motif du rejet (décision du maître d’œuvre)', () => {
    for (const [modele, etape] of ALL_MESSAGES.filter(([m]) => m.includes('rejet'))) {
      expect(notificationText({ modele, objet: CODE, parametres: { etape } })).toContain('motif');
    }
  });

  it('refuse un modèle inconnu ou une étape absente (erreur définitive)', () => {
    expect(notificationText({ modele: 'recette.validee', objet: CODE, parametres: {} })).toBe(null);
    expect(notificationText({ modele: 'dossier.valide', objet: CODE, parametres: {} })).toBe(null);
    expect(
      notificationText({ modele: 'dossier.rejete', objet: CODE, parametres: { etape: 9 } }),
    ).toBe(null);
  });

  it('détecte un caractère qui ferait passer le SMS en UCS-2 (facturé double)', () => {
    expect(isSingleGsm7Sms('Votre dossier est reçu')).toBe(false);
    expect(isSingleGsm7Sms('Vous êtes certifié')).toBe(false);
    expect(isSingleGsm7Sms('l’administration')).toBe(false);
    expect(isSingleGsm7Sms('x'.repeat(161))).toBe(false);
    expect(isSingleGsm7Sms("l'administration de votre préfecture")).toBe(true);
  });
});

// File en mémoire : enregistre les résultats rendus par l'envoi
function fakeQueue(messages: QueuedSms[], outcome: SmsOutcome = 'envoyee') {
  const recorded: [string, string | null, boolean][] = [];
  const queue: NotificationQueue = {
    queueVisitReminders: vi.fn(async () => 0),
    take: vi.fn(async (limit: number) => messages.splice(0, limit)),
    async record(id, error, definitive = false) {
      recorded.push([id, error, definitive]);
      return error === null ? 'envoyee' : outcome;
    },
  };
  return { queue, recorded };
}

const message = (id: string, extra: Partial<QueuedSms> = {}): QueuedSms => ({
  id,
  telephone: '+224620000006',
  modele: 'dossier.valide',
  objet: 'DS-1041',
  parametres: { etape: 3 },
  ...extra,
});

const env = { SMS_POLL_SECONDS: 0 } as Env;

describe('Envoi de la file', () => {
  it('Critère 1 : envoie chaque message relevé au numéro du praticien, puis le marque envoyé', async () => {
    const { queue, recorded } = fakeQueue([
      message('1'),
      message('2', { telephone: '+224661234567' }),
    ]);
    const sent: [string, string][] = [];
    const sender: SmsSender = { send: async (to, text) => void sent.push([to, text]) };

    expect(await new SmsDispatcher(env, queue, sender).dispatch()).toBe(2);
    expect(queue.take).toHaveBeenCalledWith(BATCH_SIZE);
    expect(sent).toEqual([
      ['+224620000006', expect.stringContaining('DS-1041 est validé') as string],
      ['+224661234567', expect.stringContaining('consolidation régionale') as string],
    ]);
    expect(recorded).toEqual([
      ['1', null, false],
      ['2', null, false],
    ]);
  });

  it('US-041 : met en file les rappels de visite dus avant chaque relève', async () => {
    const order: string[] = [];
    const { queue } = fakeQueue([
      message('1', { modele: 'visite.rappel', parametres: { prevueLe: '2026-11-20T09:30' } }),
    ]);
    queue.queueVisitReminders = vi.fn(async () => {
      order.push('rappels');
      return 1;
    });
    const take = queue.take;
    queue.take = vi.fn(async (limit: number) => {
      order.push('relève');
      return take(limit);
    });
    const sent: string[] = [];
    const sender: SmsSender = { send: async (_, text) => void sent.push(text) };

    expect(await new SmsDispatcher(env, queue, sender).dispatch()).toBe(1);
    expect(order).toEqual(['rappels', 'relève']);
    expect(sent).toEqual([
      expect.stringContaining('vous rend visite le 20/11/2026 à 09h30') as string,
    ]);
  });

  it('Critère 3 : une erreur du fournisseur est rendue à la file pour un nouvel essai', async () => {
    const { queue, recorded } = fakeQueue([message('1'), message('2')], 'en_attente');
    let calls = 0;
    const sender: SmsSender = {
      async send() {
        calls += 1;
        if (calls === 1) throw new Error('HTTP 503 : service indisponible');
      },
    };
    await new SmsDispatcher(env, queue, sender).dispatch();
    // Le premier échoue (essai suivant prévu par la base), le second part quand même
    expect(recorded).toEqual([
      ['1', 'HTTP 503 : service indisponible', false],
      ['2', null, false],
    ]);
  });

  it('un refus définitif du fournisseur n’est pas réessayé', async () => {
    const { queue, recorded } = fakeQueue([message('1')], 'echec');
    const sender: SmsSender = {
      send: () => Promise.reject(new SmsSendError('Numéro refusé', true)),
    };
    await new SmsDispatcher(env, queue, sender).dispatch();
    expect(recorded).toEqual([['1', 'Numéro refusé', true]]);
  });

  it('sans numéro ou avec un modèle inconnu : échec définitif, rien n’est envoyé', async () => {
    const { queue, recorded } = fakeQueue(
      [message('1', { telephone: null }), message('2', { modele: 'recette.validee' })],
      'echec',
    );
    const send = vi.fn();
    await new SmsDispatcher(env, queue, { send }).dispatch();
    expect(send).not.toHaveBeenCalled();
    expect(recorded).toEqual([
      ['1', 'Aucun numéro de téléphone', true],
      ['2', 'Modèle inconnu : recette.validee', true],
    ]);
  });

  it('une base injoignable n’arrête pas l’envoi : le passage suivant reprend', async () => {
    const queue: NotificationQueue = {
      queueVisitReminders: () => Promise.reject(new Error('connexion refusée')),
      take: () => Promise.reject(new Error('connexion refusée')),
      record: vi.fn(),
    };
    const dispatcher = new SmsDispatcher(env, queue, new JournalSmsSender());
    expect(await dispatcher.dispatch()).toBe(0);
  });

  it('un seul passage à la fois, même si la relève est lente', async () => {
    const { queue } = fakeQueue([message('1')]);
    const dispatcher = new SmsDispatcher(env, queue, { send: async () => undefined });
    const [a, b] = await Promise.all([dispatcher.dispatch(), dispatcher.dispatch()]);
    expect([a, b]).toEqual([1, 1]);
    expect(queue.take).toHaveBeenCalledTimes(1);
  });

  it('relève la file au démarrage puis à intervalle régulier', async () => {
    vi.useFakeTimers();
    try {
      const { queue } = fakeQueue([]);
      const dispatcher = new SmsDispatcher({ SMS_POLL_SECONDS: 30 } as Env, queue, {
        send: async () => undefined,
      });
      dispatcher.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(0);
      expect(queue.take).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(queue.take).toHaveBeenCalledTimes(2);
      dispatcher.onApplicationShutdown();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(queue.take).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Choix du fournisseur', () => {
  it('« journal » : faux fournisseur, rien ne part', async () => {
    const sender = createSmsSender({ SMS_PROVIDER: 'journal' } as Env);
    expect(sender).toBeInstanceOf(JournalSmsSender);
    await expect(sender.send('+224620000006', 'SABOU : essai')).resolves.toBeUndefined();
  });

  it('« journal » refuse définitivement les numéros d’essai de refus (+224 669 99…)', async () => {
    const refused = new JournalSmsSender().send('+224669990001', 'SABOU : essai');
    await expect(refused).rejects.toBeInstanceOf(SmsSendError);
    await expect(refused).rejects.toMatchObject({ permanent: true });
    await expect(new JournalSmsSender().send('+224669980001', 'SABOU')).resolves.toBeUndefined();
  });
});

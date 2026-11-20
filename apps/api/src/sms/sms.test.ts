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
  ['dossier.terrain_cree', undefined],
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

describe('US-024 : alerte de la DG après une réinitialisation par l’exploitation', () => {
  it('tient en un SMS GSM 7 bits et renvoie vers l’e-mail envoyé', () => {
    const text = notificationText({ modele: 'compte.dg_reinitialise', objet: '1', parametres: {} });
    expect(text).toMatch(/^SABOU : .*compte DG.*e-mail/);
    expect(isSingleGsm7Sms(text!)).toBe(true);
  });
});

describe('US-061 : SMS du circuit d’un traitement', () => {
  const TREATMENT = 'REC-1000000';
  it.each([
    ['recette.soumise', undefined],
    ['recette.transmise', undefined],
    ['recette.expertisee', undefined],
    ['recette.certifiee', undefined],
    ['recette.renvoyee', 'brouillon'],
    ['recette.renvoyee', 'soumise'],
    ['recette.renvoyee', 'transmise'],
    // US-100 : suspension, retrait, levée de la suspension
    ['recette.suspendue', undefined],
    ['recette.retiree', undefined],
    ['recette.certifiee', undefined, 'suspendue'],
  ])('%s (%s) tient en un SMS GSM 7 bits, sans le motif', (modele, statut, de?: string) => {
    const text = notificationText({ modele, objet: TREATMENT, parametres: { statut, de } });
    expect(text).toMatch(/^SABOU : .*votre traitement REC-1000000 /);
    expect(isSingleGsm7Sms(text!)).toBe(true);
  });

  it('renvoi : le texte dit où va le traitement ; statut inconnu : erreur définitive', () => {
    const text = (statut?: string) =>
      notificationText({ modele: 'recette.renvoyee', objet: 'REC-0001', parametres: { statut } });
    expect(text('brouillon')).toBe(
      'SABOU : votre traitement REC-0001 vous est renvoyé pour correction. Le motif est dans votre Studio SABOU.',
    );
    expect(text('transmise')).toContain('renvoyé au Comité scientifique');
    expect(text('certifiee')).toBe(null);
    expect(text()).toBe(null);
  });

  it('US-100 : la levée d’une suspension ne se lit pas comme une première certification', () => {
    const certified = (de?: string) =>
      notificationText({ modele: 'recette.certifiee', objet: 'REC-0001', parametres: { de } });
    expect(certified('expertisee')).toContain('félicitations');
    expect(certified('suspendue')).toBe(
      'SABOU : la suspension de votre traitement REC-0001 est levée. Il est de nouveau visible sur SABOU.',
    );
  });
});

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

  it('US-049 : l’invitation à renouveler tient en un SMS et donne le numéro et l’échéance', () => {
    const text = notificationText({
      modele: 'certificat.renouvellement',
      objet: 'SAB-2026-PR1042-KX7',
      parametres: { expireLe: '2027-01-14' },
    });
    expect(text).toBe(
      "SABOU : votre certificat SAB-2026-PR1042-KX7 expire le 14/01/2027. Renouvelez-le dans votre espace SABOU pour rester dans l'annuaire.",
    );
    expect(isSingleGsm7Sms(text!)).toBe(true);
    // Numéro le plus long admis : toujours un seul SMS
    const longest = notificationText({
      modele: 'certificat.renouvellement',
      objet: `SAB-2026-PR${'9'.repeat(10)}-KX7`,
      parametres: { expireLe: '2027-01-14' },
    });
    expect(isSingleGsm7Sms(longest!)).toBe(true);
  });

  it('US-049 : une invitation sans échéance ou sans numéro valable est une erreur définitive', () => {
    const text = (objet: string, expireLe?: string) =>
      notificationText({ modele: 'certificat.renouvellement', objet, parametres: { expireLe } });
    expect(text('SAB-2026-PR1042-KX7', undefined)).toBe(null);
    expect(text('SAB-2026-PR1042-KX7', '14/01/2027')).toBe(null);
    expect(text('DS-1041', '2027-01-14')).toBe(null);
    expect(text('SAB-2026-PR1042-KX7 ou autre', '2027-01-14')).toBe(null);
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

  it('US-047 : rejet définitif, date limite du recours et orientation vers la préfecture', () => {
    const text = (parametres: { dossier?: string; recoursJusquau?: string }) =>
      notificationText({ modele: 'praticien.rejet_definitif', objet: 'PR-1042', parametres });
    // Texte validé par le maître d'œuvre le 14 novembre 2026
    expect(text({ recoursJusquau: '2026-12-14' })).toBe(
      "SABOU : rejet définitif de votre certification. Vous pouvez contester cette décision jusqu'au 14/12/2026 auprès de l'administration de votre préfecture.",
    );
    expect(text({ dossier: 'DS-1041', recoursJusquau: '2026-12-14' })).toBe(
      "SABOU : rejet définitif de votre dossier DS-1041. Vous pouvez contester cette décision jusqu'au 14/12/2026 auprès de l'administration de votre préfecture.",
    );
    // Le plus long : code de dossier le plus long envisagé
    const longest = text({ dossier: CODE, recoursJusquau: '2026-12-14' })!;
    expect(longest.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
    expect(isSingleGsm7Sms(longest)).toBe(true);
    // Donnée mal formée : erreur définitive plutôt qu'un SMS faux
    for (const parametres of [
      {},
      { recoursJusquau: '14/12/2026' },
      { dossier: 'DS-1; drop', recoursJusquau: '2026-12-14' },
    ]) {
      expect(text(parametres)).toBe(null);
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
    processCertificateDeadlines: vi.fn(async () => ({ expired: 0, reminders: 0 })),
    eraseHealthReportContacts: vi.fn(async () => 0),
    detectTerritorialAlerts: vi.fn(async () => 0),
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

  it('US-049 : traite les échéances des certificats avant chaque relève, invitations comprises', async () => {
    const order: string[] = [];
    const { queue } = fakeQueue([
      message('1', {
        modele: 'certificat.renouvellement',
        objet: 'SAB-2026-PR1042-KX7',
        parametres: { expireLe: '2027-01-14' },
      }),
    ]);
    queue.processCertificateDeadlines = vi.fn(async () => {
      order.push('échéances');
      return { expired: 2, reminders: 1 };
    });
    const take = queue.take;
    queue.take = vi.fn(async (limit: number) => {
      order.push('relève');
      return take(limit);
    });
    const sent: string[] = [];
    const sender: SmsSender = { send: async (_, text) => void sent.push(text) };

    expect(await new SmsDispatcher(env, queue, sender).dispatch()).toBe(1);
    expect(order).toEqual(['échéances', 'relève']);
    expect(sent).toEqual([expect.stringContaining('expire le 14/01/2027') as string]);
  });

  it('US-049 : une erreur sur les échéances ne retient pas les SMS déjà en file', async () => {
    const { queue, recorded } = fakeQueue([message('1')]);
    queue.processCertificateDeadlines = () => Promise.reject(new Error('verrou'));
    const dispatcher = new SmsDispatcher(env, queue, { send: async () => undefined });
    expect(await dispatcher.dispatch()).toBe(1);
    expect(recorded).toEqual([['1', null, false]]);
  });

  it('une base injoignable n’arrête pas l’envoi : le passage suivant reprend', async () => {
    const queue: NotificationQueue = {
      queueVisitReminders: () => Promise.reject(new Error('connexion refusée')),
      processCertificateDeadlines: () => Promise.reject(new Error('connexion refusée')),
      eraseHealthReportContacts: () => Promise.reject(new Error('connexion refusée')),
      detectTerritorialAlerts: () => Promise.reject(new Error('connexion refusée')),
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

// US-102 : la détection des alertes passe à chaque relève, sans retenir les SMS
describe('US-102 : détection des alertes territoriales', () => {
  it('appelée à chaque passage ; son échec n’empêche pas l’envoi des SMS', async () => {
    const { queue, recorded } = fakeQueue([message('1')]);
    queue.detectTerritorialAlerts = vi.fn(() => Promise.reject(new Error('base occupée')));
    const dispatcher = new SmsDispatcher(env, queue, { send: async () => undefined });
    expect(await dispatcher.dispatch()).toBe(1);
    expect(queue.detectTerritorialAlerts).toHaveBeenCalledTimes(1);
    expect(recorded).toEqual([['1', null, false]]);
  });
});

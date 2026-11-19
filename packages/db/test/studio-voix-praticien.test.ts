// US-081 : enregistrer sa recette au Studio mobile, en voix (UC-21, R-GOV-01, R-LNG-11,
// décisions du maître d'œuvre du 19 novembre 2026). Praticien d'essai : Mamadou Diallo
// (PR-1042, langue principale du jeu d'exemple), préfecture de Labé. Chaque cas part du même
// état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const PRACTITIONER = 'm.diallo@exemple.gn';
const PREFECTORAL = 'prefectoral.labe@sabou-sante.gn';
const REGIONAL = 'regional.labe@sabou-sante.gn';
const SECTIONS = ['preparation', 'consommation', 'cycle', 'effets_indesirables'];

const fields = (overrides: Record<string, unknown> = {}) => ({
  maladie: 'MA-001',
  titreFr: 'Recette dite',
  cycleDureeJours: 5,
  cyclePrisesParJour: 1,
  plantes: [{ plante: 'PL-003', partie: 'gousses' }],
  sections: [],
  consentement: true,
  visibilite: 'publique',
  ...overrides,
});
const json = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
const CODE = `(SELECT code FROM recette WHERE titre_fr = 'Recette dite')`;
const VUE = `(SELECT updated_at FROM recette WHERE titre_fr = 'Recette dite')`;
const draft = (overrides: Record<string, unknown> = {}) => `${openContext(PRACTITIONER)}
  SELECT traitement_enregistrer(NULL, NULL, ${json(fields(overrides))});`;
const save = (overrides: Record<string, unknown>) =>
  `SELECT traitement_enregistrer(${CODE}, ${VUE}, ${json(fields(overrides))});`;
let keys = 0;
const key = () => `'00000000-0000-4000-8000-${String(++keys).padStart(12, '0')}'::uuid`;
const deposit = (cible: string, objet: string, cle = key()) => `
  SELECT traitement_voix_praticien_deposer(${CODE}, '${cible}', '${objet}', ${cle},
    'voix/originaux/' || gen_random_uuid() || '.m4a', 'audio/mp4', 9000, '${'a'.repeat(64)}') AS depot;`;
// Chaîne de traitement (US-070), exécutée par le service de traitement
const processLast = `
  SELECT 1 FROM voix_depots_prendre(1);
  SELECT voix_depot_terminer((SELECT max(id) FROM voix_depot), 'voix/' || gen_random_uuid() || '.webm',
                             'voix/' || gen_random_uuid() || '.m4a', 61.5, 4000, 5000, '${'b'.repeat(64)}');`;
const allSectionsByVoice = SECTIONS.map((type) => deposit('section', type)).join('\n');
const run = (sql: string) => lastRows(db.url.app, sql);
const circuit = `
  SELECT s.type_code AS section, s.texte_fr AS texte, v.langue_code AS langue, v.statut,
         u.role_code AS par
    FROM recette_section s JOIN recette r ON r.id = s.recette_id
    LEFT JOIN recette_section_voix v ON v.section_id = s.id
    LEFT JOIN utilisateur u ON u.id = v.enregistre_par
   WHERE r.code = ${CODE} ORDER BY s.type_code;`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : un enregistrement par champ, ré-enregistrement', () => {
  it('une voix par section : rattachée au dépôt dès l’envoi, dans la langue du praticien', async () => {
    const rows = await run(`${draft()} ${deposit('section', 'preparation')}
      SELECT v.section_type AS section, v.langue_code = p.langue_principale AS sa_langue,
             d.statut AS etat, d.consentement
        FROM recette_voix_praticien v JOIN voix_depot d ON d.id = v.depot_id
        JOIN recette r ON r.id = v.recette_id JOIN praticien p ON p.id = r.praticien_id
       WHERE r.code = ${CODE};`);
    expect(rows).toEqual([
      { section: 'preparation', sa_langue: true, etat: 'en_attente', consentement: true },
    ]);
  });

  it('une fois traitée, la voix d’une section devient le brouillon de sa langue dans le circuit', async () => {
    const rows = await run(`${draft()} ${deposit('section', 'preparation')}
      ${openContext(PRACTITIONER)} ${processLast} ${circuit}`);
    expect(rows).toEqual([
      {
        section: 'preparation',
        texte: null,
        langue: expect.any(String),
        statut: 'brouillon',
        par: 'praticien',
      },
    ]);
  });

  it('ré-enregistrer remplace la voix en vigueur ; l’ancienne reste dans l’historique', async () => {
    const rows =
      await run(`${draft()} ${deposit('section', 'preparation')} ${deposit('section', 'preparation')}
      SELECT count(*)::int AS historique,
             (SELECT depot FROM traitement_voix_praticien(${CODE})) =
             (SELECT max(depot_id) FROM recette_voix_praticien) AS derniere
        FROM recette_voix_praticien;`);
    expect(rows).toEqual([{ historique: 2, derniere: true }]);
  });

  it('un enregistrement remplacé ne passe pas dans le circuit, même traité après le suivant', async () => {
    const rows =
      await run(`${draft()} ${deposit('section', 'preparation')} ${deposit('section', 'preparation')}
      SELECT 1 FROM voix_depots_prendre(1);
      SELECT voix_depot_terminer((SELECT min(id) FROM voix_depot WHERE statut = 'en_cours'),
        'voix/a.webm', 'voix/a.m4a', 3, 4000, 5000, '${'b'.repeat(64)}');
      SELECT count(*)::int AS voix FROM recette_section_voix v
        JOIN recette_section s ON s.id = v.section_id JOIN recette r ON r.id = s.recette_id
       WHERE r.code = ${CODE};`);
    expect(rows).toEqual([{ voix: 0 }]);
  });

  it('le nom de chaque plante : voix interne, jamais versée dans le circuit public', async () => {
    const rows = await run(`${draft()} ${deposit('plante', 'PL-003')} ${processLast}
      ${openContext(PRACTITIONER)}
      SELECT cible, objet, etat, duree_sec AS duree,
             (SELECT count(*)::int FROM recette_section_voix) AS circuit
        FROM traitement_voix_praticien(${CODE});`);
    expect(rows).toEqual([
      {
        cible: 'plante',
        objet: 'PL-003',
        etat: 'traitee',
        duree: '61.50',
        circuit: expect.any(Number),
      },
    ]);
    const circuitRows = await run(
      `${draft()} ${deposit('plante', 'PL-003')} ${processLast} ${circuit}`,
    );
    expect(circuitRows).toEqual([]);
  });

  it('le préfectoral de la préfecture lit la voix du nom (écoute interne, US-081)', async () => {
    const rows = await run(`${draft()} ${deposit('plante', 'PL-003')} ${processLast}
      ${openContext(PREFECTORAL)}
      SELECT pl.code AS plante, d.statut AS etat
        FROM recette r JOIN recette_plante rp ON rp.recette_id = r.id
        JOIN plante pl ON pl.id = rp.plante_id
        CROSS JOIN LATERAL voix_praticien_courante(r.id, NULL, pl.id) v
        JOIN voix_depot d ON d.id = v.depot_id
       WHERE r.code = ${CODE};`);
    expect(rows).toEqual([{ plante: 'PL-003', etat: 'traitee' }]);
  });

  it('une plante absente du traitement ou une section inconnue sont refusées', async () => {
    await expect(run(`${draft()} ${deposit('plante', 'PL-001')}`)).rejects.toThrow(
      /absente du traitement/,
    );
    await expect(run(`${draft()} ${deposit('section', 'posologie')}`)).rejects.toThrow(
      /Section posologie inconnue/,
    );
  });

  it('retirer sa voix : gardée dans l’historique, section sans texte supprimée', async () => {
    const rows = await run(`${draft()} ${deposit('section', 'preparation')} ${processLast}
      ${openContext(PRACTITIONER)}
      SELECT traitement_voix_praticien_retirer(${CODE}, 'section', 'preparation') AS retiree;
      SELECT (SELECT count(*)::int FROM recette_voix_praticien WHERE retire_le IS NOT NULL) AS historique,
             (SELECT count(*)::int FROM recette_section s JOIN recette r ON r.id = s.recette_id
               WHERE r.code = ${CODE}) AS sections;`);
    expect(rows).toEqual([{ historique: 1, sections: 0 }]);
  });
});

describe('Critère : consentement enregistré, rejouable hors réseau', () => {
  it('sans consentement, la voix est refusée (R-LNG-11)', async () => {
    await expect(
      run(
        `${draft({ consentement: false, visibilite: null })} ${deposit('section', 'preparation')}`,
      ),
    ).rejects.toThrow(/consentement à donner/);
  });

  it('un envoi rejoué avec la même clé (coupure réseau) ne crée pas de doublon', async () => {
    const cle = key();
    const rows = await run(`${draft()} ${deposit('section', 'preparation', cle)}
      ${deposit('section', 'preparation', cle)}
      SELECT (SELECT count(*)::int FROM recette_voix_praticien) AS voix,
             (SELECT count(*)::int FROM voix_depot WHERE depose_par = contexte_utilisateur()) AS depots;`);
    expect(rows).toEqual([{ voix: 1, depots: 1 }]);
  });

  it('seul le praticien du traitement, sur un brouillon, enregistre sa voix', async () => {
    await expect(
      run(`${draft()} ${openContext(PREFECTORAL)} ${deposit('section', 'preparation')}`),
    ).rejects.toThrow(/réservé aux praticiens/);
    await expect(
      run(`${draft({ sections: SECTIONS.map((type) => ({ type, texteFr: 'Texte' })) })}
           SELECT traitement_soumettre(${CODE}); ${deposit('section', 'preparation')}`),
    ).rejects.toThrow(/seul un brouillon/);
  });
});

describe('Décision du 19/11 : voix OU texte par section, texte avant le Comité', () => {
  it('soumission avec la voix seule pour chaque section obligatoire', async () => {
    const rows = await run(`${draft()} ${allSectionsByVoice}
      SELECT traitement_soumettre(${CODE}) AS statut;`);
    expect(rows).toEqual([{ statut: 'soumise' }]);
  });

  it('une section obligatoire sans voix ni texte bloque la soumission', async () => {
    await expect(
      run(`${draft()} ${deposit('section', 'preparation')} SELECT traitement_soumettre(${CODE});`),
    ).rejects.toThrow(/incomplet : sections/);
  });

  it('une voix en échec de traitement ne compte pas', async () => {
    await expect(
      // Trois essais en échec pour chaque dépôt : aucune section n'a plus de voix valable
      run(`${draft()} ${allSectionsByVoice}
        ${"SELECT voix_depot_echouer(id, 'illisible') FROM voix_depots_prendre(10);".repeat(3)}
        SELECT traitement_soumettre(${CODE});`),
    ).rejects.toThrow(/incomplet : sections/);
  });

  it('le régional ne transmet au Comité qu’une fois le texte français écrit par le préfectoral', async () => {
    const submitted = `${draft()} ${allSectionsByVoice} SELECT traitement_soumettre(${CODE});`;
    const transmit = `${openContext(REGIONAL)}
      SELECT recette_transition((SELECT id FROM recette WHERE code = ${CODE}), 'transmise', contexte_utilisateur()) AS statut;`;
    await expect(run(`${submitted} ${transmit}`)).rejects.toThrow(
      /texte français à écrire avant le Comité/,
    );
    const revise = SECTIONS.map(
      (type) => `SELECT traitement_section_reviser(${CODE}, '${type}', 'Résumé : ${type}');`,
    ).join('\n');
    const rows = await run(`${submitted} ${openContext(PREFECTORAL)} ${revise} ${transmit}`);
    expect(rows).toEqual([{ statut: 'transmise' }]);
  });

  it('le premier texte du préfectoral garde l’origine vide dans l’historique', async () => {
    const rows = await run(`${draft()} ${allSectionsByVoice} SELECT traitement_soumettre(${CODE});
      ${openContext(PREFECTORAL)} SELECT traitement_section_reviser(${CODE}, 'preparation', 'Résumé');
      SELECT h.texte_fr_avant AS avant, h.texte_fr AS apres FROM recette_section_revision h
        JOIN recette_section s ON s.id = h.section_id JOIN recette r ON r.id = s.recette_id
       WHERE r.code = ${CODE};`);
    expect(rows).toEqual([{ avant: null, apres: 'Résumé' }]);
  });

  it('vider le texte d’une section qui a une voix garde la section ; sans voix, elle disparaît', async () => {
    const withText = SECTIONS.slice(0, 2).map((type) => ({ type, texteFr: `Texte ${type}` }));
    const rows = await run(`${draft({ sections: withText })} ${deposit('section', 'preparation')}
      ${save({ sections: [] })}
      SELECT s.type_code AS section, s.texte_fr AS texte FROM recette_section s
        JOIN recette r ON r.id = s.recette_id WHERE r.code = ${CODE};`);
    expect(rows).toEqual([{ section: 'preparation', texte: null }]);
  });
});

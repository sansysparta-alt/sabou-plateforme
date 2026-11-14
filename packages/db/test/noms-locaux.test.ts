// US-053 : noms locaux d'une plante, transcription et voix (UC-12, R-PLA-03, R-LNG-13).
// Jeu d'exemple : PL-001 a un nom principal en soussou, malinké et pular ; le préfectoral de
// Labé a le droit d'enregistrer en pular (référent), pas en malinké. Chaque cas part du même
// état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const PULAR = 'prefectoral.labe@sabou-sante.gn';
const as = (email: string, sql: string) => lastRows(db.url.app, `${openContext(email)} ${sql}`);
const add = (name: string, principal = false, plant = 'PL-001', language = 'pul') =>
  `SELECT * FROM plante_nom_local_ajouter('${plant}', '${language}', '${name}', ${principal});`;
const names = (plant = 'PL-001', language = 'pul') =>
  `SELECT n.transcription_recherche AS nom, n.principal FROM plante_nom_local n
     JOIN plante p ON p.id = n.plante_id
    WHERE p.code = '${plant}' AND n.langue_code = '${language}' ORDER BY n.cree_le, n.id;`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : plusieurs noms par langue, un seul principal', () => {
  it('le référent ajoute un synonyme ; le principal reste unique', async () => {
    const rows = await as(PULAR, `${add('Kahi')} ${names()}`);
    expect(rows).toEqual([
      { nom: 'Bahi', principal: true },
      { nom: 'Kahi', principal: false },
    ]);
  });

  it('un nouveau principal retire la marque de l’ancien', async () => {
    const rows = await as(PULAR, `${add('Kahi', true)} ${names()}`);
    expect(rows.filter((r) => r.principal)).toEqual([{ nom: 'Kahi', principal: true }]);
  });

  it('le premier nom d’une langue est principal d’office', async () => {
    const rows = await as(PULAR, `${add('Nimé', false, 'PL-004')} ${names('PL-004')}`);
    expect(rows).toEqual([{ nom: 'Nimé', principal: true }]);
  });

  it('retirer le principal : le suivant le devient ; tracé au journal', async () => {
    const rows = await as(
      PULAR,
      `${add('Kahi')}
       SELECT plante_nom_local_retirer((SELECT id FROM plante_nom_local WHERE transcription_recherche = 'Bahi'));
       ${names()}`,
    );
    expect(rows).toEqual([{ nom: 'Kahi', principal: true }]);
  });

  it('même nom à la casse et aux accents près : refusé', async () => {
    await expect(as(PULAR, add(' bahi '))).rejects.toThrow('déjà saisi');
  });

  it('réservé au référent de la langue (droit d’enregistrer)', async () => {
    await expect(as(PULAR, add('Djala', false, 'PL-001', 'mal'))).rejects.toThrow(
      'réservé au référent de la langue',
    );
    await expect(as('aminata@exemple.gn', add('Kahi'))).rejects.toThrow('référent');
    await expect(as(PULAR, `DELETE FROM plante_nom_local;`)).rejects.toThrow('permission denied');
  });

  it('pas de nom écrit en anglais : les noms locaux sont des langues de voix', async () => {
    await expect(
      lastRows(
        db.url.migrator,
        `SET LOCAL search_path = sabou;
         INSERT INTO utilisateur_langue VALUES (3, 'en', true, false, false);
         ${openContext(PULAR)} ${add('Mahogany', false, 'PL-001', 'en')}`,
      ),
    ).rejects.toThrow();
  });
});

describe('Critère : la transcription sert à la recherche, jamais à l’affichage public', () => {
  it('la recherche publique trouve la plante par sa transcription, sans jamais la renvoyer', async () => {
    const rows = await as(PULAR, `${add('Kahi')} SELECT * FROM rechercher_plante('kahi');`);
    expect(rows.map((r) => r.plante_code)).toContain('PL-001');
    expect(JSON.stringify(rows)).not.toMatch(/kahi/i);
  });

  it('la voix d’un nom vient d’un dépôt traité du même compte', async () => {
    const deposit = `SELECT id FROM voix_deposer('voix/originaux/n.webm', 'audio/webm', 9000,
                       '${'a'.repeat(64)}', true);`;
    await expect(
      as(
        PULAR,
        `${deposit} SELECT plante_nom_local_ajouter('PL-001', 'pul', 'Kahi', false,
                   (SELECT max(id) FROM voix_depot));`,
      ),
    ).rejects.toThrow('pas encore traitée');
    const rows = await as(
      PULAR,
      `${deposit} SELECT 1 FROM voix_depots_prendre(1);
       SELECT voix_depot_terminer((SELECT max(id) FROM voix_depot), 'voix/n.webm', 'voix/n.m4a',
                                  1.2, 4000, 5000, '${'b'.repeat(64)}');
       SELECT audio_id IS NOT NULL AS voix FROM plante_nom_local_ajouter('PL-001', 'pul', 'Kahi', false,
         (SELECT max(id) FROM voix_depot));`,
    );
    expect(rows).toEqual([{ voix: true }]);
  });
});

// US-050 : créer et modifier une fiche plante avec ses images (UC-05, R-PLA-01, R-PLA-04).
// Jeu d'exemple : PL-001 à PL-005 ; PL-001 a deux photos (khaya.jpg principale, khaya2.jpg).
// Chaque cas s'exécute sous le rôle de l'API, dans le contexte de l'acteur, et part du même
// état (transaction annulée).
import { beforeAll, describe, expect, it } from 'vitest';
import { createSeededDatabase, lastRows, openContext, type TestDatabase } from './helpers.ts';

let db: TestDatabase;
const DG = 'dg@sabou-sante.gn';
const COMMITTEE = 'comite@sabou-sante.gn';
const as = (email: string, sql: string) => lastRows(db.url.app, `${openContext(email)} ${sql}`);
const create = (name: string, fr = 'Kinkéliba', en: string | null = null) =>
  `SELECT * FROM plante_creer('${name}', 'Combretaceae', '${fr}', ${en === null ? 'NULL' : `'${en}'`});`;
const SHA = 'a'.repeat(64);
const addImage = (code: string, key: string, principal = false, alt = 'Feuilles séchées') =>
  `SELECT * FROM plante_image_ajouter('${code}', '${key}', '${SHA}', 'image/jpeg', 1000,
     '${alt}', NULL, 'feuille', ${principal});`;
const images = (code: string) =>
  `SELECT image_url, principale FROM plante_image i JOIN plante p ON p.id = i.plante_id
    WHERE p.code = '${code}' ORDER BY ordre, i.id;`;

beforeAll(async () => {
  db = await createSeededDatabase();
});

describe('Critère : nom scientifique unique, famille, nom français obligatoire, nom anglais', () => {
  it('la DG crée une fiche « en revue », avec le code suivant libre, tracée au journal', async () => {
    const rows = await as(
      DG,
      `${create('Combretum micranthum', 'Kinkéliba', 'Kinkeliba')}
       SELECT p.code, p.statut, p.nom_en, j.action, j.utilisateur_id
         FROM plante p JOIN journal_audit j ON j.objet_id = p.code
        WHERE p.nom_scientifique = 'Combretum micranthum';`,
    );
    expect(rows).toEqual([
      {
        code: 'PL-006',
        statut: 'en_revue',
        nom_en: 'Kinkeliba',
        action: 'plante.creee',
        utilisateur_id: '1',
      },
    ]);
  });

  it('le Comité crée une fiche ; le nom anglais est facultatif', async () => {
    const rows = await as(COMMITTEE, create('Combretum micranthum'));
    expect(rows[0]).toMatchObject({ statut: 'en_revue', nom_en: null });
  });

  it('les autres profils ne créent pas de fiche', async () => {
    for (const email of [
      'prefectoral.labe@sabou-sante.gn',
      'regional.kindia@sabou-sante.gn',
      's.kourouma@exemple.gn',
    ]) {
      await expect(as(email, create('Combretum micranthum'))).rejects.toThrow(
        'réservées à la DG et au Comité scientifique',
      );
    }
  });

  it('nom scientifique déjà pris, à la casse, aux accents et aux espaces près : refusé', async () => {
    await expect(as(DG, create('  khaya SENEGALENSIS '))).rejects.toThrow(
      'Nom scientifique déjà utilisé par la fiche PL-001',
    );
  });

  it('nom français, famille et nom scientifique vides : refusés', async () => {
    await expect(as(DG, create('Combretum micranthum', '  '))).rejects.toThrow('ck_plante_nom_fr');
    await expect(
      as(DG, `SELECT plante_creer('Combretum micranthum', '', 'Kinkéliba');`),
    ).rejects.toThrow('ck_plante_famille');
    await expect(as(DG, create(' '))).rejects.toThrow('ck_plante_nom_scientifique');
  });

  it('modifier : changements tracés ; une fiche modifiée entre-temps est refusée', async () => {
    const rows = await as(
      COMMITTEE,
      `SELECT * FROM plante_modifier('PL-005', (SELECT updated_at FROM plante WHERE code = 'PL-005'),
         'Azadirachta indica', 'Meliaceae', 'Margousier', 'Neem');
       SELECT details FROM journal_audit WHERE action = 'plante.modifiee' AND objet_id = 'PL-005';`,
    );
    expect(rows[0]!.details).toEqual({ nomFr: ['Neem', 'Margousier'] });
    await expect(
      as(
        COMMITTEE,
        `SELECT plante_modifier('PL-005', now() - interval '1 day',
         'Azadirachta indica', 'Meliaceae', 'Margousier', 'Neem');`,
      ),
    ).rejects.toThrow('PL-005 modifiée entre-temps');
  });

  it('modifier : nom scientifique d’une autre fiche refusé, le sien gardé accepté', async () => {
    const seen = `(SELECT updated_at FROM plante WHERE code = 'PL-005')`;
    await expect(
      as(DG, `SELECT plante_modifier('PL-005', ${seen}, 'Moringa oleifera', 'Meliaceae', 'Neem');`),
    ).rejects.toThrow('déjà utilisé par la fiche PL-004');
    const rows = await as(
      DG,
      `SELECT * FROM plante_modifier('PL-005', ${seen}, 'azadirachta indica', 'Meliaceae', 'Neem');`,
    );
    expect(rows[0]).toMatchObject({ nom_scientifique: 'azadirachta indica', nom_en: null });
  });

  it('l’API n’écrit pas en direct dans les fiches : seulement par les fonctions', async () => {
    await expect(
      as(
        DG,
        `INSERT INTO plante (code, nom_scientifique, famille, nom_fr) VALUES ('PL-900', 'X', 'Y', 'Z');`,
      ),
    ).rejects.toThrow('permission denied');
    await expect(as(DG, `UPDATE plante SET nom_fr = 'Z' WHERE code = 'PL-001';`)).rejects.toThrow(
      'permission denied',
    );
    await expect(as(DG, `DELETE FROM plante_image;`)).rejects.toThrow('permission denied');
  });
});

describe('Critère : une seule photo principale, texte alternatif obligatoire', () => {
  it('la première photo d’une fiche devient principale', async () => {
    const rows = await as(DG, `${addImage('PL-005', 'plantes/a.jpg')} ${images('PL-005')}`);
    // PL-005 a déjà neem.jpg (principale) dans le jeu d'exemple : la nouvelle ne l'est pas
    expect(rows).toEqual([
      { image_url: 'img/plantes/neem.jpg', principale: true },
      { image_url: 'plantes/a.jpg', principale: false },
    ]);
    const created = await as(
      DG,
      `${create('Combretum micranthum')} ${addImage('PL-006', 'plantes/b.jpg')} ${images('PL-006')}`,
    );
    expect(created).toEqual([{ image_url: 'plantes/b.jpg', principale: true }]);
  });

  it('une nouvelle photo principale retire la marque de l’ancienne : une seule principale', async () => {
    const rows = await as(DG, `${addImage('PL-001', 'plantes/c.jpg', true)} ${images('PL-001')}`);
    expect(rows.filter((r) => r.principale)).toEqual([
      { image_url: 'plantes/c.jpg', principale: true },
    ]);
    expect(rows).toHaveLength(3);
  });

  it('texte alternatif vide : refusé', async () => {
    await expect(as(DG, addImage('PL-001', 'plantes/d.jpg', false, '   '))).rejects.toThrow(
      'ck_plante_image_alt_fr',
    );
  });

  it('la principale ne perd sa marque qu’en la donnant à une autre', async () => {
    const principal = `(SELECT id FROM plante_image WHERE image_url = 'img/plantes/khaya.jpg')`;
    const other = `(SELECT id FROM plante_image WHERE image_url = 'img/plantes/khaya2.jpg')`;
    await expect(
      as(
        DG,
        `SELECT plante_image_modifier('PL-001', ${principal}, 'Écorce', NULL, 'ecorce', false);`,
      ),
    ).rejects.toThrow('marquer une autre photo principale');
    const rows = await as(
      COMMITTEE,
      `SELECT plante_image_modifier('PL-001', ${other}, 'Arbre entier', 'Tree', 'plante_entiere', true);
       ${images('PL-001')}`,
    );
    expect(rows).toEqual([
      { image_url: 'img/plantes/khaya.jpg', principale: false },
      { image_url: 'img/plantes/khaya2.jpg', principale: true },
    ]);
  });

  it('retirer la principale : la suivante la remplace ; la clé est rendue pour le stockage', async () => {
    const rows = await as(
      DG,
      `SELECT plante_image_retirer('PL-001',
         (SELECT id FROM plante_image WHERE image_url = 'img/plantes/khaya.jpg')) AS cle;`,
    );
    expect(rows).toEqual([{ cle: 'img/plantes/khaya.jpg' }]);
    const after = await as(
      DG,
      `SELECT plante_image_retirer('PL-001',
         (SELECT id FROM plante_image WHERE image_url = 'img/plantes/khaya.jpg'));
       ${images('PL-001')}`,
    );
    expect(after).toEqual([{ image_url: 'img/plantes/khaya2.jpg', principale: true }]);
  });

  it('une photo d’une autre fiche ne se modifie ni ne se retire par celle-ci', async () => {
    const neem = `(SELECT id FROM plante_image WHERE image_url = 'img/plantes/neem.jpg')`;
    await expect(as(DG, `SELECT plante_image_retirer('PL-001', ${neem});`)).rejects.toThrow(
      'introuvable',
    );
  });

  it('les autres profils ne touchent pas aux photos', async () => {
    await expect(
      as('prefectoral.labe@sabou-sante.gn', addImage('PL-001', 'plantes/e.jpg')),
    ).rejects.toThrow('réservées à la DG et au Comité scientifique');
  });
});

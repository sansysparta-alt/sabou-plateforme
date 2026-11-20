// US-090 : indicateurs du tableau de bord de chaque profil (CdC §6.2 à §6.5). Le calcul et le
// cloisonnement par zone sont prouvés en base (packages/db/test/tableau-de-bord.test.ts) ;
// ici, l'affichage : chaque indicateur du cahier des charges, en clair, sans décalage.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrefectoralIndicators, RegionalIndicators, ScientificIndicators } from '@sabou/types';
import { ProfileIndicators } from './ProfileIndicators';

afterEach(cleanup);

// Valeur de la tuile d'un libellé donné (espaces insécables ramenées à des espaces)
const tile = (label: string) =>
  screen
    .getByText(label, { selector: '.ui-stat__label' })
    .parentElement!.textContent!.replace(/\s/g, ' ');

const REGIONAL: RegionalIndicators = {
  profil: 'regional',
  praticiens: 186,
  consolides: 12,
  litiges: 2,
  couverture: { prefectures: 4, couvertes: 3 },
  aConsolider: 5,
  parPrefecture: [
    { prefecture: 'Labé', aValider: 4, aConsolider: 3, consolides: 9 },
    { prefecture: 'Mali', aValider: 1, aConsolider: 2, consolides: 3 },
  ],
  alertes: {
    total: 7,
    dernieres: [
      {
        id: 3,
        type: 'dossier_bloque',
        statut: 'relancee',
        prefecture: 'Labé',
        description: 'DS-1041 : étape 2 depuis le 01/11/2026.',
        le: '2026-11-18T08:00:00Z',
      },
    ],
  },
};

const PREFECTORAL: PrefectoralIndicators = {
  profil: 'prefectoral',
  enregistres: 186,
  certifies: 140,
  enAttente: 46,
  recettesNumerisees: 6,
  parSpecialite: [
    { specialite: 'Herboristerie', praticiens: 120 },
    { specialite: 'Rebouteux', praticiens: 66 },
  ],
  aValider: {
    total: 15,
    dossiers: [{ dossier: 'DS-1041', praticien: 'Sékou Kourouma', depuis: '2026-11-02T10:00:00Z' }],
  },
};

const SCIENTIFIC: ScientificIndicators = {
  profil: 'scientifique',
  expertises: 31,
  enAttente: 4,
  plantes: 52,
  plantesEnRevue: 3,
  alertes: 2,
  alertesGraves: 1,
  topPathologies: [
    { maladie: 'Paludisme', traitements: 9 },
    { maladie: 'Hypertension', traitements: 4 },
  ],
  file: {
    total: 4,
    traitements: [
      { code: 'REC-2043', titre: 'Mélange Moringa', maladie: 'Paludisme', depuis: null },
      {
        code: 'REC-2041',
        titre: 'Décoction',
        maladie: 'Paludisme',
        depuis: '2026-11-17T09:00:00Z',
      },
    ],
  },
};

describe('Admin régional (§6.3)', () => {
  it('praticiens, consolidés, litiges, couverture, dossiers à consolider', () => {
    render(<ProfileIndicators profile="regional" data={REGIONAL} />);
    expect(tile('Praticiens')).toMatch(/186/);
    expect(tile('Consolidés')).toMatch(/12.*12 derniers mois/);
    expect(tile('Litiges')).toMatch(/2/);
    expect(tile('Couverture')).toMatch(/75 %.*3 préfectures sur 4/);
    expect(tile('À consolider')).toMatch(/5/);
  });

  it('dossiers par préfecture et alertes du jour, avec lien vers les alertes', () => {
    render(<ProfileIndicators profile="regional" data={REGIONAL} />);
    const labe = screen.getByRole('row', { name: /Labé 4 3 9/ });
    expect(labe).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Alertes territoriales (7)' }));
    const alert = screen.getByRole('row', { name: /DS-1041/ });
    expect(alert.textContent).toMatch(/Dossier bloqué.*Labé.*Relancée/);
    expect(screen.getByRole('link', { name: 'Toutes les alertes' }).getAttribute('href')).toBe(
      '/alertes',
    );
  });
});

describe('Admin préfectoral (§6.4)', () => {
  it('enregistrés, certifiés, en attente, recettes numérisées', () => {
    render(<ProfileIndicators profile="prefectoral" data={PREFECTORAL} />);
    expect(tile('Enregistrés')).toMatch(/186/);
    expect(tile('Certifiés')).toMatch(/140/);
    expect(tile('En attente')).toMatch(/46/);
    expect(tile('Recettes numérisées')).toMatch(/6/);
  });

  it('répartition par spécialité et dossiers à valider, les plus anciens d’abord', () => {
    render(<ProfileIndicators profile="prefectoral" data={PREFECTORAL} />);
    const table = screen.getByRole('table', { name: 'Praticiens par spécialité' });
    expect(within(table).getByRole('row', { name: /Herboristerie/ }).textContent).toMatch(/120/);
    expect(screen.getByRole('heading', { name: 'Dossiers à valider (15)' }));
    expect(screen.getByRole('row', { name: /DS-1041/ }).textContent).toMatch(
      /Sékou Kourouma.*2 nov\. 2026/,
    );
    expect(screen.getByRole('link', { name: 'Vérification terrain' }).getAttribute('href')).toBe(
      '/verification-terrain',
    );
  });
});

describe('Comité scientifique (§6.5)', () => {
  it('expertisés, en attente, plantes, alertes ; top pathologies ; file d’expertise', () => {
    render(<ProfileIndicators profile="scientifique" data={SCIENTIFIC} />);
    expect(tile('Expertisés')).toMatch(/31/);
    expect(tile('En attente')).toMatch(/4/);
    expect(tile('Plantes')).toMatch(/52.*3 en revue/);
    expect(tile('Alertes')).toMatch(/2.*dont 1 graves/);
    const top = screen.getByRole('table', {
      name: 'Maladies qui ont le plus de traitements certifiés',
    });
    expect(top.textContent).toMatch(/Paludisme.*9.*Hypertension.*4/);
    const rows = screen
      .getByRole('table', { name: 'Traitements à expertiser, les plus anciens d’abord' })
      .querySelectorAll('tbody tr');
    expect([...rows].map((r) => r.textContent)).toEqual([
      expect.stringMatching(/REC-2043.*Date inconnue/),
      expect.stringMatching(/REC-2041.*17 nov\. 2026/),
    ]);
  });
});

describe('Chargement et garde-fous', () => {
  it('avant les chiffres : les tuiles du profil, valeurs « … », sans graphique', () => {
    render(<ProfileIndicators profile="prefectoral" data={null} />);
    expect(tile('Enregistrés')).toMatch(/…/);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('réponse d’un autre profil : rien n’est affiché', () => {
    const { container } = render(<ProfileIndicators profile="regional" data={PREFECTORAL} />);
    expect(container.textContent).toBe('');
  });

  it('aucun indicateur sans donnée (revenus, vues, écoutes)', () => {
    for (const data of [REGIONAL, PREFECTORAL, SCIENTIFIC]) {
      const { container } = render(<ProfileIndicators profile={data.profil} data={data} />);
      expect(container.textContent).not.toMatch(/revenu|vues|écoutes|À venir/i);
      cleanup();
    }
  });
});

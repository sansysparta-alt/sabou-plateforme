// @vitest-environment node
// Preuves automatiques des règles de la base de design (US-016) : contrastes WCAG 2.2 AA des
// couples de couleurs employés, et interdits de style (emoji, trait latéral décoratif).
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('./', import.meta.url);
const tokensCss = readFileSync(new URL('tokens.css', dir), 'utf8');

function token(name: string): string {
  const match = new RegExp(`--sabou-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(tokensCss);
  if (!match) throw new Error(`Variable --sabou-${name} absente ou non hexadécimale`);
  return match[1]!;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

// [texte, fond] : texte courant, 4,5:1 au moins (WCAG 1.4.3)
const textPairs: [string, string][] = [
  ['text', 'surface'],
  ['text', 'bg'],
  ['text-muted', 'surface'],
  ['text-muted', 'bg'],
  ['text-muted', 'mist'],
  ['institution', 'surface'],
  ['institution', 'bg'],
  ['forest', 'mist'],
  ['on-dark', 'institution'],
  ['on-dark', 'forest'],
  ['on-dark-muted', 'forest'],
  ['gold', 'forest'],
  ['forest', 'gold'],
  ['info', 'info-bg'],
  ['success', 'success-bg'],
  ['warning', 'warning-bg'],
  ['error', 'error-bg'],
  ['error', 'surface'],
  ['text', 'info-bg'],
  ['text', 'success-bg'],
  ['text', 'warning-bg'],
  ['text', 'error-bg'],
];

// [élément, fond] : composants d'interface (contours de champ, focus), 3:1 au moins (WCAG 1.4.11)
const uiPairs: [string, string][] = [
  ['border-strong', 'surface'],
  ['focus', 'surface'],
  ['focus', 'bg'],
  ['action', 'surface'],
];

describe('contrastes de la charte (WCAG 2.2 AA)', () => {
  it.each(textPairs)('texte %s sur %s : 4,5:1 au moins', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(uiPairs)('élément %s sur %s : 3:1 au moins', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(3);
  });

  it('le Vert action ne suffit pas pour du texte : écart assumé à CdC §10 (liens en Vert institution)', () => {
    expect(contrast(token('action'), token('surface'))).toBeLessThan(4.5);
  });

  it('les couleurs de la charte (CdC §10) sont reprises telles quelles', () => {
    expect(
      ['forest', 'institution', 'action', 'mint', 'mist', 'gold'].map((name) =>
        token(name).toUpperCase(),
      ),
    ).toEqual(['#0B3D2E', '#0F6B4F', '#1F9B72', '#CFE9DB', '#E6F4EC', '#C9A227']);
  });
});

describe('interdits de style', () => {
  const sources = readdirSync(dir)
    .filter((file) => /\.(css|tsx?)$/.test(file) && !file.endsWith('.test.ts'))
    .map((file) => [file, readFileSync(new URL(file, dir), 'utf8')] as const);

  it.each(sources)('%s : aucun emoji', (_file, content) => {
    expect(content).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it.each(sources.filter(([file]) => file.endsWith('.css')))(
    '%s : aucun trait latéral décoratif',
    (_file, content) => {
      expect(content).not.toMatch(/border-(left|inline-start)\s*:/);
    },
  );

  it.each(sources.filter(([file]) => file.endsWith('.css') && file !== 'tokens.css'))(
    '%s : aucune couleur en dur, seulement les variables de la charte',
    (_file, content) => {
      expect(content.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    },
  );

  it('les listes de polices finissent par la famille générique', () => {
    expect(tokensCss).toMatch(/--sabou-font-title:[^;]*\bserif;/);
    expect(tokensCss).toMatch(/--sabou-font-text:[^;]*\bsans-serif;/);
  });
});

// Le thème de connexion Keycloak reprend la même charte (05_Choix_Techniques.md §2.27)
describe('thème de connexion Keycloak', () => {
  const themeDir = new URL('../../../infra/local/keycloak/themes/sabou/login/', import.meta.url);
  const themeCss = readFileSync(new URL('resources/css/sabou.css', themeDir), 'utf8');
  const themeFiles = readdirSync(themeDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(css|ftl|properties)$/.test(file))
    .map((file) => [file, readFileSync(new URL(file, themeDir), 'utf8')] as const);

  it('tokens.css du thème est une copie exacte de celui de @sabou/ui', () => {
    expect(readFileSync(new URL('resources/css/tokens.css', themeDir), 'utf8')).toBe(tokensCss);
  });

  it('theme.properties charge tokens.css avant sabou.css', () => {
    expect(readFileSync(new URL('theme.properties', themeDir), 'utf8')).toMatch(
      /^styles=css\/tokens\.css css\/sabou\.css$/m,
    );
  });

  it('sabou.css : aucune couleur en dur, aucun trait latéral', () => {
    const code = themeCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(code).not.toMatch(/border-(left|inline-start)\s*:/);
  });

  it('sabou.css n’emploie que des variables définies dans tokens.css', () => {
    const used = new Set([...themeCss.matchAll(/var\((--sabou-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    const missing = [...used].filter((name) => !tokensCss.includes(`${name}:`));
    expect(missing).toEqual([]);
  });

  it.each(themeFiles)(
    '%s : ni emoji, ni texte anglais ou technique laissé par Keycloak',
    (_f, content) => {
      expect(content).not.toMatch(/\p{Extended_Pictographic}/u);
      const code = content.replace(/<#--[\s\S]*?-->/g, '');
      expect(code).not.toMatch(/Warning alert|Soumettre|code-barres|pficon-/);
    },
  );
});

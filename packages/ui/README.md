# @sabou/ui — base de design SABOU

Base posée par US-016 (novembre 2026), d'après la charte graphique du cahier des charges (§10) et la maquette de l'application de gestion v1.3. **Tout nouvel écran la reprend sans retouche** : il n'écrit ni couleur, ni police, ni espacement en dur, et assemble les composants ci-dessous. Décisions et écarts : `Plateforme/docs/05_Choix_Techniques.md` §2.27.

## Utilisation

```ts
// Une seule fois, à l'entrée de l'application (main.tsx)
import '@sabou/ui/styles.css';

// Dans un écran
import { AppShell, PageHeader, Card, StatCard, Button, Alert, TextField } from '@sabou/ui';
```

Le thème des pages de connexion Keycloak reprend les mêmes variables (`@sabou/ui/tokens.css`).

## Principes

- **Sobre** : fond clair, une couleur d'accent (Vert institution), contours fins tout autour, ombres douces. **Aucun emoji, aucun trait latéral décoratif** : les tests du paquet les refusent.
- **Lisible en 3G** : aucune police ni image téléchargée ; icônes en SVG intégré.
- **Accessible (WCAG 2.2 AA)** : contrastes vérifiés par les tests, cibles de 44 px, focus visible, libellés reliés aux champs.
- **Un seul `h1` par page**, en Cambria (via `PageHeader`) ; tout le reste en Calibri.

## Fondations (`src/tokens.css`)

| Famille               | Variables                                                                                                                                                 | Règle                                                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Couleurs de la charte | `--sabou-forest` #0B3D2E, `--sabou-institution` #0F6B4F, `--sabou-action` #1F9B72, `--sabou-mint` #CFE9DB, `--sabou-mist` #E6F4EC, `--sabou-gold` #C9A227 | Forêt : bandeau, navigation. Institution : titres, boutons principaux, liens, éléments actifs. **Action : graphiques et indicateurs seulement, jamais du texte** (3,5:1). Menthe et brume : fonds. **Or : texte seulement sur Forêt** (5,0:1) |
| Neutres               | `--sabou-text`, `--sabou-text-muted`, `--sabou-bg`, `--sabou-surface`, `--sabou-border`, `--sabou-border-strong`                                          | `border` pour séparer, `border-strong` pour le contour d'un champ                                                                                                                                                                             |
| États                 | `--sabou-{info,success,warning,error}` et leurs `-bg`, `-border`                                                                                          | Toujours avec un texte qui dit l'état (la couleur seule ne suffit pas)                                                                                                                                                                        |
| Typographie           | `--sabou-font-title` (Cambria → Georgia → serif), `--sabou-font-text` (Calibri → Segoe UI → Roboto → … → sans-serif), tailles `--sabou-text-xs` à `-3xl`  | Texte courant 16 px, légendes 13 px, interlignage 1,5                                                                                                                                                                                         |
| Espacements           | `--sabou-space-1` (4 px) à `-8` (64 px) ; grille `--sabou-grid-gutter` 18 px                                                                              | Pas de 4 px                                                                                                                                                                                                                                   |
| Formes                | `--sabou-radius-sm/md/lg` (8, 12, 16 px), `--sabou-shadow-1/2`                                                                                            | Champs et boutons 8 px, cartes 12 px                                                                                                                                                                                                          |

## Composants (`src/index.ts`)

| Composant                  | Rôle                                                           | À savoir                                                                                                         |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `AppShell`                 | Bandeau, navigation latérale groupée par rubriques, contenu    | Navigation selon le rôle, fournie par l'application ; sur téléphone, bouton « Menu » ; lien « Aller au contenu » |
| `PageHeader`               | Titre de page (`h1`), phrase d'introduction, actions           | Un par page                                                                                                      |
| `Button`, `ButtonLink`     | `primary`, `secondary`, `tertiary`, `danger` ; `icon`, `block` | Un seul `primary` par zone ; `ButtonLink` pour aller vers une autre page                                         |
| `Alert`                    | `info`, `success`, `warning`, `error`, avec `title`            | Erreur annoncée aussitôt (`role="alert"`) ; jamais d'erreur pour annoncer une réussite                           |
| `TextField`, `SelectField` | Champ avec libellé, aide (`hint`) et erreur (`error`)          | Les liens d'accessibilité sont posés par le composant                                                            |
| `Card`                     | Bloc à titre (`h2` ou `h3`) et actions                         | —                                                                                                                |
| `StatCard`                 | Chiffre clé du tableau de bord                                 | `value={null}` + `upcoming="Sprint 3"` pour annoncer une fonction à venir                                        |
| `DataTable`                | Tableau de données                                             | `caption` obligatoire ; défile dans son cadre sur téléphone                                                      |
| `Badge`                    | Pastille d'état (`neutral`, `success`, `warning`, `error`)     | —                                                                                                                |
| `Icon`                     | Icônes au trait (`info`, `users`, `dashboard`…)                | Décorative par défaut ; ajouter une icône = un tracé dans `Icon.tsx`                                             |

Classes utilitaires de mise en page : `ui-grid` (cartes, colonnes automatiques), `ui-grid--wide`, `ui-section`, `ui-list`, `ui-form`, `ui-form__actions`, `ui-muted`, `ui-visually-hidden`.

## Contrôles

`pnpm --filter @sabou/ui test` : contrastes AA de chaque couple de couleurs employé, couleurs de la charte inchangées, aucun emoji, aucun trait latéral, aucune couleur en dur hors `tokens.css`, polices terminées par la famille générique, accessibilité des composants. Les pages qui les emploient passent en plus axe et Lighthouse CI (seuils de US-010).

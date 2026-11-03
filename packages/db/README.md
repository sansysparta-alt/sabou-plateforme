# @sabou/db — base de données

Source de vérité du schéma PostgreSQL de SABOU : migrations versionnées (Atlas), jeu d'exemple fictif et requêtes d'exemple, prouvés par des tests sur un vrai PostgreSQL 17 + PostGIS. Le modèle est décrit dans [`Plateforme/docs/00_Conception_BDD_SABOU.md`](../../Plateforme/docs/00_Conception_BDD_SABOU.md), les règles métier dans [`04_Regles_Metier.md`](../../Plateforme/docs/04_Regles_Metier.md).

```
migrations/          migrations Atlas, une par changement, et atlas.sum (empreintes)
seed/dev.sql         jeu d'exemple fictif (développement et tests, jamais en recette ni en production)
examples/queries.sql requêtes d'exemple et cas interdits, exécutés par les tests
sync/                configuration de PowerSync et règles de synchronisation vers les téléphones
src/                 lancement d'Atlas, contrôle des empreintes, commandes db:*
test/                tests (Vitest + Testcontainers)
```

## Commandes (environnement local démarré par `pnpm env:up`)

| Commande          | Effet                                                     |
| ----------------- | --------------------------------------------------------- |
| `pnpm db:migrate` | Applique les migrations en attente                        |
| `pnpm db:seed`    | Charge le jeu d'exemple dans une base migrée et vide      |
| `pnpm db:hash`    | Recalcule `atlas.sum` après l'**ajout** d'une migration   |
| `pnpm test`       | Tests, dont ceux de la base (Docker Desktop doit tourner) |

Repartir d'une base vide : `pnpm env:reset`, `pnpm env:up`, `pnpm db:migrate`, `pnpm db:seed`.

## Règles

1. **Une migration appliquée ne se modifie jamais.** Toute évolution passe par une nouvelle migration, nommée `AAAAMMJJHHMMSS_description.sql`, suivie de `pnpm db:hash`.
2. Chaque migration s'exécute dans une transaction : la première erreur arrête tout et annule la migration fautive en entier.
3. Une migration appliquée puis modifiée est refusée deux fois :
   - par Atlas, tant que `atlas.sum` n'a pas été recalculé ;
   - par le contrôle des empreintes (`src/verify.ts`), même après `pnpm db:hash` : la base garde l'empreinte de chaque migration appliquée, comparée à celle du fichier avant toute application. Ce contrôle protège aussi la recette et la production.
4. Les migrations tournent avec le rôle `sabou_migrator`, propriétaire de la base. L'API utilise `sabou_app`, qui lit et écrit les données sans jamais toucher à la structure, et n'ajoute au journal d'audit que des lignes (R-DON-02). Les rôles et PostGIS sont créés par l'infrastructure, pas par les migrations.
5. PowerSync lit les tables publiées (`powersync`) sous le rôle `sabou_sync`, sans RLS : le cloisonnement par zone de ce qui part vers les téléphones est dans `sync/sync-rules.yaml`, prouvé par `test/sync-zone.test.ts`. Toute table ajoutée à la publication exige sa règle et son test.
6. Aucun texte en langue nationale, y compris dans le jeu d'exemple : les langues nationales sont des voix.

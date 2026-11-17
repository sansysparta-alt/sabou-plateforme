-- US-023 : découpage administratif d'août 2026 (R-ACC-08, 05_Choix_Techniques.md §2.58).
--   Source : liste fournie par le maître d'œuvre le 17 novembre 2026, retenue telle quelle :
--   10 régions administratives, 44 préfectures (plus la zone spéciale de Conakry, gérée
--   comme une préfecture). Données publiques, pas de données personnelles.
--   - Deux régions nouvelles : Siguiri (Haute Guinée, malinké par défaut) et Beyla
--     (Guinée Forestière, guerzé par défaut). La langue par défaut vient de la région
--     naturelle (R-LNG-07) : rien à stocker de plus.
--   - Les préfectures de Siguiri et de Beyla quittent Kankan et N'Zérékoré pour leur
--     nouvelle région : leurs praticiens, dossiers et comptes préfectoraux suivent, car le
--     cloisonnement (RLS) lit la région à travers la préfecture.
--   - 11 préfectures nouvelles.
--   - ON CONFLICT DO NOTHING et rattachements par nom : migration rejouable sur une base
--     locale qui aurait déjà reçu une partie de ces lignes.
--   Les redécoupages suivants passeront par l'écran Référentiels (US-022), sans migration.
SET search_path = sabou, public;

INSERT INTO region_admin (nom, region_naturelle_id)
SELECT r.nom, n.id
  FROM (VALUES (1, 'Siguiri', 'HG'), (2, 'Beyla', 'GF')) AS r(ordre, nom, naturelle)
  JOIN region_naturelle n ON n.code = r.naturelle
 ORDER BY r.ordre
ON CONFLICT DO NOTHING;

-- Rattachement des deux préfectures chefs-lieux à leur nouvelle région
UPDATE prefecture p
   SET region_admin_id = (SELECT id FROM region_admin WHERE nom = m.region)
  FROM (VALUES ('Siguiri', 'Kankan', 'Siguiri'),
               ('Beyla', 'N''Zérékoré', 'Beyla')) AS m(prefecture, ancienne, region)
 WHERE p.nom = m.prefecture
   AND p.region_admin_id = (SELECT id FROM region_admin WHERE nom = m.ancienne);

INSERT INTO prefecture (nom, region_admin_id)
SELECT p.nom, r.id
  FROM (VALUES
         (1, 'Kamsar', 'Boké'),
         (2, 'Timbo', 'Mamou'),
         (3, 'Tokounou', 'Kankan'), (4, 'Djalakoro', 'Kankan'), (5, 'Sabadou-Baranama', 'Kankan'),
         (6, 'Doko', 'Siguiri'), (7, 'Siguirini', 'Siguiri'), (8, 'Kintinia', 'Siguiri'),
         (9, 'Sinko', 'Beyla'), (10, 'Kouankan', 'Beyla'), (11, 'Karala', 'Beyla'))
       AS p(ordre, nom, region)
  JOIN region_admin r ON r.nom = p.region
 ORDER BY p.ordre
ON CONFLICT DO NOTHING;

COMMENT ON TABLE region_admin IS
  'Régions administratives du découpage en vigueur (R-ACC-08), gérées par la DG ; 10 depuis août 2026.';

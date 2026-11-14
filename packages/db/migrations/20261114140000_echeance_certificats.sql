-- US-049 : expirer les certificats et relancer les praticiens 60 jours avant (UC-71,
-- R-QR-01, R-QR-07, R-CER-08).
--   - Un certificat est valable jusqu'à sa date d'échéance incluse (expire_le) ; le
--     lendemain, à 0 h (heure de Conakry), il passe « expiré » : le praticien sort de
--     l'annuaire public (v_annuaire_public ne montre que les certificats actifs) et la
--     vérification du QR répond « ambre » (R-QR-05).
--   - 60 jours avant l'échéance, à partir de 8 h (pas de SMS la nuit), le praticien reçoit
--     une seule invitation à renouveler, sauf si un dossier de renouvellement est déjà en
--     cours. L'ouverture du dossier de renouvellement lui-même arrive avec son récit (R-QR-07).
--   - Le statut du praticien ne change pas : « certifié » sans certificat actif, il retrouve
--     l'annuaire dès l'émission du nouveau certificat.
-- Voir 05_Choix_Techniques.md §2.37.

SET search_path = sabou, public;

-- Date de la relance, une seule par certificat ; NULL tant qu'elle n'est pas partie
ALTER TABLE certificat ADD COLUMN relance_renouvellement_le timestamptz;
COMMENT ON COLUMN certificat.relance_renouvellement_le IS
  'Heure de mise en file de l''invitation à renouveler (60 jours avant l''échéance) ; NULL tant qu''elle n''est pas partie.';

-- Certificats actifs par échéance : seuls ceux-là sont parcourus à chaque passage
CREATE INDEX ix_certificat_echeance ON certificat (expire_le) WHERE statut = 'actif';

-- Ancienne fonction du schéma initial, jamais appelée : elle prenait la date du serveur
-- et ne journalisait rien. Remplacée par certificats_echeances_traiter.
DROP FUNCTION expirer_certificats();

-- ---------------------------------------------------------------------
-- Tâche quotidienne, appelée par l'API avant chaque relève de la file des SMS : elle ne fait
-- quelque chose qu'au premier passage après minuit (expiration) et après 8 h le 60e jour
-- (relance), et rattrape tout passage manqué (API arrêtée). Elle parcourt toutes les zones,
-- d'où SECURITY DEFINER, et ne fait que cela.
-- p_maintenant : l'heure de référence, fixée par les tests ; l'API ne la passe pas.
CREATE FUNCTION certificats_echeances_traiter(p_maintenant timestamptz DEFAULT now())
RETURNS TABLE (expires integer, relances integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sabou, pg_catalog, pg_temp AS $$
DECLARE
  v_local timestamp := p_maintenant AT TIME ZONE 'Africa/Conakry';
  v_jour  date := v_local::date;
BEGIN
  -- Critère 1 : échéance dépassée ⇒ « expiré », tracé dans le journal (action automatique)
  WITH echus AS (
    UPDATE certificat SET statut = 'expire'
     WHERE statut = 'actif' AND expire_le < v_jour
    RETURNING numero, praticien_id, expire_le)
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  SELECT NULL, 'certificat.expire', 'certificat', e.numero,
         jsonb_build_object('praticien', p.code, 'expireLe', e.expire_le, 'automatique', true)
    FROM echus e JOIN praticien p ON p.id = e.praticien_id;
  GET DIAGNOSTICS expires = ROW_COUNT;

  -- Critère 2 : invitation à renouveler, à partir de 8 h le 60e jour avant l'échéance
  relances := 0;
  IF v_local::time >= time '08:00' THEN
    WITH dus AS (
      SELECT c.id FROM certificat c
       WHERE c.statut = 'actif' AND c.relance_renouvellement_le IS NULL
         AND c.expire_le - 60 <= v_jour
         AND NOT EXISTS (SELECT 1 FROM dossier_certification d
                          WHERE d.praticien_id = c.praticien_id AND d.statut = 'en_cours'
                            AND d.type = 'renouvellement')
       FOR UPDATE OF c SKIP LOCKED),
    marques AS (
      UPDATE certificat c SET relance_renouvellement_le = p_maintenant
        FROM dus WHERE c.id = dus.id
      RETURNING c.numero, c.praticien_id, c.expire_le)
    INSERT INTO notification (destinataire_id, canal, modele, objet_type, objet_id, parametres)
    SELECT p.utilisateur_id, 'sms', 'certificat.renouvellement', 'certificat', m.numero,
           jsonb_build_object('expireLe', to_char(m.expire_le, 'YYYY-MM-DD'))
      FROM marques m JOIN praticien p ON p.id = m.praticien_id;
    GET DIAGNOSTICS relances = ROW_COUNT;
  END IF;
  RETURN NEXT;
END $$;
REVOKE EXECUTE ON FUNCTION certificats_echeances_traiter(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION certificats_echeances_traiter(timestamptz) TO sabou_app;

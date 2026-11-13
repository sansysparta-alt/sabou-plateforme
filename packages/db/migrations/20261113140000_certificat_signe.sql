-- US-045 : la DG approuve un dossier à l'étape 5 et émet un certificat signé (UC-60,
-- R-QR-01 à R-QR-04, R-QR-07 ; 05_Choix_Techniques.md §2.34).
-- Partage des rôles :
--   - la base fixe le numéro et les dates (certificat_preparer) puis enregistre le certificat
--     et fait passer le dossier à l'étape 6, dans la même transaction (certificat_emettre) ;
--   - l'API calcule l'empreinte SHA3-256 et fait signer par le coffre (OpenBao Transit, clé
--     Ed25519 non exportable) : la clé privée n'est jamais lue par l'application.
-- Décision du maître d'œuvre (12 novembre 2026) : le certificat est une page imprimable de
-- l'application de gestion (données, QR, empreinte) ; le PDF viendra plus tard (S9).
SET search_path = sabou, public;

-- ---------------------------------------------------------------------
-- Clés de signature : identifiant porté par l'en-tête du QR (R-QR-04)
ALTER TABLE cle_signature ADD COLUMN kid text;
UPDATE cle_signature SET kid = 'cle-' || id WHERE kid IS NULL;
ALTER TABLE cle_signature
  ALTER COLUMN kid SET NOT NULL,
  ADD CONSTRAINT ux_cle_signature_kid UNIQUE (kid),
  ADD CONSTRAINT ck_cle_signature_kid CHECK (kid ~ '^[a-z0-9-]{1,64}$');
COMMENT ON COLUMN cle_signature.kid IS
  'Identifiant de la clé dans l''en-tête du QR : « dg- » suivi de 8 caractères de l''empreinte SHA3-256 de la clé publique.';
COMMENT ON COLUMN cle_signature.cle_publique IS
  'Clé publique Ed25519 brute (32 octets) en base64url, comme le champ « x » d''une JWK (RFC 8037).';

-- ---------------------------------------------------------------------
-- Certificat : texte du QR tel que signé. Nul pour les certificats fictifs du jeu d'exemple ;
-- toujours présent pour un certificat émis par certificat_emettre.
ALTER TABLE certificat
  ADD COLUMN qr text CHECK (qr LIKE 'SB1:%' AND char_length(qr) <= 1024);
COMMENT ON COLUMN certificat.qr IS
  'Texte du QR (« SB1: » + Base45 d''un COSE_Sign1) : données, empreinte, identifiant de la clé et signature (05 §2.16).';
COMMENT ON COLUMN certificat.signature IS
  'Signature Ed25519 (base64) de la structure Signature1 de COSE, qui couvre les données, l''empreinte et l''identifiant de la clé (R-QR-03).';
CREATE INDEX ix_certificat_dossier ON certificat (dossier_id);

-- ---------------------------------------------------------------------
-- Une approbation à l'étape 5 exige le certificat actif du dossier (R-QR-01). Contrôle sur
-- l'historique : toute validation à l'étape 5 passe par lui, sans réécrire dossier_transition.
CREATE FUNCTION trg_approbation_certificat() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM certificat c
                  WHERE c.dossier_id = NEW.dossier_id AND c.statut = 'actif') THEN
    RAISE EXCEPTION 'Dossier % : certificat signé requis pour approuver', NEW.dossier_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_approbation_certificat BEFORE INSERT ON dossier_historique
  FOR EACH ROW WHEN (NEW.decision = 'valide' AND NEW.etape_depart = 5)
  EXECUTE FUNCTION trg_approbation_certificat();

-- ---------------------------------------------------------------------
-- Contrôles communs : dossier en cours à l'étape 5, acteur DG actif.
CREATE FUNCTION certificat_controler(p_dossier bigint, p_acteur bigint)
RETURNS dossier_certification LANGUAGE plpgsql AS $$
DECLARE v_dos dossier_certification%ROWTYPE;
BEGIN
  -- RLS : un dossier hors zone est introuvable, comme un dossier inexistant
  SELECT * INTO v_dos FROM dossier_certification WHERE id = p_dossier FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dossier % introuvable', p_dossier; END IF;
  IF NOT EXISTS (SELECT 1 FROM utilisateur u
                  WHERE u.id = p_acteur AND u.statut = 'actif' AND u.role_code = 'dg') THEN
    RAISE EXCEPTION 'Acteur % non habilité pour l''étape 5 du dossier %', p_acteur, v_dos.code;
  END IF;
  IF v_dos.statut <> 'en_cours' OR v_dos.etape_courante <> 5 THEN
    RAISE EXCEPTION 'Dossier % : approbation possible à l''étape 5 seulement', v_dos.code;
  END IF;
  RETURN v_dos;
END $$;

-- Données du certificat à signer : numéro, titulaire, dates (12 mois, R-QR-01). Le jour
-- d'émission est celui de Conakry. Le numéro reprend le code du praticien, suivi de 3
-- caractères tirés au sort parmi ceux qu'on ne confond pas à la lecture.
CREATE FUNCTION certificat_preparer(p_dossier bigint, p_acteur bigint)
RETURNS TABLE (numero text, titulaire text, emis_le date, expire_le date)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE v_dos     dossier_certification%ROWTYPE;
        v_code    text;
        v_nom     text;
        v_emis    date := (now() AT TIME ZONE 'Africa/Conakry')::date;
        v_numero  text;
        v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
BEGIN
  v_dos := certificat_controler(p_dossier, p_acteur);
  SELECT replace(p.code, '-', ''), u.prenom || ' ' || u.nom INTO v_code, v_nom
    FROM praticien p JOIN utilisateur u ON u.id = p.utilisateur_id
   WHERE p.id = v_dos.praticien_id;
  LOOP
    v_numero := 'SAB-' || extract(year FROM v_emis) || '-' || v_code || '-'
             || (SELECT string_agg(substr(v_alphabet, 1 + floor(random() * 32)::int, 1), '')
                   FROM generate_series(1, 3));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM certificat c WHERE c.numero = v_numero);
  END LOOP;
  RETURN QUERY SELECT v_numero, v_nom, v_emis, (v_emis + interval '12 months' - interval '1 day')::date;
END $$;

-- Enregistre le certificat signé et approuve le dossier (étape 5 → 6), en une transaction :
--   - les données doivent être celles de certificat_preparer (dates du jour, 12 mois) ;
--   - la clé publique est enregistrée à sa première utilisation, refusée si elle est révoquée
--     ou si son identifiant désigne déjà une autre clé ;
--   - renouvellement : le certificat actif du praticien passe « expiré » (R-QR-07) ;
--   - dossier_transition écrit l'historique, le SMS au praticien et le journal d'audit.
CREATE FUNCTION certificat_emettre(p_dossier bigint, p_acteur bigint, p_numero text,
                                   p_emis_le date, p_expire_le date, p_empreinte text,
                                   p_signature text, p_kid text, p_cle_publique text, p_qr text)
RETURNS smallint LANGUAGE plpgsql AS $$
DECLARE v_dos   dossier_certification%ROWTYPE;
        v_cle   smallint;
        v_emis  date := (now() AT TIME ZONE 'Africa/Conakry')::date;
BEGIN
  v_dos := certificat_controler(p_dossier, p_acteur);
  IF p_emis_le IS DISTINCT FROM v_emis
     OR p_expire_le IS DISTINCT FROM (v_emis + interval '12 months' - interval '1 day')::date THEN
    RAISE EXCEPTION 'Dossier % : dates du certificat périmées, à préparer de nouveau', v_dos.code;
  END IF;
  IF p_numero IS NULL OR p_numero !~ ('^SAB-[0-9]{4}-' || replace((SELECT code FROM praticien
                                       WHERE id = v_dos.praticien_id), '-', '') || '-[A-Z2-9]{3}$') THEN
    RAISE EXCEPTION 'Dossier % : numéro de certificat invalide', v_dos.code;
  END IF;
  IF p_qr IS NULL THEN RAISE EXCEPTION 'Dossier % : QR du certificat manquant', v_dos.code; END IF;

  INSERT INTO cle_signature (kid, cle_publique) VALUES (p_kid, p_cle_publique)
    ON CONFLICT DO NOTHING;
  SELECT id INTO v_cle FROM cle_signature
   WHERE kid = p_kid AND cle_publique = p_cle_publique AND revoquee_le IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clé de signature % inconnue ou révoquée', p_kid;
  END IF;

  UPDATE certificat SET statut = 'expire'
   WHERE praticien_id = v_dos.praticien_id AND statut = 'actif';
  INSERT INTO certificat (numero, praticien_id, dossier_id, emis_par, emis_le, expire_le,
                          empreinte_sha3, signature, cle_id, qr)
  VALUES (p_numero, v_dos.praticien_id, v_dos.id, p_acteur, p_emis_le, p_expire_le,
          p_empreinte, p_signature, v_cle, p_qr);
  INSERT INTO journal_audit (utilisateur_id, action, objet_type, objet_id, details)
  VALUES (p_acteur, 'certificat.emis', 'certificat', p_numero,
          jsonb_build_object('dossier', v_dos.code, 'cle', p_kid, 'empreinte', p_empreinte));

  RETURN dossier_transition(v_dos.id, 'valide', p_acteur);
END $$;

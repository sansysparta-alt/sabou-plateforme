#!/bin/sh
# Préparation du coffre OpenBao du poste local (US-045, 05_Choix_Techniques.md §2.34).
# Lancé par le service « openbao-init » à chaque « pnpm env:up » ; sans effet s'il est déjà prêt.
#   1. moteur Transit et clé Ed25519 « sabou-dg » de la DG, non exportable : la clé privée
#      ne sort jamais du coffre, pas même pour une sauvegarde en clair ;
#   2. politique « sabou-api » : signer avec cette clé et lire ses clés publiques, rien d'autre
#      (ni export, ni rotation, ni suppression) ;
#   3. jeton de l'API, propre à cette politique, écrit dans le volume partagé avec l'API.
# Le jeton racine (OPENBAO_ROOT_TOKEN) ne sert qu'ici ; l'API ne le connaît pas.
set -eu

export BAO_ADDR=http://openbao:8200
export BAO_TOKEN="$OPENBAO_ROOT_TOKEN"
TOKEN_FILE=/run/openbao/jeton-api

if ! bao secrets list -format=json | grep -q '"transit/"'; then
  bao secrets enable transit
fi
if ! bao read -format=json transit/keys/sabou-dg > /dev/null 2>&1; then
  bao write -f transit/keys/sabou-dg type=ed25519 exportable=false allow_plaintext_backup=false
fi

bao policy write sabou-api - << 'EOF'
path "transit/sign/sabou-dg" {
  capabilities = ["update"]
}
path "transit/keys/sabou-dg" {
  capabilities = ["read"]
}
EOF

# Jeton encore valide (même coffre) : on le garde ; sinon (premier lancement, coffre
# redémarré, donc vidé, ou jeton échu) : nouveau jeton, valable 32 jours
if [ -s "$TOKEN_FILE" ] && bao token lookup "$(cat "$TOKEN_FILE")" > /dev/null 2>&1; then
  echo "Coffre prêt, jeton de l'API inchangé"
  exit 0
fi
umask 0222
rm -f "$TOKEN_FILE"
bao token create -policy=sabou-api -no-default-policy -orphan -ttl=768h -field=token > "$TOKEN_FILE"
echo "Coffre prêt, nouveau jeton de l'API"

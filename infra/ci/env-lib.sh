# Fonctions communes aux contrôles de l'environnement local (à sourcer après env.sh).

compose() {
  docker compose --file infra/local/compose.yaml --env-file .env "$@"
}

# Usage : expect_ready code_http corps_attendu
# Interroge GET /health/ready de l'API et compare le code et le corps exacts.
expect_ready() {
  local port body code
  port="$(sed -n 's/^API_PORT=//p' .env)"
  body="$(curl --silent --max-time 10 --write-out '\n%{http_code}' "http://127.0.0.1:${port:-4000}/health/ready")"
  code="${body##*$'\n'}"
  body="${body%$'\n'*}"
  if [[ "$code" != "$1" || "$body" != "$2" ]]; then
    echo "ÉCHEC : /health/ready : attendu $1 $2, reçu $code $body" >&2
    return 1
  fi
}

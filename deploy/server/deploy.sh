#!/usr/bin/env bash
# Build the GunBros image and ship it to the server (docs/DEPLOY.md).
#
#   deploy/server/deploy.sh [HOST]        # or GUNBROS_HOST=HOST, or `pnpm deploy:prod`
#
# Needs docker (with buildx) and SSH access as `deploy@HOST`. No registry: the image is
# built here for linux/amd64, streamed over SSH with `docker save | docker load`, and
# started with docker compose in /opt/gunbros. Then it waits for /health over HTTPS.
#
# Environment:
#   GUNBROS_HOST     server address or name (if no argument)
#   DEPLOY_USER      SSH user (deploy)
#   GAME_DOMAIN      public name, for the health check (play.gunbros.example.com)
#   HEALTH_URL       override the health check URL (https://$GAME_DOMAIN/health)
#   HEALTH_TIMEOUT   seconds to wait for it (180)
#   CURL_OPTS        extra curl flags for the health check (e.g. -k for a test CA)
#   PLATFORM         image platform (linux/amd64)
#   KEEP_IMAGES      tagged images kept on the server for rollback (3)
#   SSH_KEY          private key to log in with (default: ssh's own choice), e.g.
#                    ~/.ssh/gunbros_deploy when your usual key needs a passphrase
#   ADMIN_PASSWORD   password for /admin, written into the server's .env (default: the
#                    git-ignored .admin-password at the repo root; with neither, the
#                    server keeps whatever password its .env already has)
#
# Every image is also tagged with the git short SHA, so the server keeps the last few:
#   ssh deploy@HOST 'docker tag gunbros:<sha> gunbros:latest && cd /opt/gunbros && docker compose up -d'
set -euo pipefail

HOST="${1:-${GUNBROS_HOST:-}}"
if [[ -z "$HOST" ]]; then
  echo "usage: deploy.sh HOST   (or set GUNBROS_HOST)" >&2
  exit 2
fi
DEPLOY_USER="${DEPLOY_USER:-deploy}"
GAME_DOMAIN="${GAME_DOMAIN:-play.gunbros.example.com}"
HEALTH_URL="${HEALTH_URL:-https://${GAME_DOMAIN}/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
PLATFORM="${PLATFORM:-linux/amd64}"
KEEP_IMAGES="${KEEP_IMAGES:-3}"
REMOTE="${DEPLOY_USER}@${HOST}"
ssh_opts=()
if [[ -n "${SSH_KEY:-}" ]]; then
  ssh_opts=(-i "$SSH_KEY" -o IdentitiesOnly=yes)
fi
APP_DIR=/opt/gunbros

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"

for tool in docker ssh scp curl git; do
  command -v "$tool" >/dev/null 2>&1 || { echo "deploy.sh: $tool not found" >&2; exit 1; }
done

if [[ -z "${ADMIN_PASSWORD:-}" && -f "$root/.admin-password" ]]; then
  ADMIN_PASSWORD="$(head -n 1 "$root/.admin-password")"
fi
# Letters, digits and a few safe marks only: it goes into an env file unquoted.
if [[ -n "${ADMIN_PASSWORD:-}" && ! "$ADMIN_PASSWORD" =~ ^[A-Za-z0-9._~-]{16,}$ ]]; then
  echo "deploy.sh: ADMIN_PASSWORD must be 16+ characters of [A-Za-z0-9._~-]" >&2
  exit 1
fi

tag="$(git -C "$root" rev-parse --short HEAD)"
if [[ -n "$(git -C "$root" status --porcelain)" ]]; then
  tag="${tag}-dirty"
fi

echo "==> build gunbros:${tag} (${PLATFORM})"
docker buildx build --platform "$PLATFORM" --load --build-arg "GIT_SHA=${tag}" \
  -t "gunbros:${tag}" -t gunbros:latest "$root"

echo "==> ship to ${REMOTE}"
docker save "gunbros:${tag}" gunbros:latest | gzip -1 | ssh ${ssh_opts[@]+"${ssh_opts[@]}"} "$REMOTE" 'gunzip | docker load'

if [[ -n "${ADMIN_PASSWORD:-}" ]]; then
  echo "==> admin password"
  # Over stdin, so it is never on a command line on either machine.
  printf '%s\n' "$ADMIN_PASSWORD" | ssh ${ssh_opts[@]+"${ssh_opts[@]}"} "$REMOTE" \
    'set -e; read -r pw; cd '"${APP_DIR}"'; touch .env
     { grep -v "^ADMIN_PASSWORD=" .env || true; printf "ADMIN_PASSWORD=%s\n" "$pw"; } > .env.new
     chmod 600 .env.new; mv .env.new .env'
fi

echo "==> compose up"
scp -q ${ssh_opts[@]+"${ssh_opts[@]}"} "$here/compose.yaml" "$here/Caddyfile" "${REMOTE}:${APP_DIR}/"
# shellcheck disable=SC2087  # expand KEEP_IMAGES and APP_DIR here, on purpose
ssh ${ssh_opts[@]+"${ssh_opts[@]}"} "$REMOTE" bash -s <<EOF
set -euo pipefail
cd ${APP_DIR}
docker compose up -d --remove-orphans
# Keep the newest ${KEEP_IMAGES} SHA tags for rollback, drop older ones and dangling layers.
docker images gunbros --format '{{.Tag}}' | grep -v '^latest\$' | tail -n +$((KEEP_IMAGES + 1)) \
  | xargs -r -I{} docker rmi 'gunbros:{}' >/dev/null || true
docker image prune -f >/dev/null
EOF

echo "==> wait for ${HEALTH_URL}"
deadline=$((SECONDS + HEALTH_TIMEOUT))
# shellcheck disable=SC2086  # CURL_OPTS is a list of flags
until body="$(curl -fsS --max-time 5 ${CURL_OPTS:-} "$HEALTH_URL" 2>/dev/null)" && [[ "$body" == *'"ok":true'* ]]; do
  if (( SECONDS >= deadline )); then
    echo "deploy.sh: ${HEALTH_URL} not healthy after ${HEALTH_TIMEOUT}s" >&2
    echo "  logs: ssh ${REMOTE} 'cd ${APP_DIR} && docker compose logs --tail 100'" >&2
    exit 1
  fi
  sleep 3
done
echo "    ${body}"
echo "==> deployed gunbros:${tag} to ${HOST}"

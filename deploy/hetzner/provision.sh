#!/usr/bin/env bash
# Create the GunBros server on Hetzner Cloud (docs/DEPLOY.md, "Hetzner").
#
#   hcloud context create gunbros        # once: stores the API token in the CLI
#   deploy/hetzner/provision.sh [OWNER_PUBKEY_FILE]
#
# Auth: the active hcloud context, or HCLOUD_TOKEN in the environment.
#
# Idempotent: creates what is missing (SSH keys, firewall, server) and leaves what exists.
# The server boots with cloud-init.yaml, which runs deploy/server/bootstrap.sh.
# Nothing paid beyond the server itself: no backups, volumes, load balancer, floating IP.
#
# Environment (all optional):
#   SERVER_NAME      gunbros
#   SERVER_TYPE      cx23          smallest shared x86 (`hcloud server-type list`)
#   LOCATION         nbg1          Nuremberg (`hcloud location list`)
#   IMAGE            ubuntu-24.04
#   OWNER_PUBKEY     first of ~/.ssh/id_ed25519.pub, ~/.ssh/id_rsa.pub (or the first argument)
#   DEPLOY_PUBKEY    ~/.ssh/gunbros_deploy.pub   CI key, added too if the file exists
#   GAME_DOMAIN      play.gunbros.example.com  (only for the printed DNS records)
set -euo pipefail

SERVER_NAME="${SERVER_NAME:-gunbros}"
SERVER_TYPE="${SERVER_TYPE:-cx23}"
LOCATION="${LOCATION:-nbg1}"
IMAGE="${IMAGE:-ubuntu-24.04}"
if [[ -z "${1:-}${OWNER_PUBKEY:-}" ]]; then
  for candidate in "$HOME/.ssh/id_ed25519.pub" "$HOME/.ssh/id_rsa.pub"; do
    if [[ -f "$candidate" ]]; then OWNER_PUBKEY="$candidate"; break; fi
  done
fi
OWNER_PUBKEY="${1:-${OWNER_PUBKEY:-$HOME/.ssh/id_ed25519.pub}}"
DEPLOY_PUBKEY="${DEPLOY_PUBKEY:-$HOME/.ssh/gunbros_deploy.pub}"
GAME_DOMAIN="${GAME_DOMAIN:-play.gunbros.example.com}"
FIREWALL="${SERVER_NAME}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { echo "provision.sh: $*" >&2; exit 1; }
command -v hcloud >/dev/null 2>&1 || die "hcloud not found (brew install hcloud)"
[[ -f "$OWNER_PUBKEY" ]] || die "no public key at $OWNER_PUBKEY (pass a path as the first argument)"
hcloud server list >/dev/null 2>&1 || die "hcloud cannot reach the API. Run 'hcloud context create gunbros' with a
  read & write API token (Hetzner console > project > Security > API tokens), or export HCLOUD_TOKEN."

# Register a public key once and print the name Hetzner knows it by. A key already
# uploaded under another name is found by its fingerprint and reused.
ensure_key() {
  local file="$1" name="$2" fp existing
  fp="$(ssh-keygen -l -E md5 -f "$file" | awk '{print $2}' | sed 's/^MD5://')"
  existing="$(hcloud ssh-key list -o noheader -o columns=name,fingerprint | awk -v fp="$fp" '$2 == fp {print $1; exit}')"
  if [[ -n "$existing" ]]; then
    echo "$existing"
    return
  fi
  hcloud ssh-key create --name "$name" --public-key-from-file "$file" >/dev/null
  echo "$name"
}

echo "==> ssh keys"
key_args=(--ssh-key "$(ensure_key "$OWNER_PUBKEY" "${SERVER_NAME}-owner")")
if [[ -f "$DEPLOY_PUBKEY" ]]; then
  key_args+=(--ssh-key "$(ensure_key "$DEPLOY_PUBKEY" "${SERVER_NAME}-deploy")")
else
  echo "    no CI key at $DEPLOY_PUBKEY; add it to deploy's authorized_keys later (docs/DEPLOY.md)"
fi

echo "==> firewall ${FIREWALL}"
rules="$(mktemp)"
trap 'rm -f "$rules" "${user_data:-}"' EXIT
cat > "$rules" <<'JSON'
[
  {"direction": "in", "protocol": "tcp", "port": "22",  "source_ips": ["0.0.0.0/0", "::/0"], "description": "ssh"},
  {"direction": "in", "protocol": "tcp", "port": "80",  "source_ips": ["0.0.0.0/0", "::/0"], "description": "http (ACME, redirect)"},
  {"direction": "in", "protocol": "tcp", "port": "443", "source_ips": ["0.0.0.0/0", "::/0"], "description": "https + wss"},
  {"direction": "in", "protocol": "icmp", "source_ips": ["0.0.0.0/0", "::/0"], "description": "ping"}
]
JSON
if hcloud firewall describe "$FIREWALL" >/dev/null 2>&1; then
  hcloud firewall replace-rules "$FIREWALL" --rules-file "$rules" >/dev/null
else
  hcloud firewall create --name "$FIREWALL" --rules-file "$rules" >/dev/null
fi

echo "==> server ${SERVER_NAME} (${SERVER_TYPE}, ${LOCATION}, ${IMAGE})"
if hcloud server describe "$SERVER_NAME" >/dev/null 2>&1; then
  echo "    exists; left as it is (delete it in the console to start over)"
else
  user_data="$(mktemp)"
  b64="$(base64 < "$here/../server/bootstrap.sh" | tr -d '\n')"
  sed "s|content: __BOOTSTRAP_B64__|content: ${b64}|" "$here/cloud-init.yaml" > "$user_data"
  hcloud server create \
    --name "$SERVER_NAME" \
    --type "$SERVER_TYPE" \
    --location "$LOCATION" \
    --image "$IMAGE" \
    "${key_args[@]}" \
    --firewall "$FIREWALL" \
    --user-data-from-file "$user_data" >/dev/null
fi

ipv4="$(hcloud server ip "$SERVER_NAME")"
ipv6="$(hcloud server ip -6 "$SERVER_NAME")"

cat <<DONE

Server ${SERVER_NAME}: ${ipv4}  ${ipv6}

DNS (Cloudflare, proxy status "DNS only" / grey cloud, so Caddy can get its certificate):
  A     ${GAME_DOMAIN}   ${ipv4}
  AAAA  ${GAME_DOMAIN}   ${ipv6}

Next:
  1. Wait a few minutes for cloud-init, then:  ssh deploy@${ipv4} 'cloud-init status --wait; docker --version'
  2. GitHub secrets:  DEPLOY_HOST=${ipv4}, DEPLOY_KNOWN_HOSTS from: ssh-keyscan -t ed25519 ${ipv4}
  3. First deploy:    GUNBROS_HOST=${ipv4} pnpm deploy:prod
DONE

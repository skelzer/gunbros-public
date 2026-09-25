#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server for GunBros (docs/DEPLOY.md).
# Idempotent: running it again changes nothing that is already right.
#
# Run as root, over SSH, from the repository:
#
#   ssh root@HOST "DEPLOY_PUBKEY='$(cat ~/.ssh/gunbros_deploy.pub)' bash -s" < deploy/server/bootstrap.sh
#   ssh ubuntu@HOST "sudo DEPLOY_PUBKEY='$(cat ~/.ssh/gunbros_deploy.pub)' bash -s" < deploy/server/bootstrap.sh
#
# Public keys for the `deploy` user come from, all merged:
#   - DEPLOY_PUBKEY (one or more key lines) and any positional arguments;
#   - root's authorized_keys (what the host injected at creation);
#   - the authorized_keys of the user who ran sudo, if any.
# So whoever can log in now can log in as `deploy` afterwards. The script refuses to
# harden SSH if `deploy` would end up with no key at all.
#
# What it does:
#   - user `deploy` (docker group, passwordless sudo: docker access is root access anyway)
#   - Docker Engine + compose plugin from Docker's apt repository
#   - unattended-upgrades: security updates, reboot at 04:00 UTC when one needs it
#   - ufw: only 22, 80, 443 (tcp) inbound
#   - /opt/gunbros owned by deploy
#   - SSH: keys only, no root login
#   - traffic guard: stops the stack once this month's outgoing traffic passes a cap
set -euo pipefail

if [[ $(id -u) -ne 0 ]]; then
  echo "bootstrap.sh: run as root (or through sudo)" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
DEPLOY_USER=deploy
APP_DIR=/opt/gunbros

echo "==> packages"
apt-get update -q
apt-get install -y -q ca-certificates curl ufw unattended-upgrades vnstat jq

echo "==> docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  codename=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> user ${DEPLOY_USER}"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
echo "${DEPLOY_USER} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-gunbros-deploy
chmod 0440 /etc/sudoers.d/90-gunbros-deploy

home=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
keys="$home/.ssh/authorized_keys"
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh"
touch "$keys"
{
  cat "$keys"
  printf '%s\n' "${DEPLOY_PUBKEY:-}"
  for key in "$@"; do printf '%s\n' "$key"; done
  [[ -f /root/.ssh/authorized_keys ]] && cat /root/.ssh/authorized_keys
  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != root ]]; then
    sudo_home=$(getent passwd "$SUDO_USER" | cut -d: -f6)
    [[ -f "$sudo_home/.ssh/authorized_keys" ]] && cat "$sudo_home/.ssh/authorized_keys"
  fi
} | grep -E '^(ssh-|ecdsa-|sk-)' | sort -u > "$keys.new" || true
mv "$keys.new" "$keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$keys"
chmod 0600 "$keys"
if [[ ! -s "$keys" ]]; then
  echo "bootstrap.sh: ${DEPLOY_USER} has no SSH key; pass DEPLOY_PUBKEY. SSH left unchanged." >&2
  exit 1
fi
echo "    $(wc -l < "$keys") key(s) in $keys"

echo "==> ${APP_DIR}"
install -d -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"

echo "==> unattended-upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
# Ubuntu's 50unattended-upgrades already limits it to security updates. The containers
# come back after a reboot through `restart: unless-stopped`.
cat > /etc/apt/apt.conf.d/52gunbros-unattended-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF
systemctl enable --now unattended-upgrades

echo "==> traffic guard"
# The fixed server price is the whole bill except traffic beyond the plan's included
# 20 TB, which is billed per TB with no ceiling. vnstat counts what leaves the public
# interface; every 5 minutes the guard compares this month's total with the cap and,
# past it, stops Caddy and the game so nothing more goes out. It starts them again
# when a new month begins, or with `sudo gunbros-traffic-guard reset` after raising the cap.
# The cap lives in /etc/gunbros/traffic-guard.conf (TX_CAP_BYTES, default 15 TB).
install -d -m 0755 /etc/gunbros /var/lib/gunbros
[[ -f /etc/gunbros/traffic-guard.conf ]] || cat > /etc/gunbros/traffic-guard.conf <<'EOF'
# Outgoing bytes per calendar month (UTC) before the game is stopped. The plan includes 20 TB.
TX_CAP_BYTES=15000000000000
EOF
cat > /usr/local/sbin/gunbros-traffic-guard <<'EOF'
#!/usr/bin/env bash
# Stop GunBros once this month's outgoing traffic passes TX_CAP_BYTES (docs/DEPLOY.md).
#   gunbros-traffic-guard           check (run by gunbros-traffic-guard.timer)
#   gunbros-traffic-guard status    print this month's usage
#   gunbros-traffic-guard reset     clear a trip and start the stack (raise TX_CAP_BYTES first,
#                                   or the next check trips it again this month)
set -euo pipefail
# shellcheck disable=SC1091
. /etc/gunbros/traffic-guard.conf
APP_DIR=/opt/gunbros
MARK=/var/lib/gunbros/traffic-tripped   # holds the month (YYYY-MM) it tripped in
month=$(date -u +%Y-%m)
iface=$(ip route show default | awk '{print $5; exit}')
tx=$(vnstat --json m 1 -i "$iface" 2>/dev/null | jq -r --arg y "${month%-*}" --arg m "${month#*-}" \
  '[.interfaces[0].traffic.month[]? | select(.date.year == ($y|tonumber) and .date.month == ($m|tonumber)) | .tx] | add // 0')
compose() { (cd "$APP_DIR" && [[ -f compose.yaml ]] && docker compose "$@") || true; }
case "${1:-check}" in
  status)
    echo "${iface}: ${tx} bytes out in ${month}, cap ${TX_CAP_BYTES}"
    [[ -f "$MARK" ]] && echo "tripped in $(cat "$MARK")"
    exit 0 ;;
  reset)
    rm -f "$MARK"; compose up -d; logger -t gunbros-traffic-guard "reset by hand"; exit 0 ;;
esac
if [[ -f "$MARK" && "$(cat "$MARK")" != "$month" ]]; then
  rm -f "$MARK"; compose up -d
  logger -t gunbros-traffic-guard "new month ${month}: stack started again"
fi
if (( tx >= TX_CAP_BYTES )) || [[ -f "$MARK" ]]; then
  [[ -f "$MARK" ]] || { echo "$month" > "$MARK"; logger -t gunbros-traffic-guard "cap reached: ${tx} >= ${TX_CAP_BYTES} bytes out in ${month}; stopping"; }
  compose stop   # also undoes a deploy that started the stack after the trip
fi
EOF
chmod 0755 /usr/local/sbin/gunbros-traffic-guard
cat > /etc/systemd/system/gunbros-traffic-guard.service <<'EOF'
[Unit]
Description=Stop GunBros past its monthly traffic cap
After=docker.service vnstat.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/gunbros-traffic-guard
EOF
cat > /etc/systemd/system/gunbros-traffic-guard.timer <<'EOF'
[Unit]
Description=Check GunBros traffic every 5 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now vnstat gunbros-traffic-guard.timer

echo "==> ufw"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "==> ssh"
# sshd takes the first value it reads, and sshd_config.d is read in name order, so this
# file wins over a host's 50-cloud-init.conf.
cat > /etc/ssh/sshd_config.d/10-gunbros.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
mkdir -p /run/sshd   # sshd -t needs it; under socket activation it may not exist yet
sshd -t
# Restart only if running: under Ubuntu 24.04's socket activation a stopped sshd reads the
# new config on the next connection anyway. Open sessions (this one) are not cut.
systemctl try-restart ssh

echo "==> done. Log in as: ssh ${DEPLOY_USER}@$(hostname -I | awk '{print $1}')"

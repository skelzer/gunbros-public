# Deploying GunBros

One process, one port. `node packages/server/dist/index.js` serves the built client at
`/`, answers `/health`, and upgrades `/ws` (DESIGN §1.5). The `Dockerfile` at the repo
root builds exactly that image; nothing else has to be hosted.

This public copy does not include the GitHub Actions deploy workflow mentioned below;
use `deploy/server/deploy.sh` directly.

## How it runs

```
browser ──https/wss──▶ Caddy :443 ──http──▶ game :8080 (not published)
                       (Let's Encrypt)       rooms in memory
```

- One small Ubuntu 24.04 server, two containers from `deploy/server/compose.yaml`:
  **Caddy** terminates TLS for `play.gunbros.example.com` and proxies everything,
  WebSockets included, to **game**. Only Caddy publishes ports (80, 443).
- Exactly one game container. Rooms live in the process's memory, so a second instance
  would be a second, invisible set of rooms, and a restart (a deploy, a reboot) ends every
  live match. No drain on deploy: that is a choice, not an oversight (DESIGN §7 item 172).
- Merging to `main` deploys, once CI has passed on that commit
  (`.github/workflows/deploy.yml`). `pnpm deploy:prod` does the same from a laptop.
- The image is built on the deploying machine and streamed over SSH
  (`docker save | ssh | docker load`). There is no registry and no credential for one on
  the server.

The host is **Hetzner Cloud**: one shared x86 server (`cx23` by default) in Nuremberg
(`nbg1`). The whole bill is that server's fixed monthly price plus its primary IPv4
address; see hetzner.com/cloud for the current figure. Nothing paid is switched on
beyond that (no backups, volumes, load balancer or floating IP), and nothing scales by
itself, so the bill cannot grow. Any other Ubuntu 24.04 VPS works the same way (below).

## Files

| Path | What it is |
| --- | --- |
| `deploy/server/bootstrap.sh` | one-time server setup, run as root over SSH; idempotent |
| `deploy/server/compose.yaml` | Caddy + game; lives in `/opt/gunbros` on the server |
| `deploy/server/Caddyfile` | TLS and reverse proxy; the domain is `GAME_DOMAIN` |
| `deploy/server/deploy.sh` | build, ship, `docker compose up -d`, wait for `/health` |
| `deploy/hetzner/provision.sh` | creates the Hetzner server, firewall and SSH keys (optional) |
| `deploy/hetzner/cloud-init.yaml` | runs `bootstrap.sh` on the Hetzner server's first boot |
| `.github/workflows/deploy.yml` | runs `deploy.sh` after every green CI on `main` |

`bootstrap.sh` creates a `deploy` user (docker group, passwordless sudo, since docker
access is root access anyway) with every key that could log in before, installs Docker
Engine and the compose plugin from Docker's apt repository, turns on unattended security
upgrades (with a reboot at 04:00 UTC when one needs it; the containers come back on their
own), allows only 22, 80 and 443 through ufw, creates `/opt/gunbros`, and then turns off
password and root logins.

## First-time setup

Once, in this order.

1. **Hetzner.** Create an account and a project, then an API token with read & write
   (console → project → Security → API tokens).
2. **CLI.** `brew install hcloud`, then `hcloud context create gunbros` and paste the
   token. The CLI stores it; nothing else needs it. (`HCLOUD_TOKEN` in the environment
   also works.)
3. **A deploy key for GitHub Actions**, separate from your own:
   ```
   ssh-keygen -t ed25519 -N '' -C gunbros-deploy -f ~/.ssh/gunbros_deploy
   ```
4. **Create the server.**
   ```
   deploy/hetzner/provision.sh
   ```
   It uploads your public key (the first of `~/.ssh/id_ed25519.pub`, `~/.ssh/id_rsa.pub`,
   or a path given as the argument) and `~/.ssh/gunbros_deploy.pub`, creates a firewall
   (22, 80, 443 tcp and ICMP in), creates the server (`SERVER_TYPE`, `LOCATION`, `IMAGE`
   override the defaults) and prints its addresses and the DNS records. Running it again
   creates only what is missing. Wait a few minutes, then check that setup finished:
   ```
   ssh deploy@IPV4 'cloud-init status --wait; docker compose version'
   ```
5. **DNS (Cloudflare).** In the `example.com` zone add `A play.gunbros → IPV4` and
   `AAAA play.gunbros → IPV6`, proxy status **DNS only** (grey cloud). Caddy gets its
   certificate from Let's Encrypt over port 80, which the orange-cloud proxy would get in
   the way of.
6. **GitHub secrets.**
   ```
   gh secret set DEPLOY_HOST --body IPV4
   gh secret set DEPLOY_SSH_KEY < ~/.ssh/gunbros_deploy
   ssh-keyscan -t ed25519 IPV4 | gh secret set DEPLOY_KNOWN_HOSTS
   ```
   Check the scanned key against the server's own
   (`ssh deploy@IPV4 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub'`) before trusting
   it. Until `DEPLOY_HOST` exists, the deploy workflow skips instead of failing.
7. **First deploy.**
   ```
   GUNBROS_HOST=IPV4 pnpm deploy:prod
   # if your usual SSH key has a passphrase and no agent holds it:
   SSH_KEY=~/.ssh/gunbros_deploy GUNBROS_HOST=IPV4 pnpm deploy:prod
   ```
   The first build on an Apple Silicon Mac is emulated amd64 and takes a while; the
   Actions runner builds natively. Afterwards `https://play.gunbros.example.com`
   serves the game, and every merge to `main` redeploys it.
8. **Splash PLAY button.** Set `GAME_URL = 'https://play.gunbros.example.com'` in
   `site/script.js` and run `pnpm site:deploy` (site/README.md, "The PLAY button"). Not
   before step 7, or the live splash links to a dead page.

If the deploy key was not there at step 4, add it later:
`ssh deploy@IPV4 "echo '$(cat ~/.ssh/gunbros_deploy.pub)' >> ~/.ssh/authorized_keys"`.

### Any other Ubuntu 24.04 VPS

Infomaniak VPS Lite, or any VPS with Ubuntu 24.04 and SSH: skip steps 1, 2 and 4 and run
the bootstrap yourself, as root or as the image's sudo user:

```
ssh root@HOST   "DEPLOY_PUBKEY='$(cat ~/.ssh/gunbros_deploy.pub)' bash -s" < deploy/server/bootstrap.sh
ssh ubuntu@HOST "sudo DEPLOY_PUBKEY='$(cat ~/.ssh/gunbros_deploy.pub)' bash -s" < deploy/server/bootstrap.sh
```

Open 22, 80 and 443 in the provider's own firewall if it has one. The rest (DNS,
secrets, deploy) is the same.

## Day to day

- **Deploy:** merge to `main`. The Deploy workflow waits for CI, checks out the exact
  commit CI tested, and runs `deploy/server/deploy.sh`. Deploys queue, never overlap.
  By hand: `pnpm deploy:prod HOST` (or `GUNBROS_HOST=HOST`). Uncommitted changes deploy
  as `<sha>-dirty`.
- **Health:** the check is a liveness probe that also says whether anyone is playing:
  ```
  curl https://play.gunbros.example.com/health
  # {"ok":true,"service":"gunbros","uptimeSeconds":41,"client":true,"rooms":1,"players":2,"matches":1}
  ```
  `client: false` means the image has no `packages/client/dist`: the server is fine, but
  the browser gets a 404 at `/`.
- **Admin portal:** https://play.gunbros.example.com/admin: any user name, the
  password from `.admin-password` at the repo root (git-ignored, never committed). It
  says whether a deploy would cut anyone off right now, lists every room and player,
  graphs who was on over the last fortnight and marks the quiet hours of the week. It
  only reads; it cannot kick anyone.
  The password reaches the server through the `ADMIN_PASSWORD` repository secret: the
  Deploy workflow passes it to `deploy.sh`, which writes it into `/opt/gunbros/.env`
  (a hand deploy uses `.admin-password` instead). To change it:
  ```
  LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32 > .admin-password
  gh secret set ADMIN_PASSWORD < .admin-password      # then merge anything, or re-run Deploy
  ```
  With neither set, the server keeps whatever password its `.env` already has, and a
  server with none has no portal (`/admin` is then the ordinary client). Five wrong
  passwords a minute from one address, then 429. The history lives in the `game_data`
  volume (`DATA_DIR=/data`, `metrics.json`), so deploys keep it; `pnpm dev` keeps it in
  memory only.
- **Logs:**
  ```
  ssh deploy@HOST 'cd /opt/gunbros && docker compose logs -f game'     # or caddy
  ```
- **Rollback:** the server keeps the last three SHA-tagged images (`KEEP_IMAGES`).
  ```
  ssh deploy@HOST 'docker images gunbros'
  ssh deploy@HOST 'docker tag gunbros:<sha> gunbros:latest && cd /opt/gunbros && docker compose up -d'
  ```
  The next merge deploys over it again.
- **Settings:** every server tunable is an environment variable with a default
  (`packages/server/src/config.ts`). Put overrides in `/opt/gunbros/.env` and recreate:
  ```
  ssh deploy@HOST 'echo LOG_LEVEL=debug >> /opt/gunbros/.env && cd /opt/gunbros && docker compose up -d'
  ```
  `GAME_DOMAIN=...` in the same file moves Caddy to another name (set the repository
  variable `GAME_DOMAIN` too, so the workflow's health check follows).
- **The server itself** updates and reboots on its own. `ssh deploy@HOST` and `sudo` for
  anything else.

## Traffic cap

The server's monthly price covers everything except outgoing traffic beyond the plan's
included 20 TB, which Hetzner bills per TB with no ceiling. Real players cannot get
near it, but a script downloading the assets around the clock could. So the bootstrap
installs a guard: `vnstat` counts what leaves the public interface, and a systemd timer
runs `/usr/local/sbin/gunbros-traffic-guard` every 5 minutes. Once this calendar
month's (UTC) outgoing total passes `TX_CAP_BYTES` in `/etc/gunbros/traffic-guard.conf`
(default 15 TB), it stops Caddy and the game, so nothing more goes out; it also stops a
deploy that starts them again. On the first check of a new month it starts them.

```
ssh deploy@HOST 'sudo gunbros-traffic-guard status'   # this month's bytes out, and any trip
ssh deploy@HOST 'journalctl -t gunbros-traffic-guard'  # when it tripped or restarted
# to reopen within the same month: raise TX_CAP_BYTES in the conf, then
ssh deploy@HOST 'sudo gunbros-traffic-guard reset'
```

vnstat and Hetzner count slightly differently and Hetzner's month may not start on the
1st, which the 5 TB margin absorbs. With the guard, the bill is the server's fixed price
plus its primary IPv4.

## Hosting the client somewhere else

The client and the server are separate artefacts, so the static bundle can live on any
CDN (Netlify, Pages, S3) with the server holding only the socket. The client reads
`VITE_WS_URL` **at build time** (DESIGN §1.5): empty means "derive `ws(s)://<this
page's host>/ws`", which is what the single-origin deployment above wants.

```
VITE_WS_URL=wss://play.gunbros.example.com/ws pnpm --filter @gunbros/client build
```

Then upload `packages/client/dist` wherever you like. Things to keep in mind:

- Use `wss://` from an `https://` page; a browser refuses a plaintext socket there.
- The static host needs an SPA fallback so `/r/CODE` (the invite link) serves
  `index.html` instead of 404ing. The Node server already does this.
- The server only accepts sockets from pages on its own origin. Set
  `ALLOWED_ORIGINS=https://your-static-host.example` (comma separated) on the server,
  or every socket from the CDN page is refused with 403.

## Abuse limits

All in `packages/server/src/config.ts`, all overridable with environment variables:

| Variable | Default | What it limits |
| --- | --- | --- |
| `MAX_SOCKETS_PER_ADDRESS` | 16 | sockets open at once from one address (429 beyond) |
| `MAX_CONNECTIONS` | 1000 | sockets open at once in total (503 beyond) |
| `ROOM_CREATES_PER_MINUTE` / `ROOM_CREATE_BURST` | 6 / 10 | rooms one address may create |
| `FAILED_JOINS_PER_MINUTE` / `FAILED_JOIN_BURST` | 10 / 20 | wrong room codes one address may try |
| `MAX_BUFFERED_BYTES` | 1 MB | unsent data held for one socket before it is dropped |
| `ALLOWED_ORIGINS` | (empty) | extra page origins allowed besides the server's own |
| `CLIENT_IP_HEADER` | `x-real-ip` in `compose.yaml`; otherwise empty | header holding the real client address |

Caddy sets `X-Real-IP` to the address it sees, replacing anything the client sent, and
the game trusts that header because `compose.yaml` says so. That is only safe because
the game's port is not published: every request reaches it through Caddy. Never set
`CLIENT_IP_HEADER` on a server that is reachable directly, because a client could then
pick its own address; without it, every player behind a proxy shares the proxy's address
and the per-address limits apply to all of them together.

## Other hosts

The image runs anywhere that runs one container with a public HTTPS endpoint that passes
WebSockets through; keep it to one instance. Render: a Docker web service works, but the
free tier sleeps and forgets rooms. Fly.io: works (`CLIENT_IP_HEADER` defaults to
`fly-client-ip` there), but has no hard spending cap, which is why it is not used.

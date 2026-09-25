/**
 * Server tunables (DESIGN §1.4). Everything the *simulation* reads lives in
 * `@gunbros/shared/data`; everything here is about the process — ports, timeouts,
 * limits — and every one of them can be overridden with an environment variable so a
 * deployment never needs a rebuild.
 *
 * The tick rate is not a server choice: it comes from the shared constants, because the
 * server runs the same fixed timestep as every client (DESIGN §2.1).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { constants, isSkyEventId } from '@gunbros/shared';
import type { SkyEventId } from '@gunbros/shared';

function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw !== undefined && raw !== '' ? raw : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Where the built client lives. Relative to this file, `../../client/dist` is
 * `packages/client/dist` both from `src/` (tsx) and from `dist/` (node), because the
 * build keeps the same directory depth.
 */
function defaultClientDist(): string {
  return fileURLToPath(new URL('../../client/dist', import.meta.url));
}

export const config = {
  /** HTTP + WebSocket port. The Dockerfile sets PORT (8080), as do most hosts. */
  port: envNumber('PORT', 8080),
  host: envString('HOST', '0.0.0.0'),

  /** Static client bundle; absent in dev, where Vite serves the client itself. */
  clientDist: envString('CLIENT_DIST', defaultClientDist()),

  /** How long a seat is held for a player whose socket dropped (DESIGN §6.4). */
  reconnectGraceMs: envNumber('RECONNECT_GRACE_MS', 60_000),
  /** How long a room with nobody connected survives before it is deleted. */
  roomTtlMs: envNumber('ROOM_TTL_MS', 600_000),
  /** How often the reaper looks for expired rooms and expired grace periods. */
  sweepIntervalMs: envNumber('SWEEP_INTERVAL_MS', 5_000),

  /** The simulation's fixed timestep — shared, never a server decision. */
  tickHz: constants.tickRate,
  tickMs: constants.tickMs,
  /**
   * Ticks the match loop is allowed to catch up in one wake-up. A machine that was
   * suspended must not replay ten minutes of simulation in one blocking burst.
   */
  maxCatchUpTicks: envNumber('MAX_CATCHUP_TICKS', 12),
  /**
   * How often the match loop wakes up to see which ticks it owes. Finer than one tick
   * (16.67 ms) so a tick is never processed a whole tick late: the tick number a
   * broadcast carries has to be one the clients' clocks have not passed yet.
   */
  loopWakeMs: envNumber('LOOP_WAKE_MS', 5),

  /** Position echo rate while a mobile walks or falls (DESIGN §6.2 `moveEcho`). */
  moveEchoHz: envNumber('MOVE_ECHO_HZ', 10),
  /** Aim messages are dropped below this spacing; the client sends far more. */
  aimMinIntervalMs: envNumber('AIM_MIN_INTERVAL_MS', 40),
  /** Charging reports are dropped below this spacing (the client sends at 5 Hz). */
  chargeMinIntervalMs: envNumber('CHARGE_MIN_INTERVAL_MS', 80),
  /** Shot-selection messages are dropped below this spacing; each one is a broadcast. */
  shotSelectMinIntervalMs: envNumber('SHOT_SELECT_MIN_INTERVAL_MS', 40),
  /**
   * Spacing between two *accepted* item uses from one player. Each one is a room-wide
   * broadcast that every engine applies, and the rules already allow at most one item
   * per turn, so this only bounds what a scripted client can do with the one item it is
   * entitled to. A refused item never touches it: it broadcasts nothing, and the
   * per-socket token bucket in `Connection` is what bounds a flood of those.
   */
  itemMinIntervalMs: envNumber('ITEM_MIN_INTERVAL_MS', 150),
  /** A full terrain mask is kilobytes: one per player per this interval, at most. */
  terrainRequestMinIntervalMs: envNumber('TERRAIN_REQUEST_MIN_INTERVAL_MS', 1_000),

  /** Room limits (DESIGN §6.1 `start`). */
  maxPlayersPerRoom: envNumber('MAX_PLAYERS_PER_ROOM', 8),
  minPlayersToStart: envNumber('MIN_PLAYERS_TO_START', 2),
  roomCodeLength: envNumber('ROOM_CODE_LENGTH', 5),
  maxRooms: envNumber('MAX_ROOMS', 500),
  /** Rows in the lobby's open-rooms list (`roomList`), at most. */
  roomListMax: envNumber('ROOM_LIST_MAX', 20),

  /** Chat limits. */
  chatMaxLength: envNumber('CHAT_MAX_LENGTH', 200),
  chatBurst: envNumber('CHAT_BURST', 5),
  chatWindowMs: envNumber('CHAT_WINDOW_MS', 5_000),
  nickMaxLength: envNumber('NICK_MAX_LENGTH', 16),

  /** Socket hygiene. */
  maxMessageBytes: envNumber('MAX_MESSAGE_BYTES', 64 * 1024),
  /**
   * Per-socket message rate (a token bucket in `Connection`). A walking player sends a
   * few dozen a second at the very most; a socket that goes past the burst is closed.
   */
  messagesPerSecond: envNumber('MESSAGES_PER_SECOND', 60),
  messageBurst: envNumber('MESSAGE_BURST', 120),
  /**
   * Bytes the server may have queued for one socket before it gives up on it. A client
   * that stops reading would otherwise grow the process until the machine runs out of
   * memory, taking every room with it. A resync (snapshot + terrain) is well under this.
   */
  maxBufferedBytes: envNumber('MAX_BUFFERED_BYTES', 1024 * 1024),
  /**
   * Header carrying the real client address behind a proxy. The production compose
   * file sets `x-real-ip`, which Caddy writes (docs/DEPLOY.md). Fly would set
   * `Fly-Client-IP` and `FLY_APP_NAME`, so there it is trusted by default. Otherwise it
   * is empty and the socket's own address is used (a client could forge the header).
   */
  clientIpHeader: envString('CLIENT_IP_HEADER', process.env.FLY_APP_NAME ? 'fly-client-ip' : '').toLowerCase(),
  /** Sockets open at once, in total and per address (a household shares one). */
  maxConnections: envNumber('MAX_CONNECTIONS', 1000),
  maxSocketsPerAddress: envNumber('MAX_SOCKETS_PER_ADDRESS', 16),
  /** Rooms one address may create: a steady rate with a burst. */
  roomCreatesPerMinute: envNumber('ROOM_CREATES_PER_MINUTE', 6),
  roomCreateBurst: envNumber('ROOM_CREATE_BURST', 10),
  /** Joins with a code that names no room: what guessing codes looks like. */
  failedJoinsPerMinute: envNumber('FAILED_JOINS_PER_MINUTE', 10),
  failedJoinBurst: envNumber('FAILED_JOIN_BURST', 20),
  /**
   * Extra page origins allowed to open a socket, comma separated
   * (`https://gunbros.example`). Same origin as the server is always allowed.
   */
  allowedOrigins: envString('ALLOWED_ORIGINS', '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== ''),
  /** Longest reconnect token and room code a client may send (identity, not gameplay). */
  maxTokenLength: envNumber('MAX_TOKEN_LENGTH', 128),
  maxRoomCodeLength: envNumber('MAX_ROOM_CODE_LENGTH', 16),
  /** Application-level keepalive: a socket silent for two intervals is dropped. */
  pingIntervalMs: envNumber('PING_INTERVAL_MS', 25_000),
  /** A socket that never says `hello` is closed after this. */
  helloTimeoutMs: envNumber('HELLO_TIMEOUT_MS', 20_000),

  /** `debug` adds a line per accepted intent; `silent` says nothing at all. */
  logLevel: envString('LOG_LEVEL', 'info'),

  /**
   * Password for the admin portal at `/admin` (admin.ts). Empty turns the portal off:
   * `/admin` is then a plain 404. In production it comes from `/opt/gunbros/.env`,
   * which deploy.sh writes; in development from `.admin-password` at the repo root
   * (git-ignored), so `pnpm dev` has the same portal with the same password.
   */
  adminPassword: envString('ADMIN_PASSWORD', readSecretFile(envString('ADMIN_PASSWORD_FILE', defaultAdminPasswordFile()))),
  /** Wrong admin passwords one address may try: a steady rate with a burst. */
  adminFailuresPerMinute: envNumber('ADMIN_FAILURES_PER_MINUTE', 5),
  adminFailureBurst: envNumber('ADMIN_FAILURE_BURST', 10),
  /**
   * Where the admin portal keeps its history (activity samples, recent matches), so a
   * deploy does not wipe it. Empty keeps it in memory only; the production compose file
   * mounts a volume at `/data`.
   */
  dataDir: envString('DATA_DIR', ''),
  /** The commit this build came from, shown in the portal (deploy.sh passes it in). */
  gitSha: envString('GIT_SHA', 'dev'),

  /**
   * Pin every match's sky event instead of rolling it (DESIGN §5). Null — the default —
   * rolls off the room's stream as usual and lets weather come and go; a pinned event
   * stays up for the whole match.
   *
   * The roll is seeded from `node:crypto`, so without this a test that pins a number
   * after a shot is really asserting under a random sky: a tornado can throw the shell
   * back at the shooter, Thor and Force change what a hit costs. Tests set it to
   * `'none'` and then force each event in turn; a playtest can set `SKY_EVENT=tornado`
   * to see one without replaying the lobby a dozen times.
   */
  forcedSkyEvent: skyEventFromEnv(),

  /**
   * Multiplies every practice bot's think, aim and charge time (DESIGN §11). 1 in
   * production; the tests and the e2e run set it lower so a bot turn does not cost a
   * test seconds. The server's own throttles still apply at any scale.
   */
  botTimeScale: envNumber('BOT_TIME_SCALE', 1),
};

/** `.admin-password` at the repo root: three levels up from both `src/` and `dist/`. */
function defaultAdminPasswordFile(): string {
  return fileURLToPath(new URL('../../../.admin-password', import.meta.url));
}

/** The first line of a file, or '' when there is no such file. */
function readSecretFile(path: string): string {
  try {
    return (readFileSync(path, 'utf8').split(/\r?\n/)[0] ?? '').trim();
  } catch {
    return '';
  }
}

function skyEventFromEnv(): SkyEventId | null {
  const raw = process.env.SKY_EVENT;
  if (raw === undefined || raw === '') return null;
  return isSkyEventId(raw) ? raw : null;
}

export type Config = typeof config;

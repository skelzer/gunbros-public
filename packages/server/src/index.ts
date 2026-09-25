/**
 * The process (DESIGN §1.4, §1.5): one Node http server that serves the built client,
 * answers `/health`, and upgrades `/ws` to the game protocol. No Express, no router —
 * there are four routes, one of them is a file tree and one the admin portal (admin.ts).
 *
 * In development the client is served by Vite on :5173, which proxies `/ws` here, so
 * `CLIENT_DIST` does not exist. That is a warning, not an error: `/ws` and `/health`
 * work exactly the same.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { Admin } from './admin.js';
import { config } from './config.js';
import { Connection } from './connection.js';
import { AddressCounter, clientAddress, originAllowed } from './limits.js';
import { log } from './log.js';
import { parseClientMessage } from './protocol.js';
import { parseRange } from './range.js';
import { RoomManager } from './rooms.js';

const startedAt = Date.now();

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // The installed-app manifest (DESIGN §7 item 153). A phone that is served this as
  // `application/octet-stream` ignores it, and "add to home screen" quietly falls back
  // to a bookmark with the wrong name, the wrong icon and no orientation lock.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  // The music (DESIGN §8.3).
  '.mp3': 'audio/mpeg',
};

function contentTypeFor(file: string): string {
  return contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve a request path inside the client bundle, or null if it escapes the directory
 * — or if it is not a path at all. `..` is normalised away before the join, so no
 * request can reach outside the root, and a malformed percent-escape (`/%E0%A4%A`, what
 * every scanner on the internet sends within a minute of a host going public) is a
 * `null` the caller answers 400 to, never a `URIError` that would take the process and
 * every running match down with it.
 */
function resolveStaticPath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  } catch {
    return null;
  }
  const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = resolve(join(root, clean));
  const rootResolved = resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + sep)) return null;
  return full;
}

/**
 * Serve one file, whole or as the single byte range the request asks for.
 *
 * Ranges are for the music (DESIGN §8.3): Safari will not play a media file from a
 * server that answers its opening `Range: bytes=0-1` with the whole file, and every
 * browser seeks a looping track by range. Nothing else asks for one.
 */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string): void {
  const size = statSync(file).size;
  const headers: Record<string, string | number> = {
    'content-type': contentTypeFor(file),
    'cache-control': file.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'accept-ranges': 'bytes',
  };
  const range = parseRange(req.headers.range, size);
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` });
    res.end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
  headers['content-length'] = size === 0 ? 0 : end - start + 1;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return;
  }
  const stream = createReadStream(file, { start, end });
  // A file that disappeared between `statSync` and the read must end this response,
  // not the process: an unhandled stream 'error' is an uncaught exception.
  stream.on('error', (err) => {
    log.warn(`could not read ${file}`, err);
    res.end();
  });
  stream.pipe(res);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export interface RunningServer {
  server: Server;
  manager: RoomManager;
  admin: Admin;
  port: number;
  url: string;
  wsUrl: string;
  close: () => Promise<void>;
}

export async function startServer(
  port: number = config.port,
  host: string = config.host,
): Promise<RunningServer> {
  const manager = new RoomManager();
  manager.start();

  const clientDist = config.clientDist;
  const hasClient = existsSync(join(clientDist, 'index.html'));
  if (!hasClient) {
    log.warn(
      `no client bundle at ${clientDist} — serving /ws and /health only ` +
        '(run `pnpm --filter @gunbros/client build`, or use the Vite dev server)',
    );
  }

  /**
   * One request. Every throw in here is caught by the wrapper below: a public HTTP port
   * is hit by scanners, and no malformed request may cost the process (and with it every
   * room, which lives only in this process's memory).
   */
  const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const url = req.url ?? '/';
    const path = url.split('?')[0] ?? '/';

    if (path === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'gunbros',
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        client: hasClient,
        ...manager.stats(),
      });
      return;
    }

    if (admin.handle(req, res, path)) return;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    if (!hasClient) {
      sendJson(res, 404, { error: 'no client bundle on this server' });
      return;
    }

    const file = resolveStaticPath(clientDist, path);
    if (!file) {
      sendJson(res, 400, { error: 'bad path' });
      return;
    }
    if (isFile(file)) {
      sendFile(req, res, file);
      return;
    }
    const indexed = join(file, 'index.html');
    if (isFile(indexed)) {
      sendFile(req, res, indexed);
      return;
    }
    // SPA fallback: unknown paths are client routes (`/sandbox`, `/room/ABCDE`).
    // Anything that looks like a missing asset gets an honest 404 instead.
    if (extname(path) === '') {
      sendFile(req, res, join(clientDist, 'index.html'));
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      handleRequest(req, res);
    } catch (err) {
      log.error('request handler threw', req.method, req.url, err);
      if (!res.headersSent) sendJson(res, 500, { error: 'server error' });
      else res.end();
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });

  const connections = new Set<Connection>();
  const socketsPerAddress = new AddressCounter();
  const admin = new Admin(manager, connections, startedAt);
  admin.start();
  if (!admin.enabled) log.info('admin portal off (no ADMIN_PASSWORD)');

  /** Turn an upgrade away with a plain HTTP status, before any WebSocket exists. */
  const refuse = (socket: Duplex, status: number, text: string): void => {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/ws') {
      socket.destroy();
      return;
    }
    if (!originAllowed(req)) {
      log.warn('socket refused: origin', req.headers.origin);
      refuse(socket, 403, 'Forbidden');
      return;
    }
    const address = clientAddress(req);
    if (connections.size >= config.maxConnections) {
      log.warn('socket refused: server at MAX_CONNECTIONS');
      refuse(socket, 503, 'Service Unavailable');
      return;
    }
    if (socketsPerAddress.count(address) >= config.maxSocketsPerAddress) {
      log.warn('socket refused: too many from one address', address);
      refuse(socket, 429, 'Too Many Requests');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, address);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, address: string) => {
    const conn = new Connection(ws, address);
    connections.add(conn);
    socketsPerAddress.add(address);
    log.debug(`socket ${conn.id} connected`);

    // A socket that never introduces itself is not a client (DESIGN §6.1 `hello`).
    const helloTimer = setTimeout(() => {
      if (!conn.player) {
        conn.sendError('noHello', 'no hello in time');
        conn.close(4001, 'no hello');
      }
    }, config.helloTimeoutMs);
    helloTimer.unref?.();

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      conn.alive = true;
      if (isBinary) {
        conn.sendError('badFrame', 'binary frames are not part of the protocol');
        return;
      }
      if (!conn.takeMessageToken()) {
        // One socket must not be able to make the server broadcast to a whole room as
        // fast as it can type. 1008 is "policy violation".
        log.warn(`socket ${conn.id} exceeded the message rate; closing`);
        conn.sendError('rateLimited', 'too many messages');
        conn.close(1008, 'rate limit');
        return;
      }
      const raw = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.from(data as Buffer).toString('utf8');
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) {
        conn.sendError(parsed.code, parsed.message);
        return;
      }
      try {
        manager.handle(conn, parsed.msg);
      } catch (err) {
        log.error('handler threw', parsed.msg.t, err);
        conn.sendError('serverError', 'the server could not handle that message');
      }
    });

    ws.on('pong', () => {
      conn.alive = true;
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      connections.delete(conn);
      socketsPerAddress.remove(conn.address);
      manager.onSocketClose(conn);
      log.debug(`socket ${conn.id} closed`);
    });

    ws.on('error', (err) => {
      log.warn(`socket ${conn.id} error`, err);
    });
  });

  /**
   * Keepalive and disconnect detection. `conn.alive` is set by every frame the client
   * sends (including its own `ping`, DESIGN §6.1) and cleared when we ping it; a socket
   * that stays cleared for a whole interval is a socket whose TCP connection died
   * without a FIN, which is what a laptop lid closing looks like.
   */
  const keepAlive = setInterval(() => {
    for (const conn of connections) {
      if (!conn.alive) {
        log.debug(`socket ${conn.id} did not answer the keepalive; terminating`);
        conn.socket.terminate();
        continue;
      }
      conn.alive = false;
      try {
        conn.socket.ping();
      } catch {
        conn.socket.terminate();
      }
    }
  }, config.pingIntervalMs);
  keepAlive.unref?.();

  await new Promise<void>((done) => server.listen(port, host, done));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;

  log.info(`GunBros server listening on http://${displayHost}:${actualPort} (ws at /ws)`);

  const close = async (): Promise<void> => {
    clearInterval(keepAlive);
    admin.stop();
    manager.stop();
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((done) => wss.close(() => done()));
    await new Promise<void>((done) => server.close(() => done()));
  };

  return {
    server,
    manager,
    admin,
    port: actualPort,
    url: `http://${displayHost}:${actualPort}`,
    wsUrl: `ws://${displayHost}:${actualPort}/ws`,
    close,
  };
}

/** Only when run directly — importing this module (the tests do) starts nothing. */
const entry = process.argv[1] ? resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (entry === self || entry === self.replace(/\.js$/, '')) {
  const running = await startServer();
  const shutdown = (signal: string): void => {
    log.info(`${signal}: shutting down`);
    void running.close().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

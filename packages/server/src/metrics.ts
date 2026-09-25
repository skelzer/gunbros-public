/**
 * What the admin portal remembers (admin.ts): a sample of who was on every minute, the
 * last few dozen matches, and a handful of running totals.
 *
 * Everything else the portal shows is read live off the {@link RoomManager}. This is
 * the part that has to outlive the moment — and, when `DATA_DIR` is set, a deploy: it
 * is written to `metrics.json` there every few minutes and on shutdown, and read back
 * at start. Without `DATA_DIR` it lives in memory and starts empty with the process.
 *
 * One instance per process ({@link metrics}); the match runner reports into it.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BotDifficulty, MapId, MobileId, TeamId } from '@gunbros/shared';
import { config } from './config.js';
import { log } from './log.js';

/** One minute of activity. Short keys: a week of these is ten thousand rows. */
export interface Sample {
  /** Minute start, ms since the epoch. */
  t: number;
  /** Players with an open socket. */
  on: number;
  /** Of those, the ones seated in a running match. */
  inMatch: number;
  matches: number;
  rooms: number;
}

export interface MatchRecord {
  room: string;
  mapId: MapId;
  startedAt: number;
  endedAt: number;
  turns: number;
  /**
   * `bot` is the difficulty of a practice bot's seat (DESIGN §7 item 192), absent for a
   * human — and absent in every record written before bots existed, which therefore
   * still read as they always did.
   */
  players: { nick: string; team: TeamId; mobileId: MobileId; bot?: BotDifficulty }[];
  winnerTeam: TeamId | null;
  /** How it ended: somebody won, somebody forfeited, the sim threw, or the room closed. */
  reason: 'eliminated' | 'forfeit' | 'abandoned' | 'closed';
}

export interface Totals {
  /** When this history began (the first start with an empty data directory). */
  since: number;
  /**
   * Identities minted by `hello`: a browser with no token the server knows, which is a
   * first visit, a cleared browser, or anybody at all right after a restart.
   */
  sessions: number;
  matchesStarted: number;
  matchesEnded: Record<MatchRecord['reason'], number>;
  /** Most players online at once, and when. */
  peakOnline: number;
  peakAt: number;
}

/** Per calendar day (UTC), for the "today" tiles and the daily bars. */
export interface Day {
  sessions: number;
  matches: number;
}

interface Stored {
  version: 1;
  samples: Sample[];
  matches: MatchRecord[];
  totals: Totals;
  days: Record<string, Day>;
}

const SAMPLE_KEEP = 14 * 24 * 60;
const MATCH_KEEP = 50;
const DAY_KEEP = 60;
const SAVE_EVERY_MS = 5 * 60_000;

export function dayKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function emptyTotals(now: number): Totals {
  return {
    since: now,
    sessions: 0,
    matchesStarted: 0,
    matchesEnded: { eliminated: 0, forfeit: 0, abandoned: 0, closed: 0 },
    peakOnline: 0,
    peakAt: 0,
  };
}

export class Metrics {
  samples: Sample[] = [];
  matches: MatchRecord[] = [];
  totals: Totals;
  days: Record<string, Day> = {};
  private lastSavedAt = 0;
  private readonly file: string | null;

  constructor(dataDir: string = config.dataDir, now: number = Date.now()) {
    this.totals = emptyTotals(now);
    this.file = dataDir ? join(dataDir, 'metrics.json') : null;
    this.load();
  }

  private day(t: number): Day {
    const key = dayKey(t);
    let d = this.days[key];
    if (!d) {
      d = { sessions: 0, matches: 0 };
      this.days[key] = d;
      const keys = Object.keys(this.days).sort();
      for (const old of keys.slice(0, Math.max(0, keys.length - DAY_KEEP))) delete this.days[old];
    }
    return d;
  }

  sessionStarted(now: number = Date.now()): void {
    this.totals.sessions++;
    this.day(now).sessions++;
  }

  matchStarted(now: number = Date.now()): void {
    this.totals.matchesStarted++;
    this.day(now).matches++;
  }

  matchEnded(record: MatchRecord): void {
    this.totals.matchesEnded[record.reason]++;
    this.matches.unshift(record);
    if (this.matches.length > MATCH_KEEP) this.matches.length = MATCH_KEEP;
  }

  /** Called whenever the live count may have moved; keeps the all-time peak honest. */
  observeOnline(on: number, now: number = Date.now()): void {
    if (on > this.totals.peakOnline) {
      this.totals.peakOnline = on;
      this.totals.peakAt = now;
    }
  }

  /** One row per minute. A second call in the same minute keeps the busier reading. */
  record(sample: Omit<Sample, 't'>, now: number = Date.now()): void {
    const t = now - (now % 60_000);
    this.observeOnline(sample.on, now);
    const last = this.samples[this.samples.length - 1];
    if (last && last.t === t) {
      last.on = Math.max(last.on, sample.on);
      last.inMatch = Math.max(last.inMatch, sample.inMatch);
      last.matches = Math.max(last.matches, sample.matches);
      last.rooms = Math.max(last.rooms, sample.rooms);
    } else {
      this.samples.push({ t, ...sample });
      if (this.samples.length > SAMPLE_KEEP) this.samples.splice(0, this.samples.length - SAMPLE_KEEP);
    }
    if (now - this.lastSavedAt >= SAVE_EVERY_MS) this.save(now);
  }

  /** The most recent minute anybody was online, or 0 if nobody ever has been. */
  lastActiveAt(): number {
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const s = this.samples[i];
      if (s && s.on > 0) return s.t + 60_000;
    }
    return 0;
  }

  private load(): void {
    if (!this.file) return;
    let raw: string;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch {
      return; // first start: nothing to read
    }
    try {
      const stored = JSON.parse(raw) as Partial<Stored>;
      if (stored.version !== 1) return;
      this.samples = Array.isArray(stored.samples) ? stored.samples.slice(-SAMPLE_KEEP) : [];
      this.matches = Array.isArray(stored.matches) ? stored.matches.slice(0, MATCH_KEEP) : [];
      if (stored.totals) {
        this.totals = {
          ...this.totals,
          ...stored.totals,
          matchesEnded: { ...this.totals.matchesEnded, ...stored.totals.matchesEnded },
        };
      }
      this.days = stored.days ?? {};
      log.info(`metrics: read ${this.samples.length} samples from ${this.file}`);
    } catch (err) {
      log.warn(`metrics: could not parse ${this.file}; starting a new history`, err);
    }
  }

  /** Write atomically (temp file + rename), so a kill mid-write loses nothing old. */
  save(now: number = Date.now()): void {
    this.lastSavedAt = now;
    if (!this.file) return;
    const stored: Stored = {
      version: 1,
      samples: this.samples,
      matches: this.matches,
      totals: this.totals,
      days: this.days,
    };
    try {
      mkdirSync(join(this.file, '..'), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(stored));
      renameSync(tmp, this.file);
    } catch (err) {
      log.warn(`metrics: could not write ${this.file}`, err);
    }
  }
}

export const metrics = new Metrics();

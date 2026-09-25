/**
 * What a mobile *is*, for the room's picker: its idle animation up close, its name and
 * class, its numbers as bars, and its three shots (S1, S2, SS) with the UI kit's shot
 * icons.
 *
 * Every figure comes from the mobile's definition in `@gunbros/shared` — the same
 * object the simulation reads — and every bar is scaled against the whole roster, so a
 * retune shows up here by itself and nothing on this card can be out of date.
 */
import { mobileDefs, pickableMobiles, shotSlots } from '@gunbros/shared';
import type { MobileDef, MobileId, ShotDef, ShotSlot } from '@gunbros/shared';
import { el, pixelLabel } from './dom.js';
import { mobilePortraitCanvas } from './mobilePortrait.js';
import { uiClassName, uiPieceElement } from '../render/uiKit.js';
import type { FillColour } from '../render/uiKit.js';

export type MobileChoice = MobileId | 'random';

/** The gold of the wordmark and the HUD's selected card. */
const GOLD = '#ffd23f';

interface Stat {
  label: string;
  /** What the bar measures; bigger is always better. */
  score(def: MobileDef): number;
  value(def: MobileDef): string;
  colour: FillColour;
  title: string;
}

function signedPercent(fraction: number): string {
  const pct = Math.round(fraction * 100);
  return pct === 0 ? '±0%' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`;
}

const STATS: Stat[] = [
  {
    label: 'HP',
    score: (d) => d.hp,
    value: (d) => String(d.hp),
    colour: 'green',
    title: 'Hit points',
  },
  {
    label: 'Shield',
    score: (d) => d.shieldMax,
    value: (d) => (d.shieldMax > 0 ? `${d.shieldMax} +${d.shieldRegen}` : '—'),
    colour: 'cyan',
    title: 'Shield, and how much of it comes back each turn',
  },
  {
    label: 'Armor',
    // Defence is a multiplier on the damage taken, so less is tougher.
    score: (d) => 1 / d.defence,
    value: (d) => `${signedPercent(d.defence - 1)} dmg`,
    colour: 'violet',
    title: 'Damage taken, against a plain 1x (DESIGN §3 defence)',
  },
  {
    label: 'Move',
    score: (d) => d.moveGauge,
    value: (d) => String(d.moveGauge),
    colour: 'amber',
    title: 'How far it walks in a turn, in pixels',
  },
  {
    label: 'Aim',
    score: (d) => d.angleMax - d.angleMin,
    value: (d) => `${d.angleMin}° to ${d.angleMax}°`,
    colour: 'red',
    title: 'Barrel range above the hull',
  },
];

/** The roster's spread for one stat, so a bar reads "where in the eighteen". */
function range(stat: Stat): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const def of mobileDefs) {
    const v = stat.score(def);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return [lo, hi];
}

/** A tenth of the bar is always lit for a real value: an empty trough reads as "none". */
function fraction(stat: Stat, def: MobileDef): number {
  const v = stat.score(def);
  if (v <= 0) return 0;
  const [lo, hi] = range(stat);
  if (hi <= lo) return 1;
  return 0.1 + (0.9 * (v - lo)) / (hi - lo);
}

function statRow(stat: Stat, def: MobileDef): HTMLElement {
  const row = el('div', 'stat');
  row.title = stat.title;
  const trough = el('div', `stat-bar ${uiClassName('trough-small')}`);
  const fill = el('div', 'stat-fill');
  fill.style.width = `${Math.round(fraction(stat, def) * 100)}%`;
  fill.appendChild(uiPieceElement(`fill-small/${stat.colour}`, 2));
  trough.appendChild(fill);
  row.append(pixelLabel(stat.label, { scale: 2 }, 'stat-label'), trough, el('span', 'stat-value', stat.value(def)));
  return row;
}

/** "190", "3 × 60": what one press of the key does, before the damage table. */
function damageText(shot: ShotDef): string {
  const count = shot.count ?? 1;
  return count > 1 ? `${count} × ${shot.projectile.damage}` : String(shot.projectile.damage);
}

function shotRow(slot: ShotSlot, shot: ShotDef): HTMLElement {
  const row = el('div', `weapon weapon-${slot}`);
  const card = el('div', `weapon-card ${uiClassName(slot === 'ss' ? 'card/selected' : 'card/normal')}`);
  card.append(uiPieceElement(`shot/${slot}`, 2), pixelLabel(slot.toUpperCase(), { scale: 1 }));
  const text = el('div', 'weapon-text');
  text.append(
    el('span', 'weapon-name', shot.displayName),
    el('span', 'weapon-meta', `DMG ${damageText(shot)} · DELAY +${shot.delay}`),
  );
  row.append(card, text);
  return row;
}

export interface InfoSize {
  widthPx: number;
  heightPx: number;
}

/**
 * The card for one choice. `random` explains the lottery instead: which mobiles it
 * draws from, including the two only it can give.
 */
export function mobileInfoPanel(choice: MobileChoice, art: InfoSize, def?: MobileDef): HTMLElement {
  const panel = el('div', 'mobile-info');
  const head = el('div', 'info-head');
  const portrait = el('div', `info-art ${uiClassName('recess')}`);
  const title = el('div', 'info-title');

  if (choice === 'random' || !def) {
    const q = el('div', 'tile-random', '?');
    q.style.width = `${art.widthPx}px`;
    q.style.height = `${art.heightPx}px`;
    portrait.appendChild(q);
    const rare = mobileDefs.filter((d) => d.randomOnly).map((d) => d.displayName);
    title.append(
      pixelLabel('Random', { scale: 3, color: GOLD }, 'info-name'),
      el(
        'p',
        'info-blurb',
        `Any of the ${pickableMobiles().length} mobiles, drawn when the match starts` +
          (rare.length > 0 ? ` — and the rare ${rare.join(' or ')}, which only Random can give.` : '.'),
      ),
    );
    head.append(portrait, title);
    panel.appendChild(head);
    return panel;
  }

  portrait.appendChild(mobilePortraitCanvas(def.id, { width: art.widthPx, height: art.heightPx }));
  const stats = el('div', 'stats');
  for (const stat of STATS) stats.appendChild(statRow(stat, def));
  title.append(
    pixelLabel(def.displayName, { scale: 3, color: GOLD }, 'info-name'),
    el('span', 'info-class', def.class),
    stats,
  );
  head.append(portrait, title);

  const weapons = el('div', 'weapons');
  for (const slot of shotSlots) weapons.appendChild(shotRow(slot, def.shots[slot]));
  panel.append(head, weapons);
  return panel;
}

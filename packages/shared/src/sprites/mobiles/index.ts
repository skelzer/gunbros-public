/**
 * Every mobile sprite in one place (DESIGN §8). Each mobile's data file imports its own
 * sprite directly from `sprites/mobiles/<id>.ts`; this index exists for tooling, tests
 * and anything that wants the whole set — and so that a group agent only ever edits its
 * own sprite files.
 */
import type { MobileId } from '../../data/mobiles/index.js';
import type { PixelSpriteRef } from '../pixelArt.js';
import { armorSprite } from './armor.js';
import { mageSprite } from './mage.js';
import { nakSprite } from './nak.js';
import { tricoSprite } from './trico.js';
import { bigfootSprite } from './bigfoot.js';
import { boomerSprite } from './boomer.js';
import { raonSprite } from './raon.js';
import { lightningSprite } from './lightning.js';
import { jdSprite } from './jd.js';
import { asateSprite } from './asate.js';
import { iceSprite } from './ice.js';
import { turtleSprite } from './turtle.js';
import { grubSprite } from './grub.js';
import { adukaSprite } from './aduka.js';
import { kalsiddonSprite } from './kalsiddon.js';
import { jfrogSprite } from './jfrog.js';
import { dragonSprite } from './dragon.js';
import { knightSprite } from './knight.js';

export { armorSprite } from './armor.js';
export { mageSprite } from './mage.js';
export { nakSprite } from './nak.js';
export { tricoSprite } from './trico.js';
export { bigfootSprite } from './bigfoot.js';
export { boomerSprite } from './boomer.js';
export { raonSprite } from './raon.js';
export { lightningSprite } from './lightning.js';
export { jdSprite } from './jd.js';
export { asateSprite } from './asate.js';
export { iceSprite } from './ice.js';
export { turtleSprite } from './turtle.js';
export { grubSprite } from './grub.js';
export { adukaSprite } from './aduka.js';
export { kalsiddonSprite } from './kalsiddon.js';
export { jfrogSprite } from './jfrog.js';
export { dragonSprite } from './dragon.js';
export { knightSprite } from './knight.js';
export { rotateHue, tintedArmorSprite } from './tint.js';

/** Sprite per mobile id. Keyed lookup only — never iterated where order matters. */
export const mobileSprites: Record<MobileId, PixelSpriteRef> = {
  armor: armorSprite,
  mage: mageSprite,
  nak: nakSprite,
  trico: tricoSprite,
  bigfoot: bigfootSprite,
  boomer: boomerSprite,
  raon: raonSprite,
  lightning: lightningSprite,
  jd: jdSprite,
  asate: asateSprite,
  ice: iceSprite,
  turtle: turtleSprite,
  grub: grubSprite,
  aduka: adukaSprite,
  kalsiddon: kalsiddonSprite,
  jfrog: jfrogSprite,
  dragon: dragonSprite,
  knight: knightSprite,
};

/**
 * The sound button of the menus (DESIGN §8.3). The lobby and the room play the music,
 * so they need a way to stop it; this is the same three-step switch as the match HUD's
 * speaker and the `M` key (`state/session.ts` `SoundMode`), stored in the same place.
 */
import { appMusic } from '../audio/music.js';
import { cycleSoundMode, loadSoundMode } from '../state/session.js';
import type { SoundMode } from '../state/session.js';
import { button } from './dom.js';

const LABELS: Record<SoundMode, string> = {
  on: 'Sound on',
  noMusic: 'Music off',
  off: 'Sound off',
};

export function soundButton(className = 'btn uk-btn small'): HTMLButtonElement {
  const node = button(LABELS[loadSoundMode()], className, () => {
    const mode = cycleSoundMode();
    node.textContent = LABELS[mode];
    // Inside the click, so a browser that wants a gesture for `play()` gets one.
    appMusic().setEnabled(mode === 'on');
    appMusic().unlock();
  });
  node.title = 'Sound on → music off → sound off';
  return node;
}

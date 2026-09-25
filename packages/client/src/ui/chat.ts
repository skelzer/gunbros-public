/**
 * The chat panel, shared by the room screen and the in-match overlay (DESIGN §6.1
 * `chat`: it works in both).
 *
 * The server owns the text — it strips control characters, collapses whitespace, cuts
 * to 200 characters and rate-limits to five lines per five seconds — so this is only a
 * log with an input box. Lines arrive as `chat` broadcasts, including our own.
 */
import { clientConstants } from '../data/clientConstants.js';
import { button, el } from './dom.js';

export interface ChatLine {
  from: string;
  text: string;
  ts: number;
}

export class ChatPanel {
  readonly element: HTMLElement;
  readonly log: HTMLElement;
  readonly input: HTMLInputElement;
  /**
   * The input and its SEND key (DESIGN §7 item 149). They travel together because a
   * phone has to be able to hide both: the in-match overlay only shows the line while
   * it is being typed into, and a naked SEND floating over the board is a puzzle.
   */
  readonly row: HTMLElement;
  readonly sendButton: HTMLButtonElement;

  private readonly lines: ChatLine[] = [];

  constructor(
    private readonly onSend: (text: string) => void,
    placeholder = 'say something',
  ) {
    this.element = el('div', 'chat');
    this.log = el('div', 'chat-log');
    this.input = el('input', 'field chat-input');
    this.input.type = 'text';
    this.input.placeholder = placeholder;
    this.input.maxLength = clientConstants.ui.chatMaxLength;
    this.input.autocomplete = 'off';
    // iOS labels the return key from this, and "send" is what it does.
    this.input.enterKeyHint = 'send';
    this.input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        this.submit();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        this.input.blur();
      }
    });
    this.sendButton = button('Send', 'btn chat-send', () => this.submit());
    // A press on SEND must not take the focus off the field: losing it closes the
    // virtual keyboard *and* (in the match) hides the line the press was aimed at,
    // which on a phone means the click never lands.
    this.sendButton.addEventListener('pointerdown', (e: Event) => {
      e.preventDefault();
    });
    this.row = el('div', 'chat-row');
    this.row.append(this.input, this.sendButton);
    this.element.append(this.log, this.row);
  }

  private submit(): void {
    const text = this.input.value.trim();
    this.input.value = '';
    if (text.length === 0) return;
    this.onSend(text);
  }

  /** Show or hide the input line and its SEND key together. */
  setInputVisible(visible: boolean): void {
    this.row.hidden = !visible;
  }

  push(line: ChatLine): void {
    this.lines.push(line);
    while (this.lines.length > clientConstants.net.chatHistory) this.lines.shift();
    const row = el('div', 'chat-line');
    row.append(el('span', 'chat-from', line.from), el('span', 'chat-text', line.text));
    this.log.appendChild(row);
    while (this.log.childElementCount > clientConstants.net.chatHistory) {
      this.log.firstElementChild?.remove();
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  /** A line from the client itself (an error, "player joined"), not from a player. */
  note(text: string): void {
    const row = el('div', 'chat-line note');
    row.appendChild(el('span', 'chat-text', text));
    this.log.appendChild(row);
    this.log.scrollTop = this.log.scrollHeight;
  }

  focus(): void {
    this.input.focus();
  }

  get focused(): boolean {
    return document.activeElement === this.input;
  }
}

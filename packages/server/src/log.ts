/** Four lines of logging. One place, so `LOG_LEVEL=silent` really is silent. */
import { config } from './config.js';

const order = ['debug', 'info', 'warn', 'error', 'silent'];
const threshold = Math.max(0, order.indexOf(config.logLevel));

function at(level: string): boolean {
  return order.indexOf(level) >= threshold;
}

function stamp(): string {
  return new Date().toISOString();
}

export const log = {
  debug: (...args: unknown[]): void => {
    if (at('debug')) console.log(stamp(), '[debug]', ...args);
  },
  info: (...args: unknown[]): void => {
    if (at('info')) console.log(stamp(), '[info]', ...args);
  },
  warn: (...args: unknown[]): void => {
    if (at('warn')) console.warn(stamp(), '[warn]', ...args);
  },
  error: (...args: unknown[]): void => {
    if (at('error')) console.error(stamp(), '[error]', ...args);
  },
};

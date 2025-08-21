/**
 * ===============================================
 * Console Patch Bootstrap - Production Hardened
 * Routes console.* through structured logger
 * ===============================================
 */

import { getLogger } from '../services/logger.js';

let patched = false;

/**
 * Patch console to route through structured logger - Idempotent
 */
export function patchConsole(): void {
  if (patched) return; // idempotent guard
  patched = true;

  try {
    const base = getLogger();

    const write = 
      (lvl: 'info' | 'warn' | 'error' | 'debug') =>
        (...args: any[]) => {
          const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
          try {
            if (lvl === 'info') base.info(msg);
            else if (lvl === 'warn') base.warn(msg);
            else if (lvl === 'error') base.error(msg);
            else base.debug(msg);
          } catch {
            // fallback to native streams to keep logs
            const out = lvl === 'error' ? process.stderr : process.stdout;
            out.write(msg + '\n');
          }
        };

    console.log = write('info');
    console.info = write('info');
    console.warn = write('warn');
    console.error = write('error');
    console.debug = write('debug');
  } catch (e) {
    process.stderr.write(`Failed to patch console logging: ${e}\n`);
  }
}

/**
 * Initialize logging system with dev-only opt-in
 */
export function initLogging(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.LOG_LEVEL) {
    process.env.LOG_LEVEL = 'info';
  }
  const enable = process.env.ENABLE_CONSOLE_PATCH === '1' ||
                 process.env.NODE_ENV === 'production';
  if (enable) patchConsole();
}

export default { patchConsole, initLogging };
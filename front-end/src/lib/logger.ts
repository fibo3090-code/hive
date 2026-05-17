/**
 * Tiny dev-only logger. Replaces ad-hoc `console.warn` / `console.error`
 * scattered across the app so production builds stay quiet.
 *
 * `logger.error` always fires (real errors deserve visibility), but
 * `warn`/`info`/`debug` are no-ops outside `import.meta.env.DEV`.
 */
const dev = import.meta.env.DEV;

function fmt(scope: string, ...args: unknown[]): unknown[] {
  return [`[${scope}]`, ...args];
}

export const logger = {
  debug(scope: string, ...args: unknown[]) {
    if (dev) console.debug(...fmt(scope, ...args));
  },
  info(scope: string, ...args: unknown[]) {
    if (dev) console.info(...fmt(scope, ...args));
  },
  warn(scope: string, ...args: unknown[]) {
    if (dev) console.warn(...fmt(scope, ...args));
  },
  error(scope: string, ...args: unknown[]) {
    // Always log errors — they're the only thing worth bothering a user with.
    console.error(...fmt(scope, ...args));
  },
};

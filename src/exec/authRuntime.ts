// src/exec/authRuntime.ts
import type { AuthMode } from '../config/types.js';

export interface CodexRuntime {
  /** Binary to spawn for `codex exec`. */
  readonly bin: string;
  /** Extra environment for the child (merged over process.env by the runner). */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Map an AuthMode to the concrete binary + environment. This is the ONLY place
 * that decision lives.
 *
 * `rotate` spawns the multi-auth forwarding wrapper with three guards set so
 * the wrapper can NEVER re-install the persistent global app-bind (the footgun
 * that rewrites ~/.codex/config.toml and breaks the user's interactive Codex).
 * Rotation stays confined to this child process; the global config is left
 * untouched, verified by a config-hash check in the smoke path.
 */
export function resolveCodexRuntime(auth: AuthMode): CodexRuntime {
  if (auth === 'rotate') {
    return {
      bin: 'codex-multi-auth-codex',
      env: {
        CODEX_MULTI_AUTH_APP_BIND_INSTALL: '0',
        CODEX_MULTI_AUTH_APP_LAUNCHER_INSTALL: '0',
        CODEX_MULTI_AUTH_RUNTIME_ROTATION_PROXY: '1',
      },
    };
  }
  return { bin: 'codex' };
}

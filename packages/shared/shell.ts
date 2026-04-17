/**
 * Shell execution utilities — Bun-native with Node.js fallback.
 *
 * Uses Bun.spawnSync when running on Bun, falls back to
 * child_process.execSync for Node.js compatibility.
 */

import { execSync } from "child_process";

const IS_BUN = typeof globalThis.Bun !== "undefined";

/**
 * Run a shell command, return trimmed stdout.
 * @throws Error on non-zero exit code.
 */
export function run(cmd: string): string {
  if (IS_BUN) {
    const result = Bun.spawnSync(["sh", "-c", cmd], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      throw new Error(stderr || `command failed with exit code ${result.exitCode}: ${cmd}`);
    }
    return result.stdout.toString().trim();
  }
  return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Run a shell command, return trimmed stdout.
 * Never throws — returns empty string on failure.
 */
export function runSafe(cmd: string): string {
  try {
    return run(cmd);
  } catch {
    return "";
  }
}

/**
 * Run a shell command, parse stdout as JSON.
 * @throws Error on non-zero exit or invalid JSON.
 */
export function runJson<T = unknown>(cmd: string): T {
  const out = run(cmd);
  return JSON.parse(out) as T;
}

/**
 * Resolve ghq root directory. Cached after first call.
 * Falls back to $GHQ_ROOT env, then $HOME/Code.
 */
let _ghqRootCache: string | null = null;
export function ghqRoot(): string {
  if (_ghqRootCache) return _ghqRootCache;
  if (process.env.GHQ_ROOT) {
    _ghqRootCache = process.env.GHQ_ROOT;
    return _ghqRootCache;
  }
  const fromGhq = runSafe("ghq root");
  if (fromGhq) {
    _ghqRootCache = fromGhq;
    return _ghqRootCache;
  }
  if (!process.env.HOME) {
    throw new Error("HOME not set and ghq unavailable — set GHQ_ROOT or HOME");
  }
  _ghqRootCache = `${process.env.HOME}/Code`;
  return _ghqRootCache;
}

/** Clear ghq root cache (for testing). */
export function _clearGhqRootCache(): void {
  _ghqRootCache = null;
}

/**
 * Search ghq repos by pattern. Returns full paths.
 * e.g. ghqListFullPath("oracle-vault") → ["/home/neo/Code/github.com/org/oracle-vault"]
 */
export function ghqListFullPath(pattern: string): string[] {
  const out = runSafe(`ghq list --full-path 2>/dev/null | grep -i '${pattern}'`);
  if (!out) return [];
  return out.split("\n").filter(Boolean);
}

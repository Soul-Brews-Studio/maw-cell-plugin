/**
 * Local type definitions for the 50-absorb package.
 *
 * Mirrors the SDK types (maw-js/src/plugin/types). Defining locally so the
 * package compiles standalone — the same pattern 50-bud and 50-fusion use.
 */

export interface InvokeContext {
  source: "cli" | "api" | "peer";
  args: string[] | Record<string, unknown>;
}

export interface InvokeResult {
  ok: boolean;
  output?: string;
  error?: string;
}

export interface AbsorbRecord {
  absorbedAt: string;
  absorbedBy: string;
  reason: string;
  sourceRepo: string;
  vaultPath: string;
  fileCount: number;
}

/**
 * Local type definitions for the 50-bud package.
 *
 * Mirrors the SDK types (maw-js/src/plugin/types). Defining locally so the
 * package compiles standalone — the same pattern 50-fusion uses.
 *
 * If/when the SDK is published to npm, this file becomes a re-export.
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

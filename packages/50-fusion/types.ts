/**
 * Type definitions for the fusion merge algorithm.
 *
 * Mirrors the SDK InvokeContext/InvokeResult shape locally so the
 * merge engine has no hard dependency on the outer plugin runtime.
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

export type VaultCategory = "learnings" | "resonance" | "retrospectives" | "traces";

export const VAULT_CATEGORIES: readonly VaultCategory[] = [
  "learnings",
  "resonance",
  "retrospectives",
  "traces",
] as const;

/** A single file discovered inside a source vault. */
export interface VaultFile {
  /** Filename (or sub-path) relative to the category root, e.g. "2026-04-15_pattern.md". */
  relativePath: string;
  /** Path relative to the vault root, e.g. "memory/learnings/2026-04-15_pattern.md". */
  categoryPath: string;
  /** Name of the oracle that originated this file. */
  source: string;
}

/** YAML frontmatter attached to every fused file so lineage is never lost. */
export interface ProvenanceHeader {
  source: string;
  fusedAt: string;
  originalPath: string;
  contentHash: string;
  lineage?: string[];
}

/** Outcome of evaluating a single source file against the target. */
export interface MergeFileResult {
  action: "skip" | "copy" | "conflict";
  sourcePath: string;
  targetPath: string;
  reason: string;
}

/** Aggregate report for an entire merge invocation. */
export interface MergeReport {
  source: string;
  target: string;
  categories: Record<VaultCategory, MergeFileResult[]>;
  totals: { skipped: number; copied: number; conflicted: number };
  timestamp: string;
}

/** Read-only view onto a vault — used as the source of a fusion. */
export interface VaultSource {
  readonly name: string;
  readonly root: string;
  listFiles(category: VaultCategory): VaultFile[];
  readFile(file: VaultFile): string | null;
  exists(categoryPath: string): boolean;
}

/** Writable view onto a vault — used as the destination of a fusion. */
export interface VaultTarget {
  readonly name: string;
  readonly root: string;
  exists(categoryPath: string): boolean;
  readFile(categoryPath: string): string | null;
  writeFile(
    category: VaultCategory,
    source: string,
    relativePath: string,
    content: string,
    provenance: ProvenanceHeader,
  ): void;
  writeConflictMarker(
    category: VaultCategory,
    source: string,
    relativePath: string,
    conflictWith: string,
    reason: string,
  ): void;
}

/** Options accepted by `executeMerge`. */
export interface MergeOptions {
  /** If true, compute the report without writing anything to the target vault. */
  dryRun?: boolean;
  /** If set, restrict the merge to a single category. */
  category?: VaultCategory;
}

/**
 * Fusion merge algorithm.
 *
 * Given a source vault and a target vault, copy every `.md` file under
 * memory/{learnings,resonance,retrospectives,traces} from source into
 * target/memory/{category}/from-{source}/, skipping exact-content
 * duplicates and marking filename collisions as conflicts.
 *
 * Principle: Nothing is Deleted. This algorithm only appends to the
 * target vault; it never overwrites existing files.
 */

import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join, relative } from "path";

import type {
  MergeFileResult,
  MergeOptions,
  MergeReport,
  ProvenanceHeader,
  VaultCategory,
  VaultFile,
  VaultSource,
  VaultTarget,
} from "./types";
import { VAULT_CATEGORIES } from "./types";

// ---------------------------------------------------------------------------
// Normalization + hashing
// ---------------------------------------------------------------------------

const YAML_FRONTMATTER = /^---\n[\s\S]*?\n---\n?/;
const ZERO_WIDTH = /[\u200B\u200C\u200D\uFEFF]/g;

/**
 * Normalize file content before hashing so that cosmetic differences
 * (line endings, trailing whitespace, zero-width chars, existing
 * provenance frontmatter) do not cause false positives.
 */
export function normalizeContent(content: string): string {
  let out = content.replace(/^\uFEFF/, "");
  out = out.replace(YAML_FRONTMATTER, "");
  out = out.replace(/\r\n/g, "\n");
  out = out.replace(ZERO_WIDTH, "");
  out = out
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
  out = out.normalize("NFC");
  return out.trim();
}

/** SHA-256 hex digest of the UTF-8 bytes of `normalized`. */
export function hashContent(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/** Prepend a YAML provenance header to the content about to be written. */
export function addProvenanceHeader(content: string, prov: ProvenanceHeader): string {
  const lines = [
    "---",
    "fusion:",
    `  source: ${prov.source}`,
    `  fusedAt: ${prov.fusedAt}`,
    `  originalPath: ${prov.originalPath}`,
    `  contentHash: ${prov.contentHash}`,
  ];
  if (prov.lineage && prov.lineage.length > 0) {
    lines.push("  lineage:");
    for (const step of prov.lineage) {
      lines.push(`    - ${step}`);
    }
  }
  lines.push("---", "", content);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Filesystem adapter — implements both source and target for pre-VII vaults
// ---------------------------------------------------------------------------

function walkMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile() && entry.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Filesystem-backed vault. Implements both `VaultSource` and `VaultTarget`
 * so it can be used on either side of a fusion. Expects the layout
 * `<root>/memory/<category>/...`.
 */
export class FsVaultSource implements VaultSource, VaultTarget {
  constructor(public readonly name: string, public readonly root: string) {}

  private categoryDir(category: VaultCategory): string {
    return join(this.root, "memory", category);
  }

  listFiles(category: VaultCategory): VaultFile[] {
    const dir = this.categoryDir(category);
    return walkMarkdown(dir).map((abs) => {
      const relativePath = relative(dir, abs);
      return {
        relativePath,
        categoryPath: join("memory", category, relativePath),
        source: this.name,
      };
    });
  }

  readFile(fileOrPath: VaultFile | string): string | null {
    const categoryPath = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.categoryPath;
    const abs = join(this.root, categoryPath);
    if (!existsSync(abs)) return null;
    return readFileSync(abs, "utf-8");
  }

  exists(categoryPath: string): boolean {
    return existsSync(join(this.root, categoryPath));
  }

  writeFile(
    category: VaultCategory,
    source: string,
    relativePath: string,
    content: string,
    provenance: ProvenanceHeader,
  ): void {
    const abs = join(this.root, "memory", category, `from-${source}`, relativePath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, addProvenanceHeader(content, provenance), "utf-8");
  }

  writeConflictMarker(
    category: VaultCategory,
    source: string,
    relativePath: string,
    conflictWith: string,
    reason: string,
  ): void {
    const abs = join(this.root, "memory", category, `from-${source}`, `${relativePath}.conflict.md`);
    mkdirSync(dirname(abs), { recursive: true });
    const body = [
      "---",
      "fusion_conflict:",
      `  source: ${source}`,
      `  detectedAt: ${new Date().toISOString()}`,
      `  relativePath: ${relativePath}`,
      `  conflictsWith: ${conflictWith}`,
      "---",
      "",
      `# Fusion conflict: ${relativePath}`,
      "",
      reason,
      "",
    ].join("\n");
    writeFileSync(abs, body, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Merge engine
// ---------------------------------------------------------------------------

/** Build a hash→path index of every .md file already present in a target category. */
function indexTargetCategory(target: VaultTarget, category: VaultCategory): {
  hashes: Map<string, string>;
  topLevel: Map<string, string>;
} {
  const hashes = new Map<string, string>();
  const topLevel = new Map<string, string>();

  const categoryRoot = join(target.root, "memory", category);
  if (!existsSync(categoryRoot)) return { hashes, topLevel };

  for (const abs of walkMarkdown(categoryRoot)) {
    const raw = readFileSync(abs, "utf-8");
    const hash = hashContent(normalizeContent(raw));
    const relPath = relative(categoryRoot, abs);
    hashes.set(hash, relPath);
    // "Top-level" means directly inside the category dir, not under from-*/.
    if (!relPath.includes("/") && !relPath.includes("\\")) {
      topLevel.set(relPath, hash);
    }
  }

  return { hashes, topLevel };
}

/**
 * Execute a fusion merge from `source` into `target`.
 *
 * For every markdown file under each category in the source vault:
 *   1. If an identical-content file is already anywhere in the target
 *      category, skip it.
 *   2. Else if a file with the same basename exists at the category's
 *      top level with different content, copy it to `from-{source}/`
 *      and write a `{file}.conflict.md` marker.
 *   3. Otherwise copy it to `from-{source}/` with a provenance header.
 *
 * When `opts.dryRun` is true the same classification runs but nothing
 * is written to the target.
 */
export function executeMerge(
  source: VaultSource,
  target: VaultTarget,
  opts: MergeOptions = {},
): MergeReport {
  const dryRun = opts.dryRun === true;
  const fusedAt = new Date().toISOString();
  const categoriesToWalk: VaultCategory[] = opts.category ? [opts.category] : [...VAULT_CATEGORIES];

  const report: MergeReport = {
    source: source.name,
    target: target.name,
    categories: {
      learnings: [],
      resonance: [],
      retrospectives: [],
      traces: [],
    },
    totals: { skipped: 0, copied: 0, conflicted: 0 },
    timestamp: fusedAt,
  };

  for (const category of categoriesToWalk) {
    const index = indexTargetCategory(target, category);
    const files = source.listFiles(category);

    for (const file of files) {
      const raw = source.readFile(file);
      if (raw === null) continue;

      const normalized = normalizeContent(raw);
      const hash = hashContent(normalized);

      const targetRelDir = join("memory", category, `from-${source.name}`);
      const targetPath = join(targetRelDir, file.relativePath);

      const provenance: ProvenanceHeader = {
        source: source.name,
        fusedAt,
        originalPath: file.categoryPath,
        contentHash: hash,
      };

      let result: MergeFileResult;
      const existingByHash = index.hashes.get(hash);
      const topLevelHash = index.topLevel.get(file.relativePath);

      if (existingByHash !== undefined) {
        result = {
          action: "skip",
          sourcePath: file.categoryPath,
          targetPath: join("memory", category, existingByHash),
          reason: `identical content already present (hash ${hash.slice(0, 12)})`,
        };
      } else if (topLevelHash !== undefined && topLevelHash !== hash) {
        const conflictWith = join("memory", category, file.relativePath);
        result = {
          action: "conflict",
          sourcePath: file.categoryPath,
          targetPath,
          reason: `filename collision with ${conflictWith} (different content)`,
        };
        if (!dryRun) {
          target.writeFile(category, source.name, file.relativePath, normalized, provenance);
          target.writeConflictMarker(
            category,
            source.name,
            file.relativePath,
            conflictWith,
            result.reason,
          );
        }
      } else {
        result = {
          action: "copy",
          sourcePath: file.categoryPath,
          targetPath,
          reason: "new content",
        };
        if (!dryRun) {
          target.writeFile(category, source.name, file.relativePath, normalized, provenance);
        }
      }

      report.categories[category].push(result);
      if (result.action === "skip") report.totals.skipped += 1;
      else if (result.action === "copy") report.totals.copied += 1;
      else report.totals.conflicted += 1;

      // Keep the in-memory index in sync so later files in the same run
      // see the effect of earlier copies.
      if (!dryRun && result.action !== "skip") {
        index.hashes.set(hash, join(`from-${source.name}`, file.relativePath));
      }
    }
  }

  return report;
}

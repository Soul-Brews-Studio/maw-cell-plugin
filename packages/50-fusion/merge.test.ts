/**
 * Unit tests for the fusion merge algorithm.
 *
 * Each test asserts a falsifiable claim about `executeMerge`,
 * `normalizeContent`, or `hashContent`. No tautologies.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import {
  executeMerge,
  FsVaultSource,
  hashContent,
  normalizeContent,
} from "./merge";
import type { VaultCategory } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp vault directory and seed it with `memory/<cat>/<rel>: <content>`. */
function makeVault(
  label: string,
  files: Record<string, string> = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), `vault-${label}-`));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return dir;
}

const tempDirs: string[] = [];
function vault(label: string, files: Record<string, string> = {}): string {
  const dir = makeVault(label, files);
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// ---------------------------------------------------------------------------
// 1. normalizeContent strips frontmatter and ZWSP
// ---------------------------------------------------------------------------

describe("normalizeContent", () => {
  test("strips YAML frontmatter, zero-width chars, CRLF, trailing whitespace", () => {
    const raw =
      "---\nfusion:\n  source: other\n---\nhello\u200B world  \r\ntrailing\t  \r\n";
    const out = normalizeContent(raw);
    expect(out).toBe("hello world\ntrailing");
    // Explicit falsifiable sub-claims:
    expect(out).not.toContain("---");
    expect(out).not.toContain("\u200B");
    expect(out).not.toContain("\r");
    expect(out.endsWith("trailing")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. hashContent is deterministic and collision-sensitive
// ---------------------------------------------------------------------------

describe("hashContent", () => {
  test("same input → same hash, different input → different hash", () => {
    const a = hashContent("hello");
    const b = hashContent("hello");
    const c = hashContent("hello!");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
});

// ---------------------------------------------------------------------------
// 3. executeMerge with empty source → empty report
// ---------------------------------------------------------------------------

describe("executeMerge — empty source", () => {
  test("no files → totals all zero, every category empty", () => {
    const src = new FsVaultSource("empty-src", vault("empty-src"));
    const tgt = new FsVaultSource("empty-tgt", vault("empty-tgt"));

    const report = executeMerge(src, tgt);

    expect(report.totals).toEqual({ skipped: 0, copied: 0, conflicted: 0 });
    expect(report.categories.learnings).toEqual([]);
    expect(report.categories.resonance).toEqual([]);
    expect(report.categories.retrospectives).toEqual([]);
    expect(report.categories.traces).toEqual([]);
    expect(report.source).toBe("empty-src");
    expect(report.target).toBe("empty-tgt");
  });
});

// ---------------------------------------------------------------------------
// 4. executeMerge copies new files with provenance headers
// ---------------------------------------------------------------------------

describe("executeMerge — copy path", () => {
  test("copies new files to from-{source}/ with YAML provenance", () => {
    const srcRoot = vault("copy-src", {
      "memory/learnings/alpha.md": "# Alpha\nbody A\n",
      "memory/learnings/beta.md": "# Beta\nbody B\n",
    });
    const tgtRoot = vault("copy-tgt");
    const src = new FsVaultSource("mawjs", srcRoot);
    const tgt = new FsVaultSource("fusion", tgtRoot);

    const report = executeMerge(src, tgt);

    expect(report.totals).toEqual({ skipped: 0, copied: 2, conflicted: 0 });
    expect(report.categories.learnings).toHaveLength(2);
    expect(report.categories.learnings.every(r => r.action === "copy")).toBe(true);

    const alphaDest = join(tgtRoot, "memory/learnings/from-mawjs/alpha.md");
    const betaDest = join(tgtRoot, "memory/learnings/from-mawjs/beta.md");
    expect(existsSync(alphaDest)).toBe(true);
    expect(existsSync(betaDest)).toBe(true);

    // Provenance header must be present, and original body must survive.
    const alphaOut = readFileSync(alphaDest, "utf-8");
    expect(alphaOut.startsWith("---\nfusion:")).toBe(true);
    expect(alphaOut).toContain("source: mawjs");
    expect(alphaOut).toContain("originalPath: memory/learnings/alpha.md");
    expect(alphaOut).toContain("contentHash: ");
    expect(alphaOut).toContain("# Alpha");
    expect(alphaOut).toContain("body A");
  });
});

// ---------------------------------------------------------------------------
// 5. executeMerge skips identical content (by hash)
// ---------------------------------------------------------------------------

describe("executeMerge — skip path", () => {
  test("identical normalized content → skip, no write", () => {
    const body = "# Shared\nsame words\n";
    const srcRoot = vault("skip-src", { "memory/resonance/shared.md": body });
    // Target already holds the same content (possibly under a different path).
    const tgtRoot = vault("skip-tgt", {
      "memory/resonance/already-here.md": body,
    });
    const src = new FsVaultSource("alpha", srcRoot);
    const tgt = new FsVaultSource("beta", tgtRoot);

    const report = executeMerge(src, tgt);

    expect(report.totals.skipped).toBe(1);
    expect(report.totals.copied).toBe(0);
    expect(report.totals.conflicted).toBe(0);
    expect(report.categories.resonance[0].action).toBe("skip");
    // No copy written under from-alpha/.
    expect(existsSync(join(tgtRoot, "memory/resonance/from-alpha"))).toBe(false);
  });

  test("skip also triggers when only frontmatter/whitespace differs", () => {
    // Same semantic content, different frontmatter and trailing ws.
    const srcRoot = vault("skip-norm-src", {
      "memory/learnings/x.md": "hello world\n",
    });
    const tgtRoot = vault("skip-norm-tgt", {
      "memory/learnings/y.md": "---\nmeta: 1\n---\nhello world   \n\n",
    });
    const src = new FsVaultSource("alpha", srcRoot);
    const tgt = new FsVaultSource("beta", tgtRoot);

    const report = executeMerge(src, tgt);
    expect(report.totals.skipped).toBe(1);
    expect(report.totals.copied).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. executeMerge detects filename collisions as conflicts
// ---------------------------------------------------------------------------

describe("executeMerge — conflict path", () => {
  test("same basename at target top-level with different content → conflict", () => {
    const srcRoot = vault("conf-src", {
      "memory/retrospectives/2026-04-15.md": "# Source version\nA different story.\n",
    });
    const tgtRoot = vault("conf-tgt", {
      "memory/retrospectives/2026-04-15.md": "# Target version\nAlready mine.\n",
    });
    const src = new FsVaultSource("mawjs", srcRoot);
    const tgt = new FsVaultSource("fusion", tgtRoot);

    const report = executeMerge(src, tgt);

    expect(report.totals.conflicted).toBe(1);
    expect(report.totals.copied).toBe(0);
    expect(report.totals.skipped).toBe(0);
    expect(report.categories.retrospectives[0].action).toBe("conflict");

    // Both the copy AND the conflict marker should land under from-mawjs/.
    const copyPath = join(tgtRoot, "memory/retrospectives/from-mawjs/2026-04-15.md");
    const markerPath = join(tgtRoot, "memory/retrospectives/from-mawjs/2026-04-15.md.conflict.md");
    expect(existsSync(copyPath)).toBe(true);
    expect(existsSync(markerPath)).toBe(true);

    const marker = readFileSync(markerPath, "utf-8");
    expect(marker).toContain("fusion_conflict:");
    expect(marker).toContain("conflictsWith: memory/retrospectives/2026-04-15.md");

    // Critical: the ORIGINAL target file must remain untouched (Nothing is Deleted).
    const original = readFileSync(join(tgtRoot, "memory/retrospectives/2026-04-15.md"), "utf-8");
    expect(original).toContain("Target version");
    expect(original).not.toContain("Source version");
  });
});

// ---------------------------------------------------------------------------
// 7. executeMerge with dryRun=true → classifies but does not write
// ---------------------------------------------------------------------------

describe("executeMerge — dryRun", () => {
  test("dryRun reports copies but writes nothing", () => {
    const srcRoot = vault("dry-src", {
      "memory/learnings/a.md": "# A\n",
      "memory/traces/b.md": "# B\n",
    });
    const tgtRoot = vault("dry-tgt");
    const src = new FsVaultSource("src", srcRoot);
    const tgt = new FsVaultSource("tgt", tgtRoot);

    const report = executeMerge(src, tgt, { dryRun: true });

    expect(report.totals.copied).toBe(2);
    // But no bytes touched disk:
    expect(existsSync(join(tgtRoot, "memory/learnings/from-src"))).toBe(false);
    expect(existsSync(join(tgtRoot, "memory/traces/from-src"))).toBe(false);
  });

  test("dryRun still reports conflicts without writing markers", () => {
    const srcRoot = vault("dryconf-src", {
      "memory/learnings/x.md": "source content\n",
    });
    const tgtRoot = vault("dryconf-tgt", {
      "memory/learnings/x.md": "target content\n",
    });
    const src = new FsVaultSource("s", srcRoot);
    const tgt = new FsVaultSource("t", tgtRoot);

    const report = executeMerge(src, tgt, { dryRun: true });

    expect(report.totals.conflicted).toBe(1);
    expect(existsSync(join(tgtRoot, "memory/learnings/from-s"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. executeMerge handles all 4 categories in one pass
// ---------------------------------------------------------------------------

describe("executeMerge — all categories", () => {
  test("copies one file in each of learnings/resonance/retrospectives/traces", () => {
    const cats: VaultCategory[] = ["learnings", "resonance", "retrospectives", "traces"];
    const seed: Record<string, string> = {};
    for (const c of cats) seed[`memory/${c}/file.md`] = `# ${c}\n${c} body\n`;

    const src = new FsVaultSource("mix", vault("all-src", seed));
    const tgtRoot = vault("all-tgt");
    const tgt = new FsVaultSource("dst", tgtRoot);

    const report = executeMerge(src, tgt);

    expect(report.totals.copied).toBe(4);
    for (const c of cats) {
      expect(report.categories[c]).toHaveLength(1);
      expect(report.categories[c][0].action).toBe("copy");
      expect(existsSync(join(tgtRoot, `memory/${c}/from-mix/file.md`))).toBe(true);
    }
  });
});

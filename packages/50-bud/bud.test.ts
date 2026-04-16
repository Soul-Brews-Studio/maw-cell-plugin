/**
 * Unit tests for the bud plugin handler.
 *
 * Flag parsing (via `arg`) + the 7 bud steps are module-private, so we exercise them
 * through the exported `handler` function. Each test asserts a falsifiable
 * claim about input → { ok, output, error }.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import handler from "./index";
import type { InvokeResult } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

function tmp(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bud-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function setEnv(k: string, v: string | undefined): void {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

async function cli(args: string[]): Promise<InvokeResult> {
  return handler({ source: "cli", args });
}

// ---------------------------------------------------------------------------
// 1. parseFlags — observed via handler: string, number, boolean shapes
// ---------------------------------------------------------------------------

describe("parseFlags (observed via handler)", () => {
  test("string flag (--note) carries its value; boolean flag (--root) stands alone", async () => {
    const res = await cli(["mytest", "--root", "--note", "hello world", "--dry-run"]);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("would write birth note");
    expect(res.output).toContain("Root Bud");
  });

  test("number flag (--issue) consumes its value and does not swallow positional", async () => {
    // If --issue were mis-typed as boolean, parseFlags would not advance i,
    // and "42" would pollute the positional _ array.
    const res = await cli(["numtest", "--root", "--issue", "42", "--dry-run"]);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("numtest");
    // "42" never lands in any output line as a standalone token.
    expect(res.output).not.toMatch(/(^|\s)42(\s|$)/m);
  });
});

// ---------------------------------------------------------------------------
// 2. Name validation
// ---------------------------------------------------------------------------

describe("name validation", () => {
  test("name starting with a number is rejected", async () => {
    const res = await cli(["1bad", "--root", "--dry-run"]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("invalid oracle name");
  });

  test("name ending with -view is rejected", async () => {
    const res = await cli(["mycell-view", "--root", "--dry-run"]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("-view");
  });
});

// ---------------------------------------------------------------------------
// 3. Parent requirement
// ---------------------------------------------------------------------------

describe("parent requirement", () => {
  test("no --from and no --root → error 'no parent specified'", async () => {
    const res = await cli(["orphan", "--dry-run"]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("no parent specified");
  });
});

// ---------------------------------------------------------------------------
// 4. Dry-run: plans every step, no side effects
// ---------------------------------------------------------------------------

describe("--root --dry-run", () => {
  test("plans all 7 steps, writes nothing to fleet or ghq", async () => {
    const ghq = tmp("ghq");
    const cfg = tmp("cfg");
    setEnv("GHQ_ROOT", ghq);
    setEnv("MAW_CONFIG_DIR", cfg);

    const res = await cli(["newcell", "--root", "--dry-run"]);
    expect(res.ok).toBe(true);
    const out = res.output!;
    // Step markers — without --note, the birth-note step is skipped by design.
    expect(out).toContain("would create repo");
    expect(out).toContain("would init ψ/ vault");
    expect(out).toContain("would generate CLAUDE.md");
    expect(out).toContain("would create fleet config");
    expect(out).toContain("would git commit");
    // At least 5 dry-run markers from the non-note, non-peer steps.
    const dryMarkers = (out.match(/\[dry-run\]/g) || []).length;
    expect(dryMarkers).toBeGreaterThanOrEqual(5);
    // No bytes touched disk:
    expect(existsSync(join(ghq, "github.com"))).toBe(false);
    expect(readdirSync(cfg).length).toBe(0);
  });
});

describe("--from <parent> --dry-run", () => {
  test("includes 'would add <child> to <parent>'s sync_peers'", async () => {
    const res = await cli(["child", "--from", "parent", "--dry-run"]);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("would add child to parent's sync_peers");
    expect(res.output).toContain("Budding — parent → child");
  });
});

describe("--note --dry-run", () => {
  test("with --note → 'would write birth note'; without --note → no birth note line", async () => {
    const withNote = await cli(["n1", "--root", "--note", "because", "--dry-run"]);
    expect(withNote.output).toContain("would write birth note");

    const withoutNote = await cli(["n2", "--root", "--dry-run"]);
    expect(withoutNote.output).not.toContain("would write birth note");
  });
});

// ---------------------------------------------------------------------------
// 5. handler contract: ok=true on dry-run, ok=false on bad input
// ---------------------------------------------------------------------------

describe("handler ok flag", () => {
  test("returns ok=true for a valid dry-run", async () => {
    const res = await cli(["good", "--root", "--dry-run"]);
    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
  });

  test("returns ok=false for missing name (usage error)", async () => {
    const res = await cli([]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("usage:");
  });

  test("returns ok=false when name looks like a flag (single-dash positional)", async () => {
    // parseFlags only treats `--` tokens as flags; single-dash tokens fall
    // through to positional, where the handler rejects them explicitly.
    const res = await cli(["-x"]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("looks like a flag");
  });
});

// ---------------------------------------------------------------------------
// 6. Fleet config shape — non-dry-run, env-redirected filesystem
// ---------------------------------------------------------------------------

describe("fleet config shape", () => {
  test("--root writes fleet config with windows[0].repo, sync_peers=[], no budded_from", async () => {
    const ghq = tmp("ghq");
    const cfg = tmp("cfg");
    setEnv("GHQ_ROOT", ghq);
    setEnv("MAW_CONFIG_DIR", cfg);
    // Pre-create the bud repo path so step1 skips the gh/ghq calls.
    const repoPath = join(ghq, "github.com", "TestOrg", "cell-oracle");
    mkdirSync(repoPath, { recursive: true });

    const res = await cli(["cell", "--root", "--org", "TestOrg"]);
    expect(res.ok).toBe(true);

    const fleetDir = join(cfg, "fleet");
    const files = readdirSync(fleetDir).filter(f => f.endsWith(".json"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{2}-cell\.json$/);

    const parsed = JSON.parse(readFileSync(join(fleetDir, files[0]), "utf-8"));
    expect(parsed.name).toMatch(/^\d{2}-cell$/);
    expect(Array.isArray(parsed.windows)).toBe(true);
    expect(parsed.windows[0].repo).toBe("TestOrg/cell-oracle");
    expect(parsed.windows[0].name).toBe("cell-oracle");
    expect(parsed.sync_peers).toEqual([]);
    expect(parsed.budded_from).toBeUndefined();
  });

  test("--from sets sync_peers=[parent] and budded_from=parent", async () => {
    const ghq = tmp("ghq");
    const cfg = tmp("cfg");
    setEnv("GHQ_ROOT", ghq);
    setEnv("MAW_CONFIG_DIR", cfg);
    const repoPath = join(ghq, "github.com", "TestOrg", "kid-oracle");
    mkdirSync(repoPath, { recursive: true });

    const res = await cli(["kid", "--from", "papa", "--org", "TestOrg"]);
    expect(res.ok).toBe(true);

    const fleetDir = join(cfg, "fleet");
    const files = readdirSync(fleetDir).filter(f => f.endsWith(".json"));
    const parsed = JSON.parse(readFileSync(join(fleetDir, files[0]), "utf-8"));
    expect(parsed.sync_peers).toEqual(["papa"]);
    expect(parsed.budded_from).toBe("papa");
    expect(typeof parsed.budded_at).toBe("string");
  });
});

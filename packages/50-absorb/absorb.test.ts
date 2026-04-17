/**
 * Unit tests for the absorb plugin handler.
 *
 * Each test asserts a falsifiable claim about handler input → { ok, output, error }.
 *
 * Bun's execSync does not inherit modified process.env, so GHQ_ROOT changes
 * don't propagate to ghq subprocesses. Tests that exercise the full flow
 * (ABSORB.md, fleet config) use the real vault path that ghq resolves, then
 * clean up any artifacts in afterEach.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import handler from "./index";
import type { InvokeResult } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const cleanupPaths: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

function tmp(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `absorb-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function setEnv(k: string, v: string | undefined): void {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

afterEach(() => {
  while (tempDirs.length) {
    try { rmSync(tempDirs.pop()!, { recursive: true, force: true }); } catch {}
  }
  while (cleanupPaths.length) {
    try { rmSync(cleanupPaths.pop()!, { recursive: true, force: true }); } catch {}
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

/** Create fleet dir with a config for the given oracle. */
function seedFleet(cfgDir: string, name: string, extra: Record<string, unknown> = {}): void {
  const dir = join(cfgDir, "fleet");
  mkdirSync(dir, { recursive: true });
  const cfg = {
    name: `50-${name}`,
    windows: [{ name: `${name}-oracle`, repo: `TestOrg/${name}-oracle`, provider: "github.com" }],
    sync_peers: [],
    ...extra,
  };
  writeFileSync(join(dir, `50-${name}.json`), JSON.stringify(cfg, null, 2));
}

/** Resolve the vault root that the handler's ghq subprocess will actually find. */
function realVaultRoot(): string {
  return execSync("ghq list --full-path | grep oracle-vault | head -1", {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// ---------------------------------------------------------------------------
// 1. maw absorb — handler contract
// ---------------------------------------------------------------------------

describe("maw absorb", () => {
  test("returns usage error when no oracle name given", async () => {
    const res = await cli([]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("usage:");
  });

  test("requires --confirm flag", async () => {
    const cfg = tmp("confirm");
    seedFleet(cfg, "victim");
    setEnv("MAW_CONFIG_DIR", cfg);

    const res = await cli(["victim"]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("--confirm");
    expect(res.error).toContain("irreversible");
  });

  test("--dry-run shows what would happen without doing it", async () => {
    const cfg = tmp("dry-cfg");
    seedFleet(cfg, "retiring");
    setEnv("MAW_CONFIG_DIR", cfg);

    const res = await cli(["retiring", "--dry-run"]);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("[dry-run]");
    expect(res.output).toContain("retiring");
    expect(res.output).toContain("would rsync");
    expect(res.output).toContain("would write provenance");
    expect(res.output).toContain("would mark fleet config");
    expect(res.output).toContain("would archive repo");
    expect(res.output).toContain("would announce");
  });
});

// ---------------------------------------------------------------------------
// 2. ABSORB.md generation — checks real vault, cleans up after
// ---------------------------------------------------------------------------

describe("ABSORB.md generation", () => {
  test("generates valid ABSORB.md with frontmatter", async () => {
    const cfg = tmp("prov-cfg");
    seedFleet(cfg, "doomed");
    setEnv("MAW_CONFIG_DIR", cfg);

    const res = await cli(["doomed", "--confirm", "--reason", "purpose fulfilled"]);
    expect(res.ok).toBe(true);

    const vaultRoot = realVaultRoot();
    const oracleDir = join(vaultRoot, "github.com/testorg/doomed-oracle");
    cleanupPaths.push(join(vaultRoot, "github.com/testorg"));
    const absorbMd = join(oracleDir, "ABSORB.md");

    expect(existsSync(absorbMd)).toBe(true);
    const content = readFileSync(absorbMd, "utf-8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("---\n\n#");
  });

  test("includes absorbedAt, absorbedBy, reason, sourceRepo, fileCount", async () => {
    const cfg = tmp("fields-cfg");
    seedFleet(cfg, "target");
    setEnv("MAW_CONFIG_DIR", cfg);

    const res = await cli(["target", "--confirm", "--reason", "knowledge captured"]);
    expect(res.ok).toBe(true);

    const vaultRoot = realVaultRoot();
    const absorbMd = join(vaultRoot, "github.com/testorg/target-oracle/ABSORB.md");
    cleanupPaths.push(join(vaultRoot, "github.com/testorg"));

    const content = readFileSync(absorbMd, "utf-8");
    expect(content).toContain("absorbedAt:");
    expect(content).toContain("absorbedBy:");
    expect(content).toContain("reason: knowledge captured");
    expect(content).toContain("sourceRepo:");
    expect(content).toContain("fileCount:");
  });
});

// ---------------------------------------------------------------------------
// 3. Fleet config update
// ---------------------------------------------------------------------------

describe("fleet config update", () => {
  test("marks fleet config with status=absorbed and timestamp", async () => {
    const cfg = tmp("fleet-cfg");
    seedFleet(cfg, "old");
    setEnv("MAW_CONFIG_DIR", cfg);

    const res = await cli(["old", "--confirm", "--reason", "retired"]);
    expect(res.ok).toBe(true);

    const fleetFile = join(cfg, "fleet", "50-old.json");
    const parsed = JSON.parse(readFileSync(fleetFile, "utf-8"));
    expect(parsed.status).toBe("absorbed");
    expect(typeof parsed.absorbedAt).toBe("string");
    expect(parsed.absorbedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof parsed.absorbedBy).toBe("string");
  });
});

/**
 * Integration tests — consent + merge working TOGETHER.
 *
 * These tests verify the full consent-gated merge flow using real
 * FsConsentStore + FsVaultSource + executeMerge. No mocks.
 * Each test asserts a falsifiable claim about the interaction
 * between the consent protocol and the merge engine.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { mkdirSync, writeFileSync } from "fs";

import {
  FsConsentStore,
  acceptConsent,
  hasConsent,
  proposeConsent,
  revokeConsent,
} from "./consent";
import { executeMerge, FsVaultSource } from "./merge";
import type { FusionProposal } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function tmpVault(label: string, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), `integ-${label}-`));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function makeProposal(src = "src-oracle", tgt = "tgt-oracle"): FusionProposal {
  return { childName: "fused-child", parents: [src, tgt], initiatedBy: "nat" };
}

// ---------------------------------------------------------------------------
// Integration: consent-gated merge
// ---------------------------------------------------------------------------

describe("consent-gated merge", () => {
  test("executeMerge works when bilateral consent exists", () => {
    const srcRoot = tmpVault("bi-src", {
      "memory/learnings/alpha.md": "# Alpha\nlearning from source\n",
      "memory/learnings/beta.md": "# Beta\nanother learning\n",
    });
    const tgtRoot = tmpVault("bi-tgt");

    // Set up consent on the target vault
    const store = new FsConsentStore(tgtRoot);
    proposeConsent(store, "src-oracle", "tgt-oracle", makeProposal());
    acceptConsent(store, "src-oracle", "src-oracle", "tgt-oracle");
    acceptConsent(store, "tgt-oracle", "src-oracle", "tgt-oracle");

    // Gate check — bilateral consent must be true
    expect(hasConsent(store, "src-oracle", "tgt-oracle")).toBe(true);

    // Execute merge
    const src = new FsVaultSource("src-oracle", srcRoot);
    const tgt = new FsVaultSource("tgt-oracle", tgtRoot);
    const report = executeMerge(src, tgt);

    // Verify merge succeeded
    expect(report.totals.copied).toBe(2);
    expect(report.totals.skipped).toBe(0);
    expect(report.totals.conflicted).toBe(0);

    // Verify files landed in target under from-src-oracle/
    const alphaPath = join(tgtRoot, "memory/learnings/from-src-oracle/alpha.md");
    const betaPath = join(tgtRoot, "memory/learnings/from-src-oracle/beta.md");
    expect(existsSync(alphaPath)).toBe(true);
    expect(existsSync(betaPath)).toBe(true);

    // Verify provenance header
    const content = readFileSync(alphaPath, "utf-8");
    expect(content).toContain("source: src-oracle");
  });

  test("hasConsent blocks when only partial consent", () => {
    const srcRoot = tmpVault("part-src", {
      "memory/learnings/secret.md": "# Secret\nshould not merge\n",
    });
    const tgtRoot = tmpVault("part-tgt");

    const store = new FsConsentStore(tgtRoot);
    proposeConsent(store, "src-oracle", "tgt-oracle", makeProposal());
    // Only one party accepts
    acceptConsent(store, "src-oracle", "src-oracle", "tgt-oracle");

    // Gate check — partial consent must block
    expect(hasConsent(store, "src-oracle", "tgt-oracle")).toBe(false);

    // In a consent-gated flow, merge would NOT proceed here.
    // Verify that the gate is the only barrier — the engine itself still works.
    const src = new FsVaultSource("src-oracle", srcRoot);
    const tgt = new FsVaultSource("tgt-oracle", tgtRoot);
    const report = executeMerge(src, tgt);
    expect(report.totals.copied).toBe(1); // engine works, consent is the gate
  });

  test("revoke after bilateral blocks future merges", () => {
    const tgtRoot = tmpVault("rev-tgt");
    const store = new FsConsentStore(tgtRoot);

    // Full bilateral consent
    proposeConsent(store, "src-oracle", "tgt-oracle", makeProposal());
    acceptConsent(store, "src-oracle", "src-oracle", "tgt-oracle");
    acceptConsent(store, "tgt-oracle", "src-oracle", "tgt-oracle");
    expect(hasConsent(store, "src-oracle", "tgt-oracle")).toBe(true);

    // Revoke
    revokeConsent(store, "src-oracle", "src-oracle", "tgt-oracle", "changed mind");
    expect(hasConsent(store, "src-oracle", "tgt-oracle")).toBe(false);

    // The merge engine still works — consent is the GATE, not the engine
  });

  test("consent log survives across merge — Nothing is Deleted", () => {
    const srcRoot = tmpVault("surv-src", {
      "memory/learnings/note.md": "# Note\nsurvival test\n",
    });
    const tgtRoot = tmpVault("surv-tgt");

    // Full bilateral consent
    const store = new FsConsentStore(tgtRoot);
    proposeConsent(store, "src-oracle", "tgt-oracle", makeProposal());
    acceptConsent(store, "src-oracle", "src-oracle", "tgt-oracle");
    acceptConsent(store, "tgt-oracle", "src-oracle", "tgt-oracle");

    // Snapshot the consent log before merge
    const eventsBefore = store.readEvents("src-oracle", "tgt-oracle");
    expect(eventsBefore).toHaveLength(3);

    // Execute merge
    const src = new FsVaultSource("src-oracle", srcRoot);
    const tgt = new FsVaultSource("tgt-oracle", tgtRoot);
    const report = executeMerge(src, tgt);
    expect(report.totals.copied).toBe(1);

    // Read consent log AFTER merge — all events must survive
    const eventsAfter = store.readEvents("src-oracle", "tgt-oracle");
    expect(eventsAfter).toHaveLength(3);
    expect(eventsAfter[0].type).toBe("PROPOSE");
    expect(eventsAfter[1].type).toBe("ACCEPT");
    expect(eventsAfter[2].type).toBe("ACCEPT");

    // Consent and merged files coexist in the same vault
    expect(existsSync(join(tgtRoot, "consent"))).toBe(true);
    expect(existsSync(join(tgtRoot, "memory/learnings/from-src-oracle/note.md"))).toBe(true);

    // Bilateral consent is still valid after merge
    expect(hasConsent(store, "src-oracle", "tgt-oracle")).toBe(true);
  });
});

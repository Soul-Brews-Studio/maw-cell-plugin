/**
 * absorb — retire an oracle, rsync knowledge to central vault.
 *
 * STANDALONE implementation. Same standalone-friendly pattern as 50-bud
 * and 50-fusion:
 *   - Local types (no broken ../../../plugin/types imports)
 *   - Uses `arg` (Vercel) for flag parsing
 *   - Shared shell utilities (../shared/shell)
 *
 * The 7 absorb steps:
 *   1. Verify oracle exists in fleet config
 *   2. Consent gate — require --confirm
 *   3. Sync ψ/*.md to oracle-vault
 *   4. Write provenance (ABSORB.md) in vault
 *   5. Mark fleet config as absorbed
 *   6. Archive the GitHub repo
 *   7. Announce completion
 */

import arg from "arg";
import { run, runSafe, ghqRoot, ghqListFullPath } from "../shared/shell";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join, basename } from "path";
import type { InvokeContext, InvokeResult, AbsorbRecord } from "./types";

export const command = {
  name: "absorb",
  description: "Absorb an oracle — retire + rsync knowledge to central vault",
};

const ABSORB_FLAGS = {
  "--confirm": Boolean,
  "--reason": String,
  "--dry-run": Boolean,
  "--json": Boolean,
};

/** Resolve fleet config dir (env override, then HOME-based default). */
function fleetDir(): string {
  if (process.env.MAW_CONFIG_DIR) return join(process.env.MAW_CONFIG_DIR, "fleet");
  if (!process.env.HOME) throw new Error("HOME not set — cannot resolve fleet dir. Set MAW_CONFIG_DIR or HOME.");
  return join(process.env.HOME, ".config/maw/fleet");
}

/** Read all fleet config entries (skips .disabled files). */
function loadFleetEntries(): Array<{ file: string; num: number; session: any }> {
  const dir = fleetDir();
  if (!existsSync(dir)) return [];
  const out: Array<{ file: string; num: number; session: any }> = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
    try {
      const session = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      const num = parseInt(session.name?.match(/^(\d+)-/)?.[1] || "0", 10);
      out.push({ file, num, session });
    } catch {
      // Skip malformed fleet config
    }
  }
  return out;
}

// ─── Oracle + vault resolution ──────────────────────────────────────

interface OracleInfo {
  name: string;
  repo: string;
  provider: string;
  org: string;
  repoName: string;
  fleetFile: string;
  fleetConfig: any;
}

/** Find oracle in fleet config by name. */
function resolveOracleFromFleet(name: string): OracleInfo | null {
  const entries = loadFleetEntries();
  for (const entry of entries) {
    const cfgName = (entry.session.name || "").replace(/^\d+-/, "");
    if (cfgName === name) {
      const win = entry.session.windows?.[0];
      if (!win?.repo) continue;
      const provider = win.provider || "github.com";
      const [org, repoName] = win.repo.split("/");
      return {
        name: cfgName,
        repo: win.repo,
        provider,
        org,
        repoName,
        fleetFile: join(fleetDir(), entry.file),
        fleetConfig: entry.session,
      };
    }
  }
  return null;
}

/** Find oracle-vault path via ghq. */
function resolveVaultPath(): string | null {
  const found = ghqListFullPath("oracle-vault")[0] || "";
  return found || null;
}

// ─── The 7 absorb steps ────────────────────────────────────────────

function step1_verify(name: string): { logs: string[]; oracle: OracleInfo } {
  const logs: string[] = [];
  const oracle = resolveOracleFromFleet(name);
  if (!oracle) {
    throw new Error(`oracle "${name}" not found in fleet config at ${fleetDir()}/`);
  }
  if (oracle.fleetConfig.status === "absorbed") {
    throw new Error(`oracle "${name}" is already absorbed (at ${oracle.fleetConfig.absorbedAt || "unknown"})`);
  }
  logs.push(`  \x1b[32m\u2713\x1b[0m oracle found: ${oracle.repo} on ${oracle.provider}`);
  return { logs, oracle };
}

function step2_consent(name: string, confirm: boolean, dryRun: boolean): string[] {
  const logs: string[] = [];
  if (dryRun) {
    logs.push(`  \u2b21 [dry-run] would require --confirm to absorb ${name}`);
    return logs;
  }
  if (!confirm) {
    throw new Error(
      `absorb is irreversible — pass --confirm to proceed.\n` +
      `  usage: maw absorb ${name} --confirm [--reason "purpose fulfilled"]`
    );
  }
  logs.push(`  \x1b[32m\u2713\x1b[0m consent: --confirm provided`);
  return logs;
}

function step3_sync(oraclePsiPath: string, vaultPsiDir: string, dryRun: boolean): { logs: string[]; fileCount: number } {
  const logs: string[] = [];
  if (dryRun) {
    // Count what would sync
    let count = 0;
    if (existsSync(oraclePsiPath)) {
      const countOut = runSafe(`find '${oraclePsiPath}' -name '*.md' -type f | wc -l`);
      count = parseInt(countOut, 10) || 0;
    }
    logs.push(`  \u2b21 [dry-run] would rsync ${count} .md files from \u03c8/ to vault`);
    logs.push(`  \u2b21 [dry-run]   src: ${oraclePsiPath}/`);
    logs.push(`  \u2b21 [dry-run]   dst: ${vaultPsiDir}/`);
    return { logs, fileCount: count };
  }

  if (!existsSync(oraclePsiPath)) {
    logs.push(`  \x1b[33m\u26a0\x1b[0m no \u03c8/ directory found — skipping sync (0 files)`);
    return { logs, fileCount: 0 };
  }

  mkdirSync(vaultPsiDir, { recursive: true });

  const rsyncOut = run(
    `rsync -av --include='*/' --include='*.md' --exclude='*' '${oraclePsiPath}/' '${vaultPsiDir}/'`
  );

  // Count files from rsync output (lines not ending in /)
  const lines = rsyncOut.split("\n");
  const fileCount = lines.filter(l => l.endsWith(".md")).length;

  logs.push(`  \x1b[32m\u2713\x1b[0m synced ${fileCount} .md files to vault`);
  return { logs, fileCount };
}

function step4_provenance(vaultOracleDir: string, record: AbsorbRecord, dryRun: boolean): string[] {
  const logs: string[] = [];
  const absorbMd = join(vaultOracleDir, "ABSORB.md");

  if (dryRun) {
    logs.push(`  \u2b21 [dry-run] would write provenance to ${absorbMd}`);
    return logs;
  }

  mkdirSync(vaultOracleDir, { recursive: true });

  const content = `---
absorbedAt: ${record.absorbedAt}
absorbedBy: ${record.absorbedBy}
reason: ${record.reason}
sourceRepo: ${record.sourceRepo}
fileCount: ${record.fileCount}
---

# Absorbed: ${basename(record.sourceRepo)}

Oracle ${basename(record.sourceRepo)} was absorbed into this vault on ${record.absorbedAt.slice(0, 10)}.
Knowledge preserved. Repo archived. Nothing is Deleted.
`;

  writeFileSync(absorbMd, content);
  logs.push(`  \x1b[32m\u2713\x1b[0m provenance written: ABSORB.md`);
  return logs;
}

function step5_mark(fleetFile: string, oracle: OracleInfo, record: AbsorbRecord, dryRun: boolean): string[] {
  const logs: string[] = [];
  if (dryRun) {
    logs.push(`  \u2b21 [dry-run] would mark fleet config as absorbed: ${basename(fleetFile)}`);
    return logs;
  }

  const cfg = JSON.parse(readFileSync(fleetFile, "utf-8"));
  cfg.status = "absorbed";
  cfg.absorbedAt = record.absorbedAt;
  cfg.absorbedBy = record.absorbedBy;
  cfg.absorbedTo = "the-oracle-keeps-the-human-human/oracle-vault";
  writeFileSync(fleetFile, JSON.stringify(cfg, null, 2) + "\n");

  logs.push(`  \x1b[32m\u2713\x1b[0m fleet config marked absorbed: ${basename(fleetFile)}`);
  return logs;
}

function step6_archive(repoSlug: string, dryRun: boolean): string[] {
  const logs: string[] = [];
  if (dryRun) {
    logs.push(`  \u2b21 [dry-run] would archive repo: ${repoSlug}`);
    return logs;
  }

  try {
    run(`gh repo archive ${repoSlug} -y`);
    logs.push(`  \x1b[32m\u2713\x1b[0m repo archived: ${repoSlug}`);
  } catch {
    logs.push(`  \x1b[33m\u26a0\x1b[0m repo archive failed (may need manual archive): ${repoSlug}`);
  }
  return logs;
}

function step7_announce(name: string, record: AbsorbRecord, dryRun: boolean): string[] {
  const logs: string[] = [];
  if (dryRun) {
    logs.push(`  \u2b21 [dry-run] would announce absorption of ${name}`);
    logs.push("");
    logs.push(`  \u2b21 [dry-run] Summary:`);
    logs.push(`  \u2b21   oracle:    ${name}`);
    logs.push(`  \u2b21   reason:    ${record.reason}`);
    logs.push(`  \u2b21   files:     ~${record.fileCount} .md`);
    logs.push(`  \u2b21   vault:     ${record.vaultPath}`);
    return logs;
  }

  logs.push("");
  logs.push(`  \x1b[36m\u2728 Absorption complete\x1b[0m`);
  logs.push(`    oracle:    ${name}`);
  logs.push(`    reason:    ${record.reason}`);
  logs.push(`    files:     ${record.fileCount} .md synced`);
  logs.push(`    vault:     ${record.vaultPath}`);
  logs.push(`    repo:      archived`);
  logs.push("");
  logs.push(`  Nothing is Deleted. Knowledge preserved in oracle-vault.`);
  return logs;
}

// ─── Main absorb function ──────────────────────────────────────────

async function cmdAbsorb(name: string, confirm: boolean, reason: string, dryRun: boolean): Promise<string[]> {
  const logs: string[] = [];

  if (dryRun) {
    logs.push(`\n  \u2b21 [dry-run] maw absorb ${name}\n`);
  } else {
    logs.push(`\n  \x1b[36m\u26a1 Absorb\x1b[0m \u2014 ${name}\n`);
  }

  // Step 1: Verify oracle exists
  const { logs: verifyLogs, oracle } = step1_verify(name);
  logs.push(...verifyLogs);

  // Step 2: Consent gate
  logs.push(...step2_consent(name, confirm, dryRun));

  // Step 3: Resolve vault + sync
  const vaultRoot = resolveVaultPath();
  if (!vaultRoot) {
    throw new Error("oracle-vault not found — expected in ghq. Run: ghq get the-oracle-keeps-the-human-human/oracle-vault");
  }

  const vaultOracleDir = join(vaultRoot, oracle.provider, oracle.org.toLowerCase(), oracle.repoName);
  const vaultPsiDir = join(vaultOracleDir, "\u03c8");

  // Resolve the oracle's local ψ/ path via ghq
  const ghqRootDir = ghqRoot();
  const oracleLocalPath = join(ghqRootDir, oracle.provider, oracle.org, oracle.repoName);
  const oraclePsiPath = join(oracleLocalPath, "\u03c8");

  const { logs: syncLogs, fileCount } = step3_sync(oraclePsiPath, vaultPsiDir, dryRun);
  logs.push(...syncLogs);

  // Build the absorb record
  const record: AbsorbRecord = {
    absorbedAt: new Date().toISOString(),
    absorbedBy: process.env.USER || "unknown",
    reason: reason || "absorbed",
    sourceRepo: `${oracle.provider}/${oracle.org}/${oracle.repoName}`,
    vaultPath: vaultOracleDir,
    fileCount,
  };

  // Step 4: Provenance
  logs.push(...step4_provenance(vaultOracleDir, record, dryRun));

  // Step 5: Mark fleet config
  logs.push(...step5_mark(oracle.fleetFile, oracle, record, dryRun));

  // Step 6: Archive repo
  logs.push(...step6_archive(oracle.repo, dryRun));

  // Step 7: Announce
  logs.push(...step7_announce(name, record, dryRun));

  return logs;
}

// ─── Plugin handler ────────────────────────────────────────────────

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...a: any[]) => logs.push(a.map(String).join(" "));

  try {
    if (ctx.source === "cli") {
      const args = ctx.args as string[];
      const parsed = arg(ABSORB_FLAGS, { argv: args, permissive: true });

      const name = parsed._[0] || "";
      if (!name || name === "--help" || name === "-h") {
        return {
          ok: false,
          error: "usage: maw absorb <oracle-name> --confirm [--reason <r>] [--dry-run] [--json]",
        };
      }
      if (name.startsWith("-")) {
        return { ok: false, error: `"${name}" looks like a flag, not an oracle name` };
      }

      const confirm = parsed["--confirm"] ?? false;
      const reason = parsed["--reason"] ?? "";
      const dryRun = parsed["--dry-run"] ?? false;
      const json = parsed["--json"] ?? false;

      const lines = await cmdAbsorb(name, confirm, reason, dryRun);

      if (json) {
        const oracle = resolveOracleFromFleet(name);
        console.log(JSON.stringify({
          command: "absorb",
          oracle: name,
          dryRun,
          repo: oracle?.repo,
          status: dryRun ? "dry-run" : "absorbed",
        }, null, 2));
      } else {
        for (const line of lines) console.log(line);
      }
    } else if (ctx.source === "api") {
      const body = ctx.args as Record<string, unknown>;
      const name = (body.name as string) || "";
      if (!name) return { ok: false, error: "name required" };
      const confirm = (body.confirm as boolean) ?? false;
      const reason = (body.reason as string) ?? "";
      const dryRun = (body.dryRun as boolean) ?? false;

      const lines = await cmdAbsorb(name, confirm, reason, dryRun);
      for (const line of lines) console.log(line);
    } else {
      return { ok: false, error: `unsupported source: ${ctx.source}` };
    }

    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: e.message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
  }
}

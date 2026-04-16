/**
 * bud — create a new oracle (bud from a parent).
 *
 * STANDALONE implementation. Learns from maw-js core (cmdBud at
 * src/commands/plugins/bud/impl.ts) but owns its own execution.
 *
 * Same standalone-friendly pattern as 50-fusion:
 *   - Local types (no broken ../../../plugin/types imports)
 *   - Inline parseFlags (no broken ../../../cli/parse-args import)
 *   - Inline the 7 bud steps (no broken ../../bud import)
 *
 * Simplifications vs maw-js core (deliberately omitted, can be added
 * progressively):
 *   - Does NOT support URL/slug parents (use bare oracle name)
 *   - Does NOT call cmdSoulSync (use --blank or run `maw soul-sync` after)
 *   - Does NOT call cmdWake (use `maw wake <name>` after)
 *   - Does NOT support --tiny (use `maw bud` from maw-js core for tiny buds)
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { InvokeContext, InvokeResult } from "./types";

export const command = {
  name: "bud",
  description: "Create a new oracle (bud from parent)",
};

interface BudOpts {
  from?: string;
  org?: string;
  note?: string;
  root?: boolean;
  blank?: boolean;
  dryRun?: boolean;
}

// ─── Inlined utilities ──────────────────────────────────────────────

/** Minimal flag parser — string/number/boolean. Drops unknown flags. */
function parseFlags(args: string[], spec: Record<string, "string" | "number" | "boolean">) {
  const out: { _: string[]; [k: string]: any } = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const t = spec[a];
      if (t === "boolean" || t === undefined) out[a] = true;
      else if (t === "number") out[a] = Number(args[++i]);
      else out[a] = args[++i];
    } else {
      out._.push(a);
    }
  }
  return out;
}

/** Run a shell command, return stdout. Throws on non-zero exit. */
function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Run a shell command, return stdout — never throws (returns "" on failure). */
function shSafe(cmd: string): string {
  try { return sh(cmd); } catch { return ""; }
}

/** Resolve fleet config dir (env override, then HOME-based default). Throws if HOME unset. */
function fleetDir(): string {
  if (process.env.MAW_CONFIG_DIR) return join(process.env.MAW_CONFIG_DIR, "fleet");
  if (!process.env.HOME) throw new Error("HOME not set — cannot resolve fleet dir. Set MAW_CONFIG_DIR or HOME.");
  return join(process.env.HOME, ".config/maw/fleet");
}

/** Resolve ghq root (env, then `ghq root`, then $HOME/Code). Throws if HOME unset and no overrides. */
function ghqRoot(): string {
  if (process.env.GHQ_ROOT) return process.env.GHQ_ROOT;
  const fromGhq = shSafe("ghq root");
  if (fromGhq) return fromGhq;
  if (!process.env.HOME) throw new Error("HOME not set and ghq unavailable — cannot resolve repo root. Set GHQ_ROOT or HOME.");
  return join(process.env.HOME, "Code");
}

/** Validate org name — same character set as oracle names (prevents shell injection). */
function validateOrg(org: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(org)) {
    throw new Error(`invalid org: "${org}" — must start with a letter, contain only letters/numbers/hyphens`);
  }
}

/** Strip trailing /, /.git, /.git/ from pasted/tab-completed names. */
function normalizeName(name: string): string {
  return name.replace(/\/+$/, "").replace(/\/?\.git\/?$/, "");
}

/** Read all fleet config entries (skips .disabled files). Per-entry try/catch — one bad file doesn't blast the whole bud. */
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
      // Skip malformed fleet config — log but don't abort
    }
  }
  return out;
}

// ─── The 7 bud steps ────────────────────────────────────────────────

function step1_createRepo(budRepoSlug: string, budRepoPath: string, dryRun: boolean): string[] {
  const logs: string[] = [];
  if (dryRun) {
    logs.push(`  ⬡ [dry-run] would create repo: ${budRepoSlug}`);
    logs.push(`  ⬡ [dry-run] would clone via ghq to: ${budRepoPath}`);
    return logs;
  }
  if (existsSync(budRepoPath)) {
    logs.push(`  ○ repo already exists: ${budRepoPath}`);
    return logs;
  }
  // Check if repo exists on GitHub — match the actual repo name, not the literal "name" key
  const viewOut = shSafe(`gh repo view ${budRepoSlug} --json name --jq .name 2>/dev/null`);
  const budRepoName = budRepoSlug.split("/").pop() || "";
  if (viewOut === budRepoName) {
    logs.push(`  ○ repo already exists on GitHub`);
  } else {
    sh(`gh repo create ${budRepoSlug} --private --add-readme`);
    logs.push(`  ✓ repo created on GitHub: ${budRepoSlug}`);
  }
  sh(`ghq get github.com/${budRepoSlug}`);
  logs.push(`  ✓ cloned via ghq`);
  return logs;
}

function step2_initVault(budRepoPath: string, dryRun: boolean): string[] {
  const logs: string[] = [];
  if (dryRun) {
    logs.push(`  ⬡ [dry-run] would init ψ/ vault at: ${budRepoPath}/ψ/`);
    return logs;
  }
  const psiDir = join(budRepoPath, "ψ");
  const psiDirs = [
    "memory/learnings", "memory/retrospectives", "memory/traces",
    "memory/resonance", "inbox", "outbox", "plans",
  ];
  for (const d of psiDirs) mkdirSync(join(psiDir, d), { recursive: true });
  logs.push(`  ✓ ψ/ vault initialized`);
  return logs;
}

function step3_writeClaudeMd(budRepoPath: string, name: string, parentName: string | null, dryRun: boolean): string[] {
  const logs: string[] = [];
  if (dryRun) {
    logs.push(`  ⬡ [dry-run] would generate CLAUDE.md`);
    return logs;
  }
  const claudeMd = join(budRepoPath, "CLAUDE.md");
  if (existsSync(claudeMd)) {
    logs.push(`  ○ CLAUDE.md already exists`);
    return logs;
  }
  const today = new Date().toISOString().slice(0, 10);
  const lineage = parentName
    ? `> Budded from **${parentName}** on ${today}`
    : `> Root oracle — born ${today} (no parent lineage)`;
  const lineageField = parentName ? `- **Budded from**: ${parentName}` : `- **Origin**: root (no parent)`;
  writeFileSync(claudeMd, `# ${name}-oracle

${lineage}

## Identity
- **Name**: ${name}
- **Purpose**: (to be defined by /awaken)
${lineageField}
- **Federation tag**: \`[<host>:${name}]\`

## Principles (inherited from Oracle)
1. Nothing is Deleted
2. Patterns Over Intentions
3. External Brain, Not Command
4. Curiosity Creates Existence
5. Form and Formless

## Rule 6: Oracle Never Pretends to Be Human

Sign federation messages with \`[<host>:${name}]\`.
Sign public artifacts with \`🤖 ตอบโดย ${name} จาก [Human] → ${name}-oracle\`.
Sign git commits with \`Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>\`.

Run \`/awaken\` for the full identity setup ceremony.
`);
  logs.push(`  ✓ CLAUDE.md generated`);
  return logs;
}

function step4_fleetConfig(name: string, parentName: string | null, org: string, budRepoName: string, dryRun: boolean): string[] {
  const logs: string[] = [];
  if (dryRun) {
    logs.push(`  ⬡ [dry-run] would create fleet config in ${fleetDir()}/`);
    return logs;
  }
  const dir = fleetDir();
  mkdirSync(dir, { recursive: true });
  const entries = loadFleetEntries();
  const existing = entries.find(e => e.session.name?.replace(/^\d+-/, "") === name);
  if (existing) {
    const file = join(dir, existing.file);
    const cfg = JSON.parse(readFileSync(file, "utf-8"));
    let changed = false;
    if (!cfg.budded_from && parentName) { cfg.budded_from = parentName; changed = true; }
    if (!cfg.budded_at && parentName) { cfg.budded_at = new Date().toISOString(); changed = true; }
    if (changed) {
      writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
      logs.push(`  ✓ fleet config updated with lineage`);
    } else {
      logs.push(`  ○ fleet config exists: ${existing.file}`);
    }
    return logs;
  }
  const num = entries.reduce((m, e) => Math.max(m, e.num), 0) + 1;
  const file = join(dir, `${String(num).padStart(2, "0")}-${name}.json`);
  const cfg: any = {
    name: `${String(num).padStart(2, "0")}-${name}`,
    windows: [{ name: `${name}-oracle`, repo: `${org}/${budRepoName}` }],
    sync_peers: parentName ? [parentName] : [],
  };
  if (parentName) {
    cfg.budded_from = parentName;
    cfg.budded_at = new Date().toISOString();
  }
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  logs.push(`  ✓ fleet config: ${file}`);
  return logs;
}

function step5_writeBirthNote(budRepoPath: string, name: string, parentName: string | null, note: string, dryRun: boolean): string[] {
  const logs: string[] = [];
  if (dryRun) {
    logs.push(`  ⬡ [dry-run] would write birth note`);
    return logs;
  }
  const today = new Date().toISOString().slice(0, 10);
  const path = join(budRepoPath, "ψ/memory/learnings", `${today}_birth-note.md`);
  const from = parentName ? `Budded from: ${parentName}` : "Root oracle — no parent";
  writeFileSync(path, `---\npattern: Birth note${parentName ? ` from ${parentName}` : ""}\ndate: ${today}\nsource: maw bud\n---\n\n# Why ${name} was born\n\n${note}\n\n${from}\n`);
  logs.push(`  ✓ birth note written`);
  return logs;
}

function step6_gitCommit(budRepoPath: string, parentName: string | null, dryRun: boolean): string[] {
  const logs: string[] = [];
  if (dryRun) {
    logs.push(`  ⬡ [dry-run] would git commit + push`);
    return logs;
  }
  try {
    sh(`git -C '${budRepoPath}' add -A`);
    sh(`git -C '${budRepoPath}' commit -m 'feat: birth — ${parentName ? `budded from ${parentName}` : "root oracle"}'`);
    sh(`git -C '${budRepoPath}' push -u origin HEAD`);
    logs.push(`  ✓ initial commit pushed`);
  } catch {
    logs.push(`  ⚠ git push failed (may need manual setup)`);
  }
  return logs;
}

function step7_updateParentPeers(name: string, parentName: string | null, dryRun: boolean): string[] {
  const logs: string[] = [];
  if (!parentName) return logs;
  if (dryRun) {
    logs.push(`  ⬡ [dry-run] would add ${name} to ${parentName}'s sync_peers`);
    return logs;
  }
  const dir = fleetDir();
  for (const entry of loadFleetEntries()) {
    if (entry.session.name?.replace(/^\d+-/, "") === parentName) {
      const file = join(dir, entry.file);
      const cfg = JSON.parse(readFileSync(file, "utf-8"));
      const peers: string[] = cfg.sync_peers || [];
      if (!peers.includes(name)) {
        peers.push(name);
        cfg.sync_peers = peers;
        writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
        logs.push(`  ✓ added ${name} to ${parentName}'s sync_peers`);
      }
      break;
    }
  }
  return logs;
}

// ─── Main bud function ─────────────────────────────────────────────

async function cmdBud(name: string, opts: BudOpts): Promise<string[]> {
  const logs: string[] = [];

  // Strip trailing /, /.git, /.git/ from paste/tab-completion (matches cmdBud.normalizeTarget)
  name = normalizeName(name);

  // Validate name
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name)) {
    throw new Error(`invalid oracle name: "${name}" — must start with a letter, contain only letters/numbers/hyphens`);
  }
  if (name.endsWith("-view")) {
    throw new Error(`oracle name cannot end with "-view" (reserved for ephemeral grouped sessions)`);
  }

  // Resolve org + parent (org validated to prevent shell injection)
  const org = opts.org || "Soul-Brews-Studio";
  validateOrg(org);
  const parentName = opts.root ? null : opts.from || null;
  if (parentName) validateOrg(parentName); // same character set
  if (!parentName && !opts.root) {
    throw new Error("no parent specified — pass --from <oracle> or --root");
  }

  const budRepoName = `${name}-oracle`;
  const budRepoSlug = `${org}/${budRepoName}`;
  const budRepoPath = join(ghqRoot(), "github.com", org, budRepoName);

  if (opts.root) {
    logs.push(`\n  🌱 Root Bud — ${name} (no parent lineage)\n`);
  } else {
    logs.push(`\n  🧬 Budding — ${parentName} → ${name}\n`);
  }

  // 7 steps
  logs.push(...step1_createRepo(budRepoSlug, budRepoPath, !!opts.dryRun));
  logs.push(...step2_initVault(budRepoPath, !!opts.dryRun));
  logs.push(...step3_writeClaudeMd(budRepoPath, name, parentName, !!opts.dryRun));
  logs.push(...step4_fleetConfig(name, parentName, org, budRepoName, !!opts.dryRun));
  if (opts.note) logs.push(...step5_writeBirthNote(budRepoPath, name, parentName, opts.note, !!opts.dryRun));
  logs.push(...step6_gitCommit(budRepoPath, parentName, !!opts.dryRun));
  logs.push(...step7_updateParentPeers(name, parentName, !!opts.dryRun));

  // Soul-sync notice (not implemented standalone — needs maw-js for now)
  if (!opts.dryRun && !opts.blank && parentName) {
    logs.push(`  ⚠ soul-sync not run (cell-plugin standalone) — run \`maw soul-sync ${parentName} --from\` from inside ${budRepoPath} to seed inherited memory`);
  }

  // Wake notice (not implemented standalone)
  if (!opts.dryRun) {
    logs.push(`  💡 next: run \`maw wake ${name}\` to start a session`);
  }

  return logs;
}

// ─── Plugin handler ────────────────────────────────────────────────

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  try {
    let name = "";
    let opts: BudOpts = {};

    if (ctx.source === "cli") {
      const args = ctx.args as string[];
      const flags = parseFlags(args, {
        "--from": "string",
        "--org": "string",
        "--note": "string",
        "--root": "boolean",
        "--blank": "boolean",
        "--dry-run": "boolean",
      });
      name = flags._[0] || "";
      if (!name || name === "--help" || name === "-h") {
        return {
          ok: false,
          error: "usage: maw bud <name> [--from <oracle> | --root] [--org <org>] [--note <text>] [--blank] [--dry-run]",
        };
      }
      if (name.startsWith("-")) {
        return { ok: false, error: `"${name}" looks like a flag, not an oracle name` };
      }
      opts = {
        from: flags["--from"],
        org: flags["--org"],
        note: flags["--note"],
        root: flags["--root"],
        blank: flags["--blank"],
        dryRun: flags["--dry-run"],
      };
    } else if (ctx.source === "api") {
      const body = ctx.args as Record<string, unknown>;
      name = (body.name as string) || "";
      if (!name) return { ok: false, error: "name required" };
      opts = {
        from: body.from as string | undefined,
        org: body.org as string | undefined,
        note: body.note as string | undefined,
        root: body.root as boolean | undefined,
        blank: body.blank as boolean | undefined,
        dryRun: body.dryRun as boolean | undefined,
      };
    } else {
      return { ok: false, error: `unsupported source: ${ctx.source}` };
    }

    const lines = await cmdBud(name, opts);
    return { ok: true, output: lines.join("\n") };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

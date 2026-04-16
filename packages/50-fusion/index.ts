/**
 * fusion — merge knowledge between oracles.
 *
 * Fuses ψ/memory (learnings, resonance, retrospectives) from a source
 * oracle into the current oracle's vault. Like a soul-sync but selective.
 *
 *   maw fusion neo              → merge neo's learnings into current oracle
 *   maw fusion neo --dry-run    → show what would merge
 *   maw fusion neo --into mawjs → merge neo → mawjs
 */

import arg from "arg";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { InvokeContext, InvokeResult, VaultCategory } from "./types";
import { executeMerge, FsVaultSource } from "./merge";
import {
  FsConsentStore,
  acceptConsent,
  computeConsentState,
  hasConsent,
  proposeConsent,
  rejectConsent,
  revokeConsent,
} from "./consent";

export const command = {
  name: "fusion",
  description: "Fuse two oracles — merge knowledge across vaults",
};

/**
 * Resolve an oracle's vault path by name, in this priority order:
 *   1. ghq list — find any repo matching `<name>-oracle` or `<name>` (any org)
 *   2. fleet config — read ~/.config/maw/fleet/*.json for a matching session
 *
 * Works for ANY org. No hardcoded org names.
 */
function resolveOracleVault(oracleName: string, ghqRoot: string): string | null {
  // Strategy 1: ghq list — match `/<name>-oracle$` then `/<name>$`
  for (const suffix of [`${oracleName}-oracle`, oracleName]) {
    try {
      const found = execSync(
        `ghq list --full-path 2>/dev/null | grep -i '/${suffix}$' | head -1`,
        { encoding: "utf-8", shell: "/bin/sh" }
      ).trim();
      if (found) {
        const psi = join(found, "ψ");
        if (existsSync(psi)) return psi;
      }
    } catch { /* grep returns 1 on no-match */ }
  }

  // Strategy 2: fleet config — read ~/.config/maw/fleet/*.json
  try {
    const home = process.env.HOME || "";
    const fleetDir = join(home, ".config/maw/fleet");
    if (existsSync(fleetDir)) {
      const { readdirSync, readFileSync } = require("fs");
      for (const file of readdirSync(fleetDir).filter((f: string) => f.endsWith(".json"))) {
        const cfg = JSON.parse(readFileSync(join(fleetDir, file), "utf-8"));
        const name = (cfg.name || "").replace(/^\d+-/, "");
        if (name === oracleName && cfg.windows?.[0]?.repo) {
          const psi = join(ghqRoot, "github.com", cfg.windows[0].repo, "ψ");
          if (existsSync(psi)) return psi;
        }
      }
    }
  } catch { /* fleet config optional */ }

  return null;
}

// ---------------------------------------------------------------------------
// Consent subcommand — maw fusion consent <verb> ...
// ---------------------------------------------------------------------------

/** Resolve the consent store location — current working directory's ψ/. */
function resolveConsentVault(): string | null {
  const cwdPsi = join(process.cwd(), "ψ");
  return existsSync(cwdPsi) ? cwdPsi : null;
}

/** arg spec shared by all consent subcommands. */
const CONSENT_FLAGS = {
  "--child": String,
  "--by": String,
  "--reason": String,
  "--json": Boolean,
};

const CONSENT_USAGE = [
  "usage: maw fusion consent <verb> ...",
  "",
  "  propose <a> <b> --child <name> [--by <human>]",
  "  accept  <who> <a> <b> [--reason <r>]",
  "  reject  <who> <a> <b> [--reason <r>]",
  "  revoke  <who> <a> <b> [--reason <r>]",
  "  status  <a> <b>",
  "  check   <a> <b>       (exits 0 if bilateral, 1 otherwise)",
  "  log     <a> <b>",
].join("\n");

function handleConsent(rawArgs: string[]): InvokeResult {
  const parsed = arg(CONSENT_FLAGS, { argv: rawArgs, permissive: true });
  const [verb, ...positionals] = parsed._;

  if (!verb) {
    console.log(CONSENT_USAGE);
    return { ok: false, error: "missing verb" };
  }

  const vaultPath = resolveConsentVault();
  if (!vaultPath) {
    return { ok: false, error: "no ψ/ in cwd — run from an oracle repo" };
  }
  const store = new FsConsentStore(vaultPath);
  const json = parsed["--json"] ?? false;

  try {
    if (verb === "propose") {
      const [a, b] = positionals;
      const child = parsed["--child"];
      const by = parsed["--by"] ?? process.env.USER ?? "unknown";
      if (!a || !b || !child) {
        return { ok: false, error: "usage: consent propose <a> <b> --child <name> [--by <human>]" };
      }
      const event = proposeConsent(store, a, b, { childName: child, parents: [a, b], initiatedBy: by });
      console.log(`\x1b[36m⚡ Consent\x1b[0m PROPOSE ${a} ↔ ${b} → child=${child} by=${by}`);
      console.log(`  \x1b[90mevent logged @ ${event.timestamp}\x1b[0m`);
      return { ok: true, output: json ? JSON.stringify(event, null, 2) : undefined };
    }

    if (verb === "accept" || verb === "reject" || verb === "revoke") {
      const [who, a, b] = positionals;
      const reason = parsed["--reason"];
      if (!who || !a || !b) {
        return { ok: false, error: `usage: consent ${verb} <who> <a> <b> [--reason <r>]` };
      }
      const fn = verb === "accept" ? acceptConsent : verb === "reject" ? rejectConsent : revokeConsent;
      const event = fn(store, who, a, b, reason);
      const color = verb === "accept" ? "\x1b[32m" : verb === "reject" ? "\x1b[31m" : "\x1b[33m";
      console.log(`${color}⚡ Consent\x1b[0m ${verb.toUpperCase()} by ${who} on ${a} ↔ ${b}${reason ? ` — ${reason}` : ""}`);
      const status = computeConsentState(store.readEvents(a, b));
      console.log(`  \x1b[90mstate → ${status.state}\x1b[0m`);
      return { ok: true, output: json ? JSON.stringify(event, null, 2) : undefined };
    }

    if (verb === "status") {
      const [a, b] = positionals;
      if (!a || !b) return { ok: false, error: "usage: consent status <a> <b>" };
      const status = computeConsentState(store.readEvents(a, b));
      if (json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(`\x1b[36m⚡ Consent Status\x1b[0m ${a} ↔ ${b}`);
        console.log(`  state:      \x1b[33m${status.state}\x1b[0m`);
        console.log(`  events:     ${status.events.length}`);
        console.log(`  acceptedBy: [${status.acceptedBy.join(", ")}]`);
        if (status.rejectedBy.length) console.log(`  rejectedBy: [${status.rejectedBy.join(", ")}]`);
        if (status.revokedBy.length)  console.log(`  revokedBy:  [${status.revokedBy.join(", ")}]`);
        if (status.proposal) console.log(`  proposal:   child=${status.proposal.childName} by=${status.proposal.initiatedBy}`);
      }
      return { ok: true };
    }

    if (verb === "check") {
      const [a, b] = positionals;
      if (!a || !b) return { ok: false, error: "usage: consent check <a> <b>" };
      const ok = hasConsent(store, a, b);
      console.log(ok ? "\x1b[32m✓\x1b[0m bilateral consent" : "\x1b[31m✗\x1b[0m no bilateral consent");
      return { ok, error: ok ? undefined : "no bilateral consent" };
    }

    if (verb === "log") {
      const [a, b] = positionals;
      if (!a || !b) return { ok: false, error: "usage: consent log <a> <b>" };
      const events = store.readEvents(a, b);
      if (json) {
        console.log(JSON.stringify(events, null, 2));
      } else {
        console.log(`\x1b[36m⚡ Consent Log\x1b[0m ${a} ↔ ${b} (${events.length} events)`);
        for (const [i, e] of events.entries()) {
          const col = e.type === "ACCEPT" ? "\x1b[32m" : e.type === "REJECT" ? "\x1b[31m" : e.type === "REVOKE" ? "\x1b[33m" : "\x1b[36m";
          console.log(`  ${i + 1}. ${col}${e.type.padEnd(7)}\x1b[0m from=${e.from.padEnd(10)} @ ${e.timestamp}${e.rationale ? ` — ${e.rationale}` : ""}`);
        }
      }
      return { ok: true };
    }

    console.log(CONSENT_USAGE);
    return { ok: false, error: `unknown verb: ${verb}` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...a: any[]) => logs.push(a.map(String).join(" "));

  try {
    if (ctx.source === "cli") {
      const args = ctx.args as string[];

      // Subcommand dispatch: `maw fusion consent <verb> ...`
      if (args[0] === "consent") {
        const result = handleConsent(args.slice(1));
        const captured = logs.join("\n") || undefined;
        return { ...result, output: captured ?? result.output };
      }

      const parsed = arg({
        "--into": String,
        "--dry-run": Boolean,
        "--json": Boolean,
        "--category": String,
      }, { argv: args, permissive: true });

      const source = parsed._[0];
      const dryRun = parsed["--dry-run"] ?? false;
      const target = parsed["--into"];
      const category = parsed["--category"];
      const json = parsed["--json"] ?? false;

      if (!source) {
        return { ok: false, error: "usage: maw fusion <source-oracle> [--into <target>] [--dry-run]\n       maw fusion consent <verb> ..." };
      }

      console.log(`\x1b[36m⚡ Fusion\x1b[0m — ${source} → ${target ?? "current oracle"}`);
      console.log("");

      // Resolve source oracle's ψ/ path (org-agnostic)
      const ghqRoot = execSync("ghq root", { encoding: "utf-8" }).trim();

      const sourcePath = resolveOracleVault(source, ghqRoot);
      if (!sourcePath) {
        console.log(`  \x1b[31m✗\x1b[0m source vault not found for: ${source}`);
        console.log(`  \x1b[90m  searched ghq list and ~/.config/maw/fleet/\x1b[0m`);
        return { ok: false, output: logs.join("\n"), error: `vault not found: ${source}` };
      }

      // Resolve target vault path
      // --into <name> → resolve via ghq + fleet (same as source)
      // (default)     → current working directory's ψ/ (the oracle invoking this command)
      let targetPath: string | null;
      if (target) {
        targetPath = resolveOracleVault(target, ghqRoot);
        if (!targetPath) {
          console.log(`  \x1b[31m✗\x1b[0m target vault not found for: ${target}`);
          console.log(`  \x1b[90m  searched ghq list and ~/.config/maw/fleet/\x1b[0m`);
          return { ok: false, output: logs.join("\n"), error: `target vault not found: ${target}` };
        }
      } else {
        const cwdPsi = join(process.cwd(), "ψ");
        if (!existsSync(cwdPsi)) {
          console.log(`  \x1b[31m✗\x1b[0m no target — pass --into <name> or run from an oracle repo with ψ/`);
          return { ok: false, output: logs.join("\n"), error: "no target vault" };
        }
        targetPath = cwdPsi;
      }

      const sourceVault = new FsVaultSource(source, sourcePath);
      const targetVault = new FsVaultSource(target ?? "current", targetPath);

      const report = executeMerge(sourceVault, targetVault, { dryRun, category: category as VaultCategory | undefined });

      if (json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log("");
        console.log(`  \x1b[36mMerge Report\x1b[0m`);
        console.log(`    skipped:    ${report.totals.skipped}`);
        console.log(`    copied:     ${report.totals.copied}`);
        console.log(`    conflicted: ${report.totals.conflicted}`);
        if (dryRun) console.log(`  \x1b[33m⬡\x1b[0m dry-run — no files written`);
        else        console.log(`  \x1b[32m✓\x1b[0m fusion complete`);
      }
    }

    else if (ctx.source === "api") {
      const body = ctx.args as Record<string, unknown>;
      console.log(JSON.stringify({ plugin: "fusion", source: body.source, status: "scan-only" }));
    }

    else if (ctx.source === "peer") {
      const body = ctx.args as Record<string, unknown>;
      console.log(`fusion request from ${body.from ?? "unknown"}`);
    }

    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: logs.join("\n") || e.message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
  }
}

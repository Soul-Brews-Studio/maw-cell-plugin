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

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { InvokeContext, InvokeResult, VaultCategory } from "./types";
import { executeMerge, FsVaultSource } from "./merge";

export const command = {
  name: "fusion",
  description: "Fuse two oracles — merge knowledge across vaults",
};

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...a: any[]) => logs.push(a.map(String).join(" "));

  try {
    if (ctx.source === "cli") {
      const args = ctx.args as string[];
      const source = args.find(a => !a.startsWith("-"));
      const dryRun = args.includes("--dry-run");
      const intoIdx = args.indexOf("--into");
      const target = intoIdx >= 0 ? args[intoIdx + 1] : undefined;
      const category = args.includes("--category") ? args[args.indexOf("--category") + 1] : undefined;
      const json = args.includes("--json");

      if (!source) {
        return { ok: false, error: "usage: maw fusion <source-oracle> [--into <target>] [--dry-run]" };
      }

      console.log(`\x1b[36m⚡ Fusion\x1b[0m — ${source} → ${target ?? "current oracle"}`);
      console.log("");

      // Resolve source oracle's ψ/ path
      const ghqRoot = execSync("ghq root", { encoding: "utf-8" }).trim();

      const sourceCandidates = [
        join(ghqRoot, "github.com/Soul-Brews-Studio", `${source}-oracle`, "ψ"),
        join(ghqRoot, "github.com/the-oracle-keeps-the-human-human", `${source}-oracle`, "ψ"),
      ];

      const sourcePath = sourceCandidates.find(p => existsSync(p));
      if (!sourcePath) {
        console.log(`  \x1b[31m✗\x1b[0m source vault not found for: ${source}`);
        console.log(`  \x1b[90m  tried: ${sourceCandidates.join(", ")}\x1b[0m`);
        return { ok: false, output: logs.join("\n"), error: `vault not found: ${source}` };
      }

      // Resolve target vault path (current oracle if --into omitted)
      const targetCandidates = target
        ? [
            join(ghqRoot, "github.com/Soul-Brews-Studio", `${target}-oracle`, "ψ"),
            join(ghqRoot, "github.com/the-oracle-keeps-the-human-human", `${target}-oracle`, "ψ"),
          ]
        : [process.cwd() + "/ψ"];  // current oracle
      const targetPath = targetCandidates.find(p => existsSync(p));
      if (!targetPath) {
        console.log(`  \x1b[31m✗\x1b[0m target vault not found`);
        return { ok: false, output: logs.join("\n"), error: "target vault not found" };
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

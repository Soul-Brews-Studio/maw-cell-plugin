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

interface InvokeContext {
  source: "cli" | "api" | "peer";
  args: string[] | Record<string, unknown>;
}

interface InvokeResult {
  ok: boolean;
  output?: string;
  error?: string;
}

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

      if (!source) {
        return { ok: false, error: "usage: maw fusion <source-oracle> [--into <target>] [--dry-run]" };
      }

      console.log(`\x1b[36m⚡ Fusion\x1b[0m — ${source} → ${target ?? "current oracle"}`);
      console.log("");

      // Resolve source oracle's ψ/ path
      const { execSync } = require("child_process");
      const ghqRoot = execSync("ghq root", { encoding: "utf-8" }).trim();
      const { existsSync, readdirSync, cpSync } = require("fs");
      const { join } = require("path");

      // Try common patterns for oracle vault location
      const candidates = [
        join(ghqRoot, "github.com/Soul-Brews-Studio", `${source}-oracle`, "ψ/memory"),
        join(ghqRoot, "github.com/Soul-Brews-Studio", source, "ψ/memory"),
      ];

      const sourcePath = candidates.find(p => existsSync(p));
      if (!sourcePath) {
        console.log(`  \x1b[31m✗\x1b[0m source vault not found for: ${source}`);
        console.log(`  \x1b[90m  tried: ${candidates.join(", ")}\x1b[0m`);
        return { ok: false, output: logs.join("\n"), error: `vault not found: ${source}` };
      }

      // Scan what's available
      const categories = ["learnings", "resonance", "retrospectives", "traces"];
      let totalFiles = 0;

      for (const cat of categories) {
        const catDir = join(sourcePath, cat);
        if (!existsSync(catDir)) continue;
        const files = readdirSync(catDir, { recursive: true })
          .filter((f: string) => f.endsWith(".md"));
        if (files.length === 0) continue;

        console.log(`  \x1b[36m${cat}\x1b[0m — ${files.length} files`);
        for (const f of files.slice(0, 3)) {
          console.log(`    ${dryRun ? "[dry-run] " : ""}${f}`);
        }
        if (files.length > 3) console.log(`    ... +${files.length - 3} more`);
        totalFiles += files.length;

        if (!dryRun) {
          // TODO: actual merge — copy to target vault with conflict resolution
          // For now: just list what would merge
        }
      }

      console.log("");
      if (dryRun) {
        console.log(`\x1b[33m⬡\x1b[0m dry-run — ${totalFiles} files would fuse`);
      } else {
        console.log(`\x1b[32m✓\x1b[0m fusion scanned — ${totalFiles} files found`);
        console.log(`\x1b[90m  (merge not yet implemented — use --dry-run to preview)\x1b[0m`);
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

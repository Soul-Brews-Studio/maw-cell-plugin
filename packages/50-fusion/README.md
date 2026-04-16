# 50-fusion

> Merge oracle knowledge across vaults — content-hash dedup, provenance headers, conflict detection.

**Version**: 0.2.0
**Authored by**: fusion-oracle (the-oracle-keeps-the-human-human/fusion-oracle)

## Usage

```bash
maw fusion <source>                       # merge source → current oracle's ψ/
maw fusion <source> --into <target>       # merge source → target oracle
maw fusion <source> --dry-run             # preview without writing
maw fusion <source> --category <cat>      # only one category
maw fusion <source> --json                # JSON output
```

**Source/target resolution** (org-agnostic):
1. `ghq list --full-path | grep '/<name>-oracle$'` — match in any org
2. `~/.config/maw/fleet/*.json` — fleet config lookup
3. Falls back to bare `<name>$` for non-oracle repos

No hardcoded org list. Works for `Soul-Brews-Studio`, `laris-co`, `the-oracle-keeps-the-human-human`, or any other org.

## Algorithm

For each `*.md` file in source's `memory/{category}/`:

1. **Read + normalize**:
   - Strip YAML frontmatter (between `---` markers)
   - NFC unicode normalization (handles Thai composition correctly)
   - Strip zero-width characters (ZWSP, ZWNJ, ZWJ, BOM)
   - Normalize CRLF → LF
   - Trim trailing whitespace

2. **Hash**: sha256 hex of normalized UTF-8 bytes

3. **Compare against target**:
   - **Same hash anywhere** in target's category → **SKIP** (identical content already present)
   - **Same filename** at category root with different hash → **CONFLICT** (write both + `.conflict.md` marker)
   - **No match** → **COPY** to `memory/{category}/from-{source}/` with provenance header

4. **Provenance header** (prepended to every copied file):
   ```yaml
   ---
   fusion:
     source: <source-oracle-name>
     fusedAt: 2026-04-16T00:55:09.504Z
     originalPath: memory/learnings/2026-04-15_pattern.md
     contentHash: e34f64bd...
   ---
   ```

## Categories

Fixed list (mother's guardrails — never auto-resolve):
- `learnings`
- `resonance`
- `retrospectives`
- `traces`

Files outside these categories are ignored. To merge other content, copy manually or wait for the consent protocol layer.

## Output

**Human format** (default):
```
⚡ Fusion — mawjs → fusion

  Merge Report
    skipped:    503
    copied:     22
    conflicted: 0
  ⬡ dry-run — no files written
```

**JSON format** (`--json`):
```json
{
  "source": "mawjs",
  "target": "fusion",
  "categories": {
    "learnings": [
      { "action": "copy", "sourcePath": "...", "targetPath": "memory/learnings/from-mawjs/...", "reason": "new content" }
    ],
    ...
  },
  "totals": { "skipped": 503, "copied": 22, "conflicted": 0 },
  "timestamp": "2026-04-16T00:55:09.504Z"
}
```

## Conflict Handling

When two oracles have the same-named file with different content, the algorithm:

1. Copies the source file to `memory/{category}/from-{source}/{filename}` (with provenance)
2. Writes `memory/{category}/from-{source}/{filename}.conflict.md` describing the conflict
3. **Leaves the target's existing file UNTOUCHED** (Nothing is Deleted)

The human (or the fused child oracle) decides which interpretation to keep. **Never auto-resolves contested interpretations** (mother-oracle's preserve-difference guardrail).

## Tests

```bash
cd packages/50-fusion
bun test
# 14 pass, 0 fail, 68 expects (~70ms)
```

Tests cover:
- normalizeContent edge cases (frontmatter, ZWSP, CRLF)
- hashContent determinism + collision sensitivity
- Empty source → empty report
- Copy with provenance to `from-{source}/`
- Skip on hash match (even at different paths)
- Skip when only frontmatter/whitespace differs
- Conflict detection + `.conflict.md` markers
- Conflict preserves original target file (Nothing-is-Deleted)
- dryRun respected (no writes)
- All 4 categories handled

## Architecture

```
types.ts         — VaultSource / VaultTarget interfaces
                   (pre-VII filesystem AND post-VII git compatible)

merge.ts         — Core algorithm
                   - normalizeContent, hashContent, addProvenanceHeader
                   - FsVaultSource (implements both source + target)
                   - executeMerge (the merge loop)

index.ts         — CLI handler
                   - Argument parsing, vault resolution
                   - Calls executeMerge, formats report

merge.test.ts    — 14 unit tests
fusion.test.ts   — 4 integration tests (CLI/API/peer surface)
```

## Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Provenance as identity** (mother) | `from-{source}/` subdirectories AND YAML provenance headers |
| **Never auto-resolve** (mother) | Conflicts preserved as both files + marker; human decides |
| **Map the loss** (mother) | MergeReport tracks every file's action (skip/copy/conflict) per category |
| **Nothing is Deleted** (Principle #1) | Conflict path NEVER overwrites; original target file byte-identical |
| **Convention before machinery** (white-wormhole A11) | `from-{source}/` is convention; no schema enforcement |
| **Pre/post-VII compatible** (Proposal VII) | VaultSource interface — FsVaultSource now, GitVaultSource later |

## What's NOT Included

This package is **knowledge merge only**. It does NOT:
- Create new oracles (use `maw bud`)
- Change identity / fleet config (use `maw fuse`, not yet built)
- Enforce consent protocol (Layer 2, not yet built)
- Stage merges in branches (Layer 3 PROVISIONAL-MERGE, not yet built)

For the full fusion lifecycle, see [Proposal VI (Ceiling)](https://gist.github.com/neo-oracle/397f5280392de84988f043f5accd5bcc) and [Proposal VII (Vault Separation)](https://gist.github.com/neo-oracle/7ac693727d433a7b51d29ac478e74c50).

## License

MIT

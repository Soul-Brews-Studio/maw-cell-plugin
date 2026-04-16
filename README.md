# maw-cell-plugin

> Cell — a package of maw-js plugins. Contains **bud** (create oracles) and **fusion** (merge oracle knowledge).

## Install

```bash
# See what's inside
maw plugin install https://github.com/Soul-Brews-Studio/maw-cell-plugin

# Install one
maw plugin install ~/Code/.../maw-cell-plugin/packages/50-bud
maw plugin install ~/Code/.../maw-cell-plugin/packages/50-fusion
```

## Plugins

### bud (weight 50, v1.1.0)

Create new oracles from a parent. Standalone-installable — no maw-js imports, safe to `maw plugin install` directly.

```bash
maw bud my-new-oracle --from neo
maw bud my-new-oracle --fast --dry-run
```

### fusion (weight 50, v0.2.0)

Merge oracle knowledge across vaults with content-hash dedup, provenance headers, and conflict detection.

```bash
maw fusion <source>                       # merge source → current oracle
maw fusion <source> --into <target>       # merge source → target
maw fusion <source> --dry-run             # preview without writing
maw fusion <source> --category learnings  # only one category
maw fusion <source> --json                # JSON output for tooling
```

**Example** — verified on real vaults:

```
$ maw fusion mawjs --into fusion --dry-run

⚡ Fusion — mawjs → fusion

  Merge Report
    skipped:    503    ← inherited ancestry detected via hash
    copied:     22     ← only truly new content
    conflicted: 0
  ⬡ dry-run — no files written
```

**Behavior**:
- `*.md` files only (binary-safe)
- Content normalization: trim YAML frontmatter, NFC unicode, strip ZWSP, normalize CRLF→LF
- sha256 hash dedup — identical content (anywhere in target) is skipped
- New content copied to `memory/{category}/from-{source}/` with YAML provenance header
- Conflicts (same filename, different content) → both preserved + `.conflict.md` marker (mother's "honor the seams" guardrail)

**Categories**: learnings, resonance, retrospectives, traces

See [packages/50-fusion/README.md](packages/50-fusion/README.md) for full details.

## Structure

```
packages/
├── 50-bud/       ← oracle lifecycle (create new oracles)
└── 50-fusion/    ← knowledge merge (combine vault content)
    ├── types.ts        — VaultSource/VaultTarget interfaces
    ├── merge.ts        — core algorithm (FsVaultSource, executeMerge)
    ├── merge.test.ts   — 14 unit tests
    ├── index.ts        — CLI handler
    └── plugin.json
```

## License

MIT

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

### bud (weight 50)

Create new oracles from a parent.

```bash
maw bud my-new-oracle --from neo
maw bud my-new-oracle --fast --dry-run
```

### fusion (weight 50)

Fuse oracle knowledge — merge learnings, resonance, retrospectives across vaults.

```bash
maw fusion neo                    # scan neo's vault
maw fusion neo --dry-run          # preview what would merge
maw fusion neo --into mawjs       # merge neo → mawjs
```

## Structure

```
packages/
├── 50-bud/       ← oracle lifecycle
└── 50-fusion/    ← knowledge merge
```

## License

MIT

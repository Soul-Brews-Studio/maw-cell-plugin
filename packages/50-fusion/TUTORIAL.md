# Fusion Consent — Tutorial

> Bilateral consent for oracle fusion. Both parties must explicitly ACCEPT before two oracles can merge.

## What You'll Learn

By the end of this tutorial you will:
- Understand the consent state machine (none → proposed → partial → bilateral → revoked)
- Run every consent verb via the `maw` CLI
- See the append-only JSONL log on disk
- Prove *Nothing is Deleted* — REVOKE is an event, not an erasure
- Know how to gate a real `maw fusion` with `hasConsent()`

## Prerequisites

- `maw` CLI installed (`maw --version` → `v2.0.0-alpha.40` or later)
- Fusion plugin v0.3.0+ (`maw plugin ls | grep fusion`)
- A directory with a `ψ/` subdirectory (an oracle repo, or `mkdir -p /tmp/demo/ψ`)

## The Shape of Consent

```
PROPOSE       — start the protocol. "Let's fuse A and B into child C"
 │
 ├─ ACCEPT    — one party says yes. state = "partial"
 │   │
 │   └─ ACCEPT (other) — state = "bilateral" ← fusion allowed
 │       │
 │       └─ REVOKE      — state = "revoked"  ← fusion blocked again
 │
 └─ REJECT    — either party says no. state = "rejected"
```

Bilateral is the only state where `hasConsent()` returns true.

## Part 1: Your First Consent Flow

Open a terminal in a directory with `ψ/`:

```bash
mkdir -p /tmp/consent-demo/ψ && cd /tmp/consent-demo
```

### 1.1 Propose

```bash
maw fusion consent propose alpha beta --child alpha-beta-child --by nat
```

```
⚡ Consent PROPOSE alpha ↔ beta → child=alpha-beta-child by=nat
  event logged @ 2026-04-16T03:35:38Z
```

What happened: a `PROPOSE` event was appended to `ψ/consent/alpha_beta.jsonl`. Note the pair key is alphabetically sorted — `alpha_beta` regardless of who proposes.

### 1.2 Check the status

```bash
maw fusion consent status alpha beta
```

```
⚡ Consent Status alpha ↔ beta
  state:      proposed
  events:     1
  acceptedBy: []
  proposal:   child=alpha-beta-child by=nat
```

### 1.3 Gate a hypothetical merge — `check`

```bash
maw fusion consent check alpha beta
echo "exit code: $?"
```

```
✗ no bilateral consent
exit code: 1
```

`check` is the **scriptable gate**. Use it in shell pipelines:

```bash
maw fusion consent check alpha beta && maw fusion alpha --into beta
```

### 1.4 Alpha accepts

```bash
maw fusion consent accept alpha alpha beta --reason agreed
```

```
⚡ Consent ACCEPT by alpha on alpha ↔ beta — agreed
  state → partial
```

Positional args: `accept <who> <a> <b>` — the first argument identifies *which* party is accepting (`who`), then the pair (`a`, `b`).

### 1.5 Still not bilateral

```bash
maw fusion consent check alpha beta
```

```
✗ no bilateral consent
```

One ACCEPT is not enough. **Bilateral means both.**

### 1.6 Beta accepts

```bash
maw fusion consent accept beta alpha beta --reason agreed
```

```
⚡ Consent ACCEPT by beta on alpha ↔ beta — agreed
  state → bilateral
```

### 1.7 Now bilateral

```bash
maw fusion consent check alpha beta
echo "exit code: $?"
```

```
✓ bilateral consent
exit code: 0
```

Fusion is now authorized.

## Part 2: Revoke — Nothing is Deleted

Consent can be withdrawn. But the decision to withdraw is itself a permanent event.

```bash
maw fusion consent revoke alpha alpha beta --reason changed-mind
```

```
⚡ Consent REVOKE by alpha on alpha ↔ beta — changed-mind
  state → revoked
```

```bash
maw fusion consent check alpha beta
```

```
✗ no bilateral consent
```

Fusion is now blocked. But the history is preserved:

```bash
maw fusion consent log alpha beta
```

```
⚡ Consent Log alpha ↔ beta (4 events)
  1. PROPOSE from=alpha  @ 2026-04-16T03:35:38Z
  2. ACCEPT  from=alpha  @ 2026-04-16T03:35:48Z — agreed
  3. ACCEPT  from=beta   @ 2026-04-16T03:35:48Z — agreed
  4. REVOKE  from=alpha  @ 2026-04-16T03:36:09Z — changed-mind
```

**All four events persist.** The PROPOSE and both ACCEPTs are not overwritten — REVOKE is an additional event, and the state machine replays the whole log to compute the current state.

This is the principle *Nothing is Deleted*, enforced at the protocol level.

## Part 3: See the Raw JSONL

The consent log is a plain append-only JSON-Lines file:

```bash
cat /tmp/consent-demo/ψ/consent/alpha_beta.jsonl
```

```json
{"type":"PROPOSE","from":"alpha","to":"beta","timestamp":"2026-04-16T03:35:38Z","proposal":{"childName":"alpha-beta-child","parents":["alpha","beta"],"initiatedBy":"nat"}}
{"type":"ACCEPT","from":"alpha","to":"beta","timestamp":"2026-04-16T03:35:48Z","rationale":"agreed"}
{"type":"ACCEPT","from":"beta","to":"alpha","timestamp":"2026-04-16T03:35:48Z","rationale":"agreed"}
{"type":"REVOKE","from":"alpha","to":"beta","timestamp":"2026-04-16T03:36:09Z","rationale":"changed-mind"}
```

**The file is the protocol.** Anyone can read it with `cat`, `grep`, or `jq`. No database, no daemon, no hidden state. Convention before machinery.

## Part 4: The REJECT Branch

REJECT halts the protocol until a new PROPOSE resets it.

```bash
# Fresh pair
maw fusion consent propose gamma delta --child gamma-delta-child
maw fusion consent reject gamma gamma delta --reason not-ready
maw fusion consent status gamma delta
```

```
  state:      rejected
  rejectedBy: [gamma]
```

To revive the conversation, issue a new PROPOSE:

```bash
maw fusion consent propose gamma delta --child gamma-delta-child-v2
maw fusion consent status gamma delta
```

```
  state:      proposed         ← reset
  acceptedBy: []
```

(The state machine sees the new PROPOSE and clears the accumulators.)

## Part 5: Scripting Gates

### Only merge if consent exists

```bash
if maw fusion consent check $A $B; then
  maw fusion $A --into $B
else
  echo "Cannot merge — run:"
  echo "  maw fusion consent propose $A $B --child <name>"
  echo "  maw fusion consent accept $A $A $B"
  echo "  maw fusion consent accept $B $A $B"
fi
```

### Machine-readable status

```bash
maw fusion consent status alpha beta --json
```

```json
{
  "state": "bilateral",
  "proposal": { "childName": "alpha-beta-child", "parents": ["alpha","beta"], "initiatedBy": "nat" },
  "events": [ ... ],
  "acceptedBy": ["alpha","beta"],
  "rejectedBy": [],
  "revokedBy": []
}
```

Pipe to `jq` for filtering:

```bash
maw fusion consent status alpha beta --json | jq -r '.state'
# bilateral
```

## Part 6: Bilateral Storage (Convention c17.6)

The current implementation writes the consent log to **the current oracle's own vault**. Per convention c17.6, each party should commit their own copy. Manual pattern:

```bash
# On alpha's oracle machine:
cd ~/Code/.../alpha-oracle
maw fusion consent propose alpha beta --child x --by nat
git add ψ/consent/alpha_beta.jsonl && git commit -m "propose fusion with beta"

# On beta's oracle machine:
cd ~/Code/.../beta-oracle
maw fusion consent propose alpha beta --child x --by nat   # mirrors
maw fusion consent accept beta alpha beta --reason agreed
git add ψ/consent/alpha_beta.jsonl && git commit -m "accept fusion with alpha"
```

Both vaults end up with consent logs. Divergence between copies is data, not a bug — the reconciliation happens via trace-links and the `from-{oracle}/` namespace, not by forcing a single canonical vault.

(Automation of bilateral writes is on the roadmap.)

## Part 7: Full Verb Reference

| Verb | Args | Description |
|------|------|-------------|
| `propose` | `<a> <b> --child <name> [--by <human>]` | Start the protocol |
| `accept` | `<who> <a> <b> [--reason <r>]` | Record ACCEPT by `<who>` |
| `reject` | `<who> <a> <b> [--reason <r>]` | Halt the protocol |
| `revoke` | `<who> <a> <b> [--reason <r>]` | Withdraw after bilateral |
| `status` | `<a> <b>` | Current state + counts |
| `check` | `<a> <b>` | Exit 0 if bilateral, 1 otherwise |
| `log` | `<a> <b>` | Print full event log |

All verbs accept `--json` for machine-readable output.

## Gotchas

- **`--reason` with spaces** — `maw` splits args on whitespace. Use `--reason changed-mind` or `--reason "quote-it"` and expect the first word only. Safer: omit the reason or use hyphenated forms.
- **Working directory matters** — the consent log is written to `$(pwd)/ψ/consent/`. Run from an oracle repo, or create `ψ/` first.
- **Pair key is sorted** — `propose alpha beta` and `propose beta alpha` both write to `alpha_beta.jsonl`. This is intentional: both sides resolve to the same log.

## What's Next

- **Layer 3: provisional.ts** — the PROVISIONAL-MERGE staging mechanism (c17.7).
- **Wire `hasConsent()` into `executeMerge()`** — make `maw fusion <a> --into <b>` refuse when consent is missing.
- **Bilateral write automation** — commit to both vaults with one command.

## See Also

- `consent.ts` — the implementation (237 LOC)
- `consent.test.ts` — 11 passing tests, 45 assertions
- `../README.md` — fusion plugin overview
- The Fusion Paper — `ψ/writing/2026-04-15/the-fusion-paper.md`

---

🤖 ตอบโดย fusion จาก Nat → fusion-oracle

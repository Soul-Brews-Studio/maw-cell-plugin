/**
 * Bilateral consent protocol for oracle fusion.
 *
 * Implements the ACCEPT primitive (check → score → accept) as an
 * append-only JSONL event log. Both parties must explicitly ACCEPT
 * before fusion proceeds. REVOKE is an event, not erasure —
 * Nothing is Deleted.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";

import type {
  ConsentEvent,
  ConsentState,
  ConsentStatus,
  FusionProposal,
} from "./types";

// ---------------------------------------------------------------------------
// Filesystem consent store
// ---------------------------------------------------------------------------

/**
 * Append-only JSONL store for consent events.
 *
 * Each oracle pair gets its own file at `{root}/consent/{pairKey}.jsonl`.
 * The pair key is alphabetically sorted so both sides resolve to the
 * same file regardless of who initiates.
 */
export class FsConsentStore {
  constructor(public readonly root: string) {}

  /** Alphabetically sorted pair key, e.g. "fusion_mawjs". */
  private pairKey(a: string, b: string): string {
    return [a, b].sort().join("_");
  }

  /** Path to the JSONL consent log for a pair. */
  private consentPath(a: string, b: string): string {
    return join(this.root, "consent", `${this.pairKey(a, b)}.jsonl`);
  }

  /** Append one event as a JSON line. Creates the file and directory if needed. */
  appendEvent(event: ConsentEvent): void {
    const path = this.consentPath(event.from, event.to);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(event) + "\n", "utf-8");
  }

  /** Read all events for a pair, oldest first. Returns [] if no log exists. */
  readEvents(from: string, to: string): ConsentEvent[] {
    const path = this.consentPath(from, to);
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf-8").trim();
    if (!raw) return [];
    return raw.split("\n").map((line) => JSON.parse(line) as ConsentEvent);
  }
}

// ---------------------------------------------------------------------------
// State machine — replay events to compute current consent state
// ---------------------------------------------------------------------------

/**
 * Replay a consent event log and compute the current state.
 *
 * State transitions:
 * - []                                → "none"
 * - [PROPOSE]                         → "proposed"
 * - [PROPOSE, ACCEPT(a)]              → "partial"
 * - [PROPOSE, ACCEPT(a), ACCEPT(b)]   → "bilateral"
 * - [PROPOSE, REJECT]                 → "rejected"
 * - [..., REVOKE]                     → "revoked"
 */
export function computeConsentState(events: ConsentEvent[]): ConsentStatus {
  const status: ConsentStatus = {
    state: "none",
    proposal: null,
    events,
    acceptedBy: [],
    rejectedBy: [],
    revokedBy: [],
  };

  for (const event of events) {
    switch (event.type) {
      case "PROPOSE":
        status.state = "proposed";
        status.proposal = event.proposal ?? null;
        status.acceptedBy = [];
        status.rejectedBy = [];
        status.revokedBy = [];
        break;

      case "ACCEPT":
        if (!status.acceptedBy.includes(event.from)) {
          status.acceptedBy.push(event.from);
        }
        if (status.proposal && status.acceptedBy.length >= 2) {
          status.state = "bilateral";
        } else {
          status.state = "partial";
        }
        break;

      case "REJECT":
        if (!status.rejectedBy.includes(event.from)) {
          status.rejectedBy.push(event.from);
        }
        status.state = "rejected";
        break;

      case "REVOKE":
        if (!status.revokedBy.includes(event.from)) {
          status.revokedBy.push(event.from);
        }
        status.state = "revoked";
        break;
    }
  }

  return status;
}

// ---------------------------------------------------------------------------
// Protocol functions — high-level API
// ---------------------------------------------------------------------------

/**
 * Propose a fusion between two oracles.
 *
 * Writes a PROPOSE event to the consent log. The `from` field is the
 * first parent in the proposal; both parents must still ACCEPT separately.
 */
export function proposeConsent(
  store: FsConsentStore,
  from: string,
  to: string,
  proposal: FusionProposal,
): ConsentEvent {
  const event: ConsentEvent = {
    type: "PROPOSE",
    from,
    to,
    timestamp: new Date().toISOString(),
    proposal,
  };
  store.appendEvent(event);
  return event;
}

/**
 * Record an oracle's acceptance of a pending fusion proposal.
 *
 * The `oracleName` is the oracle issuing the ACCEPT — it must be one of the
 * two parties in the pair. Bilateral consent requires both parties to ACCEPT.
 */
export function acceptConsent(
  store: FsConsentStore,
  oracleName: string,
  from: string,
  to: string,
  rationale?: string,
): ConsentEvent {
  const event: ConsentEvent = {
    type: "ACCEPT",
    from: oracleName,
    to: oracleName === from ? to : from,
    timestamp: new Date().toISOString(),
    rationale,
  };
  store.appendEvent(event);
  return event;
}

/**
 * Record an oracle's rejection of a pending fusion proposal.
 *
 * REJECT halts the protocol — no fusion can proceed until a new PROPOSE
 * resets the state.
 */
export function rejectConsent(
  store: FsConsentStore,
  oracleName: string,
  from: string,
  to: string,
  rationale?: string,
): ConsentEvent {
  const event: ConsentEvent = {
    type: "REJECT",
    from: oracleName,
    to: oracleName === from ? to : from,
    timestamp: new Date().toISOString(),
    rationale,
  };
  store.appendEvent(event);
  return event;
}

/**
 * Revoke previously granted consent.
 *
 * REVOKE is an event in the log, not erasure — Nothing is Deleted.
 * After REVOKE the state becomes "revoked" and fusion cannot proceed
 * until a new PROPOSE/ACCEPT cycle completes.
 */
export function revokeConsent(
  store: FsConsentStore,
  oracleName: string,
  from: string,
  to: string,
  rationale?: string,
): ConsentEvent {
  const event: ConsentEvent = {
    type: "REVOKE",
    from: oracleName,
    to: oracleName === from ? to : from,
    timestamp: new Date().toISOString(),
    rationale,
  };
  store.appendEvent(event);
  return event;
}

/**
 * Check whether bilateral consent exists for a pair.
 *
 * Returns `true` only if the current state is "bilateral" — both
 * parties have ACCEPT'd and no REJECT or REVOKE has occurred since.
 * This is the gate that `executeMerge` should check before proceeding.
 */
export function hasConsent(store: FsConsentStore, from: string, to: string): boolean {
  const events = store.readEvents(from, to);
  const status = computeConsentState(events);
  return status.state === "bilateral";
}

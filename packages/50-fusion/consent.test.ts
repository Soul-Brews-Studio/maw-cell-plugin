/**
 * Unit tests for the bilateral consent protocol.
 *
 * Each test asserts a falsifiable claim about `FsConsentStore`,
 * `computeConsentState`, `hasConsent`, `proposeConsent`, or `acceptConsent`.
 * Nothing is Deleted — append-only event log is the source of truth.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  FsConsentStore,
  acceptConsent,
  computeConsentState,
  hasConsent,
  proposeConsent,
} from "./consent";
import type { ConsentEvent, FusionProposal } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
function tmpVault(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `consent-${label}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function makeProposal(a = "oracle-a", b = "oracle-b"): FusionProposal {
  return { childName: "child-oracle", parents: [a, b], initiatedBy: "nat" };
}

function makeEvent(
  type: ConsentEvent["type"],
  from: string,
  to: string,
  extra: Partial<ConsentEvent> = {},
): ConsentEvent {
  return {
    type,
    from,
    to,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1. FsConsentStore — append + read round-trip
// ---------------------------------------------------------------------------

describe("FsConsentStore", () => {
  test("append + read round-trip — events persist to JSONL", () => {
    const dir = tmpVault("store-roundtrip");
    const store = new FsConsentStore(dir);
    const event = makeEvent("PROPOSE", "oracle-a", "oracle-b", {
      proposal: makeProposal(),
    });

    store.appendEvent(event);
    const events = store.readEvents("oracle-a", "oracle-b");

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("PROPOSE");
    expect(events[0].from).toBe("oracle-a");
    expect(events[0].to).toBe("oracle-b");
    expect(events[0].proposal).toBeDefined();
    expect(events[0].proposal!.childName).toBe("child-oracle");
  });

  test("readEvents returns empty array for unknown pair", () => {
    const dir = tmpVault("store-empty");
    const store = new FsConsentStore(dir);

    const events = store.readEvents("nonexistent-a", "nonexistent-b");
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. computeConsentState — state machine
// ---------------------------------------------------------------------------

describe("computeConsentState", () => {
  test("empty events → state 'none'", () => {
    const status = computeConsentState([]);
    expect(status.state).toBe("none");
    expect(status.proposal).toBeNull();
    expect(status.events).toEqual([]);
    expect(status.acceptedBy).toEqual([]);
    expect(status.rejectedBy).toEqual([]);
    expect(status.revokedBy).toEqual([]);
  });

  test("PROPOSE only → state 'proposed'", () => {
    const events: ConsentEvent[] = [
      makeEvent("PROPOSE", "oracle-a", "oracle-b", {
        proposal: makeProposal(),
      }),
    ];
    const status = computeConsentState(events);
    expect(status.state).toBe("proposed");
    expect(status.proposal).not.toBeNull();
    expect(status.proposal!.childName).toBe("child-oracle");
    expect(status.acceptedBy).toEqual([]);
  });

  test("PROPOSE + one ACCEPT → state 'partial'", () => {
    const events: ConsentEvent[] = [
      makeEvent("PROPOSE", "oracle-a", "oracle-b", {
        proposal: makeProposal(),
      }),
      makeEvent("ACCEPT", "oracle-a", "oracle-b"),
    ];
    const status = computeConsentState(events);
    expect(status.state).toBe("partial");
    expect(status.acceptedBy).toEqual(["oracle-a"]);
  });

  test("PROPOSE + both ACCEPT → state 'bilateral'", () => {
    const events: ConsentEvent[] = [
      makeEvent("PROPOSE", "oracle-a", "oracle-b", {
        proposal: makeProposal(),
      }),
      makeEvent("ACCEPT", "oracle-a", "oracle-b"),
      makeEvent("ACCEPT", "oracle-b", "oracle-a"),
    ];
    const status = computeConsentState(events);
    expect(status.state).toBe("bilateral");
    expect(status.acceptedBy).toContain("oracle-a");
    expect(status.acceptedBy).toContain("oracle-b");
    expect(status.acceptedBy).toHaveLength(2);
  });

  test("REJECT by either party → state 'rejected'", () => {
    const events: ConsentEvent[] = [
      makeEvent("PROPOSE", "oracle-a", "oracle-b", {
        proposal: makeProposal(),
      }),
      makeEvent("REJECT", "oracle-b", "oracle-a", {
        rationale: "not ready",
      }),
    ];
    const status = computeConsentState(events);
    expect(status.state).toBe("rejected");
    expect(status.rejectedBy).toContain("oracle-b");
  });

  test("REVOKE after bilateral → state 'revoked', Nothing is Deleted", () => {
    const events: ConsentEvent[] = [
      makeEvent("PROPOSE", "oracle-a", "oracle-b", {
        proposal: makeProposal(),
      }),
      makeEvent("ACCEPT", "oracle-a", "oracle-b"),
      makeEvent("ACCEPT", "oracle-b", "oracle-a"),
      makeEvent("REVOKE", "oracle-a", "oracle-b", {
        rationale: "changed mind",
      }),
    ];
    const status = computeConsentState(events);
    expect(status.state).toBe("revoked");
    expect(status.revokedBy).toContain("oracle-a");
    // CRITICAL: Nothing is Deleted — all original events still in the log
    expect(status.events).toHaveLength(4);
    expect(status.events[0].type).toBe("PROPOSE");
    expect(status.events[1].type).toBe("ACCEPT");
    expect(status.events[2].type).toBe("ACCEPT");
    expect(status.events[3].type).toBe("REVOKE");
  });
});

// ---------------------------------------------------------------------------
// 3. hasConsent — bilateral gate
// ---------------------------------------------------------------------------

describe("hasConsent", () => {
  test("returns true only when bilateral", () => {
    const dir = tmpVault("has-consent");
    const store = new FsConsentStore(dir);

    // none → false
    expect(hasConsent(store, "oracle-a", "oracle-b")).toBe(false);

    // proposed → false
    proposeConsent(store, "oracle-a", "oracle-b", makeProposal());
    expect(hasConsent(store, "oracle-a", "oracle-b")).toBe(false);

    // partial → false
    acceptConsent(store, "oracle-a", "oracle-a", "oracle-b");
    expect(hasConsent(store, "oracle-a", "oracle-b")).toBe(false);

    // bilateral → true
    acceptConsent(store, "oracle-b", "oracle-a", "oracle-b");
    expect(hasConsent(store, "oracle-a", "oracle-b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Protocol functions — full flow
// ---------------------------------------------------------------------------

describe("protocol functions", () => {
  test("full flow: propose → accept → accept → hasConsent true", () => {
    const dir = tmpVault("full-flow");
    const store = new FsConsentStore(dir);
    const proposal = makeProposal();

    proposeConsent(store, "oracle-a", "oracle-b", proposal);
    acceptConsent(store, "oracle-a", "oracle-a", "oracle-b");
    acceptConsent(store, "oracle-b", "oracle-a", "oracle-b");

    expect(hasConsent(store, "oracle-a", "oracle-b")).toBe(true);

    const events = store.readEvents("oracle-a", "oracle-b");
    const status = computeConsentState(events);
    expect(status.state).toBe("bilateral");
    expect(status.acceptedBy).toHaveLength(2);
  });

  test("proposeConsent creates event with proposal payload", () => {
    const dir = tmpVault("propose-payload");
    const store = new FsConsentStore(dir);
    const proposal = makeProposal("alpha", "beta");

    proposeConsent(store, "alpha", "beta", proposal);

    const events = store.readEvents("alpha", "beta");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("PROPOSE");
    expect(events[0].proposal).toBeDefined();
    expect(events[0].proposal!.childName).toBe("child-oracle");
    expect(events[0].proposal!.parents).toEqual(["alpha", "beta"]);
    expect(events[0].proposal!.initiatedBy).toBe("nat");
  });
});

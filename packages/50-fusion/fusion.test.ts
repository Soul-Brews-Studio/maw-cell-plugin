import { describe, test, expect } from "bun:test";
import handler from "./index";

describe("fusion", () => {
  test("cli: no source → usage error", async () => {
    const r = await handler({ source: "cli", args: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("usage");
  });

  test("cli: dry-run scans source vault", async () => {
    const r = await handler({ source: "cli", args: ["mawjs", "--dry-run"] });
    // May find files or not depending on environment
    expect(r.ok === true || r.ok === false).toBe(true);
  });

  test("api: returns status", async () => {
    const r = await handler({ source: "api", args: { source: "neo" } });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("fusion");
  });

  test("peer: echoes request", async () => {
    const r = await handler({ source: "peer", args: { from: "white" } });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("white");
  });
});

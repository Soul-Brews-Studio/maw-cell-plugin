import { describe, expect, test } from "bun:test";
import { run, runSafe, runJson, ghqRoot, ghqListFullPath } from "./shell";

describe("run", () => {
  test("returns stdout for successful command", () => {
    expect(run("echo hello")).toBe("hello");
  });
  test("throws on non-zero exit", () => {
    expect(() => run("false")).toThrow();
  });
});

describe("runSafe", () => {
  test("returns stdout on success", () => {
    expect(runSafe("echo ok")).toBe("ok");
  });
  test("returns empty string on failure", () => {
    expect(runSafe("false")).toBe("");
  });
});

describe("runJson", () => {
  test("parses JSON stdout", () => {
    const result = runJson<{ a: number }>('echo \'{"a":1}\'');
    expect(result.a).toBe(1);
  });
});

describe("ghqRoot", () => {
  test("returns a non-empty path", () => {
    expect(ghqRoot().length).toBeGreaterThan(0);
  });
});

describe("ghqListFullPath", () => {
  test("finds repos matching pattern", () => {
    const results = ghqListFullPath("maw-cell-plugin");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toContain("maw-cell-plugin");
  });
  test("returns empty for non-matching pattern", () => {
    expect(ghqListFullPath("surely-no-repo-matches-this-xyz")).toEqual([]);
  });
});

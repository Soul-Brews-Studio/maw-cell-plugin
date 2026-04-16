/**
 * Unit tests for the shared provider module.
 *
 * Each test asserts a falsifiable claim about parseProvider,
 * providerRepoPath, ghqCloneUri, or cliAvailable.
 */

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PROVIDER,
  KNOWN_PROVIDERS,
  PROVIDER_CLI,
  cliAvailable,
  ghqCloneUri,
  parseProvider,
  providerRepoPath,
} from "./provider";

// ---------------------------------------------------------------------------
// parseProvider
// ---------------------------------------------------------------------------

describe("parseProvider", () => {
  test("undefined → github.com (backward compat)", () => {
    expect(parseProvider(undefined)).toBe("github.com");
    expect(parseProvider()).toBe("github.com");
  });

  test("full names pass through unchanged", () => {
    expect(parseProvider("github.com")).toBe("github.com");
    expect(parseProvider("gitlab.com")).toBe("gitlab.com");
    expect(parseProvider("codeberg.org")).toBe("codeberg.org");
  });

  test("case insensitive", () => {
    expect(parseProvider("GitHub.com")).toBe("github.com");
    expect(parseProvider("GITLAB.COM")).toBe("gitlab.com");
    expect(parseProvider("Codeberg.Org")).toBe("codeberg.org");
  });

  test("short aliases resolve correctly", () => {
    expect(parseProvider("github")).toBe("github.com");
    expect(parseProvider("gh")).toBe("github.com");
    expect(parseProvider("gitlab")).toBe("gitlab.com");
    expect(parseProvider("gl")).toBe("gitlab.com");
    expect(parseProvider("codeberg")).toBe("codeberg.org");
    expect(parseProvider("cb")).toBe("codeberg.org");
  });

  test("unknown provider throws with helpful message", () => {
    expect(() => parseProvider("bitbucket")).toThrow("unknown provider");
    expect(() => parseProvider("sourcehut")).toThrow("unknown provider");
    expect(() => parseProvider("random")).toThrow("supported:");
  });
});

// ---------------------------------------------------------------------------
// providerRepoPath
// ---------------------------------------------------------------------------

describe("providerRepoPath", () => {
  test("constructs {ghqRoot}/{provider}/{org}/{repo}", () => {
    expect(providerRepoPath("/home/neo/Code", "github.com", "Soul-Brews-Studio", "maw-js"))
      .toBe("/home/neo/Code/github.com/Soul-Brews-Studio/maw-js");
  });

  test("works for all providers", () => {
    expect(providerRepoPath("/r", "gitlab.com", "org", "repo"))
      .toBe("/r/gitlab.com/org/repo");
    expect(providerRepoPath("/r", "codeberg.org", "user", "repo"))
      .toBe("/r/codeberg.org/user/repo");
  });
});

// ---------------------------------------------------------------------------
// ghqCloneUri
// ---------------------------------------------------------------------------

describe("ghqCloneUri", () => {
  test("prepends provider to slug", () => {
    expect(ghqCloneUri("github.com", "org/repo")).toBe("github.com/org/repo");
    expect(ghqCloneUri("gitlab.com", "group/project")).toBe("gitlab.com/group/project");
    expect(ghqCloneUri("codeberg.org", "user/repo")).toBe("codeberg.org/user/repo");
  });
});

// ---------------------------------------------------------------------------
// cliAvailable
// ---------------------------------------------------------------------------

describe("cliAvailable", () => {
  test("returns true for installed tools", () => {
    // bun is definitely available since we're running tests with it
    expect(cliAvailable("bun")).toBe(true);
  });

  test("returns false for non-existent tools", () => {
    expect(cliAvailable("surely-this-tool-does-not-exist-xyz-42")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  test("DEFAULT_PROVIDER is github.com", () => {
    expect(DEFAULT_PROVIDER).toBe("github.com");
  });

  test("KNOWN_PROVIDERS has 3 entries", () => {
    expect(KNOWN_PROVIDERS).toHaveLength(3);
    expect(KNOWN_PROVIDERS).toContain("github.com");
    expect(KNOWN_PROVIDERS).toContain("gitlab.com");
    expect(KNOWN_PROVIDERS).toContain("codeberg.org");
  });

  test("every provider has a CLI tool mapping", () => {
    for (const p of KNOWN_PROVIDERS) {
      expect(PROVIDER_CLI[p]).toBeDefined();
      expect(typeof PROVIDER_CLI[p]).toBe("string");
    }
  });
});

/**
 * Provider utilities for multi-forge support.
 *
 * Shared module used by both bud and fusion plugins.
 * Supports GitHub, GitLab, and Codeberg — matches ghq's
 * directory layout: `{provider}/{org}/{repo}`.
 */

import { execSync } from "child_process";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Known forge providers — matches ghq's directory layout. */
export type ForgeProvider = "github.com" | "gitlab.com" | "codeberg.org";

/** All supported providers. */
export const KNOWN_PROVIDERS: readonly ForgeProvider[] = [
  "github.com",
  "gitlab.com",
  "codeberg.org",
] as const;

/** Default when no provider is specified — backward compatibility. */
export const DEFAULT_PROVIDER: ForgeProvider = "github.com";

/** CLI tool name for each provider. */
export const PROVIDER_CLI: Record<ForgeProvider, string> = {
  "github.com": "gh",
  "gitlab.com": "glab",
  "codeberg.org": "tea",
};

/** Install URLs for provider CLIs. */
export const PROVIDER_INSTALL: Record<ForgeProvider, string> = {
  "github.com": "https://cli.github.com/",
  "gitlab.com": "https://gitlab.com/gitlab-org/cli#installation",
  "codeberg.org": "https://gitea.com/gitea/tea#installation",
};

// ---------------------------------------------------------------------------
// Provider adapter interface (implemented in Phase 4)
// ---------------------------------------------------------------------------

/** Provider adapter — abstraction over gh/glab/tea. */
export interface ProviderAdapter {
  readonly provider: ForgeProvider;
  readonly cliName: string;
  /** Check if the CLI tool is installed. */
  isAvailable(): boolean;
  /** Check if a repo exists on the remote. */
  repoExists(slug: string): boolean;
  /** Create a new private repo. */
  createRepo(slug: string): void;
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/** Short aliases for convenience. */
const ALIASES: Record<string, ForgeProvider> = {
  github: "github.com",
  gh: "github.com",
  gitlab: "gitlab.com",
  gl: "gitlab.com",
  codeberg: "codeberg.org",
  cb: "codeberg.org",
};

/**
 * Parse a provider string, defaulting to github.com.
 *
 * Accepts full names ("github.com"), short aliases ("gitlab", "gh", "cb"),
 * or undefined (returns DEFAULT_PROVIDER for backward compat).
 *
 * @throws Error if the input is not a recognized provider.
 */
export function parseProvider(input?: string): ForgeProvider {
  if (!input) return DEFAULT_PROVIDER;

  const lower = input.toLowerCase();

  // Exact match
  if (KNOWN_PROVIDERS.includes(lower as ForgeProvider)) {
    return lower as ForgeProvider;
  }

  // Alias match
  if (lower in ALIASES) {
    return ALIASES[lower];
  }

  throw new Error(
    `unknown provider: "${input}"\n` +
    `  supported: ${KNOWN_PROVIDERS.join(", ")}\n` +
    `  aliases:   github/gh, gitlab/gl, codeberg/cb`,
  );
}

/**
 * Resolve the filesystem path for a provider/org/repo under ghq root.
 *
 * Returns: `{ghqRoot}/{provider}/{org}/{repo}`
 */
export function providerRepoPath(
  ghqRoot: string,
  provider: ForgeProvider,
  org: string,
  repo: string,
): string {
  return join(ghqRoot, provider, org, repo);
}

/**
 * Build the ghq clone URI for a provider + slug.
 *
 * Returns e.g. "github.com/org/repo" — ghq natively understands
 * github.com, gitlab.com, and codeberg.org prefixes.
 */
export function ghqCloneUri(provider: ForgeProvider, slug: string): string {
  return `${provider}/${slug}`;
}

/**
 * Check if a CLI tool is available on PATH.
 */
export function cliAvailable(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Require a provider's CLI to be available, or throw with install URL.
 */
export function requireCli(provider: ForgeProvider): void {
  const cli = PROVIDER_CLI[provider];
  if (!cliAvailable(cli)) {
    throw new Error(
      `provider "${provider}" requires CLI "${cli}" which is not installed.\n` +
      `  install: ${PROVIDER_INSTALL[provider]}`,
    );
  }
}

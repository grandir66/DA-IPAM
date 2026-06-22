import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { resolveEnvSecretsPath } from "@/lib/env-secrets";

const ALLOWED = new Set(["main", "master", "dev"]);

/** Branch git effettivo se repo presente. */
export function getGitBranch(cwd = process.cwd()): string | null {
  try {
    if (!fs.existsSync(path.join(cwd, ".git"))) return null;
    const out = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    return ALLOWED.has(out) || /^[a-z][a-z0-9_\-/]*$/i.test(out) ? out : null;
  } catch {
    return null;
  }
}

function readBranchFromEnvFile(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*DA_INVENT_BRANCH\s*=\s*(.+?)\s*$/);
      if (m?.[1]) {
        const v = m[1].replace(/^["']|["']$/g, "").trim();
        if (v) return v;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Branch usato per confronto versione remota e auto-update.
 * Ordine: git HEAD → DA_INVENT_BRANCH (process.env) → .env.local → main.
 */
export function getConfiguredUpdateBranch(cwd = process.cwd()): string {
  const git = getGitBranch(cwd);
  if (git) return git;

  const fromEnv = process.env.DA_INVENT_BRANCH?.trim();
  if (fromEnv && ALLOWED.has(fromEnv)) return fromEnv;

  const secrets = resolveEnvSecretsPath();
  const fromFile = readBranchFromEnvFile(secrets);
  if (fromFile && ALLOWED.has(fromFile)) return fromFile;

  const cwdEnv = path.join(cwd, ".env.local");
  const fromCwd = readBranchFromEnvFile(cwdEnv);
  if (fromCwd && ALLOWED.has(fromCwd)) return fromCwd;

  return "main";
}

export function isGitUpdateSupported(cwd = process.cwd()): boolean {
  return fs.existsSync(path.join(cwd, ".git"));
}

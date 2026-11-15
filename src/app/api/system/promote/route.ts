/**
 * Rilascio dev → main (DA-IPAM): qui resta solo l'anteprima.
 *
 *   GET    — anteprima: commit di `dev` non ancora in `main`
 *   DELETE — toglie il gettone GitHub rimasto salvato (superadmin)
 *   POST, PUT — tolti (410)
 *
 * Analisi del 15/11/2026 (Riccardo: «Dal Mac, firmato»): un push su `main` è un rilascio a tutte le appliance dei
 * clienti. Prima lo faceva questa rotta, con un gettone GitHub custodito qui: chi prendeva questa installazione
 * rilasciava. Ora il rilascio è un commit firmato fatto dal Mac con `scripts/rilascia-main.sh`, e le appliance
 * controllano la firma (`scripts/lib/guardia-firma.sh`). Il gettone non serve più: va tolto e revocato su GitHub.
 */
import { NextResponse } from "next/server";
import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireAdmin, requireSuperAdmin, isAuthError } from "@/lib/api-auth";
import { getSetting, setSetting } from "@/lib/db-hub";

const execFile = promisify(_execFile);

const APP_DIR = process.env.DA_INVENT_DIR ?? process.cwd();
const PAT_KEY = "system_github_pat_encrypted";

async function git(args: string[], extraEnv: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; ok: boolean; code: number }> {
  try {
    const r = await execFile("git", ["-C", APP_DIR, ...args], {
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, ...extraEnv, GIT_TERMINAL_PROMPT: "0" },
    });
    return { stdout: r.stdout, stderr: r.stderr, ok: true, code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", ok: false, code: err.code ?? 1 };
  }
}

async function getRemoteUrl(): Promise<string | null> {
  const r = await git(["remote", "get-url", "origin"]);
  return r.ok ? r.stdout.trim() : null;
}

interface PromotePreview {
  base: string | null;         // sha base (merge-base main..dev)
  mainSha: string | null;
  devSha: string | null;
  commitsAhead: number;        // commit di dev non in main
  commits: Array<{ sha: string; subject: string; author: string; date: string }>;
  remoteUrl: string | null;
  patConfigured: boolean;
}

async function buildPreview(): Promise<PromotePreview> {
  await git(["fetch", "--quiet", "origin", "main", "dev"]);
  const mainSha = (await git(["rev-parse", "origin/main"])).stdout.trim() || null;
  const devSha  = (await git(["rev-parse", "origin/dev"])).stdout.trim() || null;
  const base    = (await git(["merge-base", "origin/main", "origin/dev"])).stdout.trim() || null;
  const logRes  = await git(["log", "--pretty=%H%x09%an%x09%aI%x09%s", "origin/main..origin/dev"]);
  const commits = logRes.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [sha, author, date, ...rest] = l.split("\t");
      return { sha: sha.slice(0, 12), subject: rest.join("\t"), author, date };
    });
  return {
    base,
    mainSha,
    devSha,
    commitsAhead: commits.length,
    commits,
    remoteUrl: await getRemoteUrl(),
    patConfigured: !!getSetting(PAT_KEY),
  };
}

export async function GET() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  try {
    return NextResponse.json(await buildPreview());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const TOLTO = "Il rilascio su main non si fa più da qui: è un commit firmato, dal Mac, con scripts/rilascia-main.sh";

export async function POST() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return NextResponse.json({ error: TOLTO }, { status: 410 });
}

export async function PUT() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return NextResponse.json({ error: TOLTO }, { status: 410 });
}

/** Toglie il gettone GitHub rimasto salvato da prima. Va anche revocato su GitHub: qui si cancella solo la copia. */
export async function DELETE() {
  const adminCheck = await requireSuperAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  setSetting(PAT_KEY, "");
  return NextResponse.json({ ok: true, patConfigured: false });
}

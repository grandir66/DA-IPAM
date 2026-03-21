/**
 * API System Update - Controlla e applica aggiornamenti da GitHub
 * GET: Controlla se ci sono aggiornamenti disponibili
 * POST: Scarica e applica l'aggiornamento
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { execSync, spawn } from "child_process";
import path from "path";
import fs from "fs";

const REPO_URL = "https://github.com/grandir66/DA-IPAM.git";
const REPO_API_URL = "https://api.github.com/repos/grandir66/DA-IPAM";

interface UpdateInfo {
  currentVersion: string;
  remoteVersion: string | null;
  updateAvailable: boolean;
  lastCheck: string;
  changelog?: string[];
  error?: string;
}

interface UpdateStatus {
  status: "idle" | "checking" | "downloading" | "installing" | "restarting" | "completed" | "error";
  message: string;
  progress?: number;
  error?: string;
}

function getProjectRoot(): string {
  return process.cwd();
}

function getCurrentVersion(): string {
  try {
    const pkgPath = path.join(getProjectRoot(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function getRemoteVersion(): Promise<{ version: string; changelog: string[] } | null> {
  try {
    const response = await fetch(`${REPO_API_URL}/contents/package.json?ref=main`, {
      headers: {
        "Accept": "application/vnd.github.v3.raw",
        "User-Agent": "DA-IPAM-Updater",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("[Update] Failed to fetch remote package.json:", response.status);
      return null;
    }

    const content = await response.text();
    const pkg = JSON.parse(content);
    const version = pkg.version || "0.0.0";

    const changelog: string[] = [];
    try {
      const commitsRes = await fetch(`${REPO_API_URL}/commits?per_page=10`, {
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "DA-IPAM-Updater",
        },
        cache: "no-store",
      });
      if (commitsRes.ok) {
        const commits = await commitsRes.json();
        for (const commit of commits.slice(0, 5)) {
          const msg = commit.commit?.message?.split("\n")[0] || "";
          if (msg) changelog.push(msg);
        }
      }
    } catch { /* ignore changelog errors */ }

    return { version, changelog };
  } catch (error) {
    console.error("[Update] Error fetching remote version:", error);
    return null;
  }
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split(".").map(Number);
  const parts2 = v2.split(".").map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

function checkGitStatus(): { clean: boolean; branch: string; error?: string } {
  try {
    const root = getProjectRoot();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: root, encoding: "utf-8" }).trim();
    const status = execSync("git status --porcelain", { cwd: root, encoding: "utf-8" }).trim();
    return { clean: status === "", branch };
  } catch (error) {
    return { clean: false, branch: "unknown", error: String(error) };
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "status") {
    const gitStatus = checkGitStatus();
    return NextResponse.json({
      currentVersion: getCurrentVersion(),
      gitBranch: gitStatus.branch,
      gitClean: gitStatus.clean,
      projectRoot: getProjectRoot(),
    });
  }

  try {
    const currentVersion = getCurrentVersion();
    const remote = await getRemoteVersion();

    if (!remote) {
      return NextResponse.json({
        currentVersion,
        remoteVersion: null,
        updateAvailable: false,
        lastCheck: new Date().toISOString(),
        error: "Impossibile contattare il repository remoto",
      } satisfies UpdateInfo);
    }

    const updateAvailable = compareVersions(remote.version, currentVersion) > 0;

    return NextResponse.json({
      currentVersion,
      remoteVersion: remote.version,
      updateAvailable,
      lastCheck: new Date().toISOString(),
      changelog: remote.changelog,
    } satisfies UpdateInfo);
  } catch (error) {
    return NextResponse.json({
      currentVersion: getCurrentVersion(),
      remoteVersion: null,
      updateAvailable: false,
      lastCheck: new Date().toISOString(),
      error: `Errore nel controllo aggiornamenti: ${error instanceof Error ? error.message : String(error)}`,
    } satisfies UpdateInfo);
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin();
  if (isAuthError(authResult)) return authResult;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "check") {
    const remote = await getRemoteVersion();
    const currentVersion = getCurrentVersion();
    
    if (!remote) {
      return NextResponse.json({ error: "Impossibile contattare il repository" }, { status: 503 });
    }

    return NextResponse.json({
      currentVersion,
      remoteVersion: remote.version,
      updateAvailable: compareVersions(remote.version, currentVersion) > 0,
      changelog: remote.changelog,
    });
  }

  if (action === "apply") {
    const gitStatus = checkGitStatus();
    
    if (!gitStatus.clean) {
      return NextResponse.json({
        error: "Ci sono modifiche locali non committate. Esegui commit o stash prima di aggiornare.",
        status: "error" as const,
      }, { status: 400 });
    }

    if (gitStatus.branch !== "main" && gitStatus.branch !== "master") {
      return NextResponse.json({
        error: `Sei sul branch "${gitStatus.branch}". Passa al branch main/master per aggiornare.`,
        status: "error" as const,
      }, { status: 400 });
    }

    try {
      const root = getProjectRoot();
      const steps: UpdateStatus[] = [];

      steps.push({ status: "downloading", message: "Scaricamento aggiornamenti da GitHub...", progress: 10 });
      execSync("git fetch origin main", { cwd: root, encoding: "utf-8", timeout: 60000 });

      steps.push({ status: "downloading", message: "Applicazione modifiche...", progress: 30 });
      execSync("git pull origin main --ff-only", { cwd: root, encoding: "utf-8", timeout: 120000 });

      steps.push({ status: "installing", message: "Installazione dipendenze...", progress: 50 });
      execSync("npm install --production=false", { cwd: root, encoding: "utf-8", timeout: 300000 });

      steps.push({ status: "installing", message: "Build applicazione...", progress: 70 });
      execSync("npm run build", { cwd: root, encoding: "utf-8", timeout: 600000 });

      const newVersion = getCurrentVersion();

      return NextResponse.json({
        status: "completed" as const,
        message: `Aggiornamento completato alla versione ${newVersion}. Riavvia l'applicazione per applicare le modifiche.`,
        newVersion,
        requiresRestart: true,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[Update] Error applying update:", errorMsg);

      try {
        execSync("git reset --hard HEAD~1", { cwd: getProjectRoot(), encoding: "utf-8" });
      } catch { /* ignore rollback errors */ }

      return NextResponse.json({
        status: "error" as const,
        error: `Errore durante l'aggiornamento: ${errorMsg}`,
        message: "L'aggiornamento è stato annullato. Il sistema è stato ripristinato.",
      }, { status: 500 });
    }
  }

  if (action === "restart") {
    try {
      setTimeout(() => {
        process.exit(0);
      }, 1000);

      return NextResponse.json({
        status: "restarting" as const,
        message: "Il server si sta riavviando...",
      });
    } catch (error) {
      return NextResponse.json({
        error: `Errore durante il riavvio: ${error instanceof Error ? error.message : String(error)}`,
      }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Azione non supportata" }, { status: 400 });
}

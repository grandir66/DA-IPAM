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

const REPO_API_URL = "https://api.github.com/repos/grandir66/DA-IPAM";
/** Fallback senza API GitHub (evita rate limit 403 e problemi di rete verso api.github.com) */
const RAW_PACKAGE_JSON_URL = "https://raw.githubusercontent.com/grandir66/DA-IPAM/main/package.json";

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
  const changelog: string[] = [];
  let version: string | null = null;

  const parsePkg = (text: string): string => {
    const pkg = JSON.parse(text) as { version?: string };
    return pkg.version || "0.0.0";
  };

  // 1) raw.githubusercontent.com — di solito non è soggetto al rate limit dell'API REST
  try {
    const rawRes = await fetch(RAW_PACKAGE_JSON_URL, {
      headers: { "User-Agent": "DA-IPAM-Updater" },
      cache: "no-store",
    });
    if (rawRes.ok) {
      version = parsePkg(await rawRes.text());
    }
  } catch (e) {
    console.warn("[Update] Raw package.json fetch failed:", e);
  }

  // 2) API GitHub contents (stesso file, utile se raw è bloccato e API no)
  if (!version) {
    try {
      const response = await fetch(`${REPO_API_URL}/contents/package.json?ref=main`, {
        headers: {
          Accept: "application/vnd.github.v3.raw",
          "User-Agent": "DA-IPAM-Updater",
        },
        cache: "no-store",
      });
      if (response.ok) {
        version = parsePkg(await response.text());
      } else {
        console.error("[Update] GitHub API package.json:", response.status);
      }
    } catch (e) {
      console.error("[Update] GitHub API package.json error:", e);
    }
  }

  // 3) Git locale: utile su server (es. LAN) dove firewall/proxy bloccano HTTPS verso github.com
  // ma git fetch verso lo stesso remote funziona, oppure refs già presenti dopo un pull manuale.
  if (!version) {
    const fromGit = getRemoteVersionFromGit();
    if (fromGit) {
      return fromGit;
    }
    return null;
  }

  try {
    const commitsRes = await fetch(`${REPO_API_URL}/commits?per_page=10`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
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
  } catch {
    /* changelog opzionale */
  }

  return { version, changelog };
}

/**
 * Legge package.json dal branch remoto tracciato (dopo git fetch). Nessuna chiamata HTTP a GitHub.
 */
function getRemoteVersionFromGit(): { version: string; changelog: string[] } | null {
  const root = getProjectRoot();
  if (!fs.existsSync(path.join(root, ".git"))) {
    return null;
  }
  const changelog: string[] = [];
  try {
    execSync("git fetch origin --prune", {
      cwd: root,
      encoding: "utf-8",
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    console.warn("[Update] git fetch origin fallito (si prova comunque con ref già presenti):", e);
  }
  const refs = ["origin/main", "origin/master"];
  for (const ref of refs) {
    try {
      const json = execSync(`git show ${ref}:package.json`, {
        cwd: root,
        encoding: "utf-8",
        timeout: 20000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const pkg = JSON.parse(json) as { version?: string };
      const v = pkg.version || "0.0.0";
      return { version: v, changelog };
    } catch {
      /* prova ref successiva */
    }
  }
  return null;
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

function listDirtyFiles(root: string): string[] {
  const parts: string[] = [];
  for (const cmd of [
    "git diff --name-only",
    "git diff --cached --name-only",
    "git ls-files --others --exclude-standard",
  ]) {
    try {
      const o = execSync(cmd, { cwd: root, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
      parts.push(...o.trim().split("\n").filter(Boolean));
    } catch {
      /* ignore */
    }
  }
  return [...new Set(parts)].sort();
}

/**
 * Ripristina file gestiti da Git che possono essere stati modificati localmente
 * da npm install (package-lock.json) o version:bump (package.json, VERSION).
 * Restituisce true se dopo il ripristino il working tree è pulito.
 */
function tryRestoreKnownDirtyFiles(root: string): boolean {
  const dirty = listDirtyFiles(root);
  const autoRestoreable = new Set(["package-lock.json", "package.json", "VERSION"]);
  const allKnown = dirty.every((f) => autoRestoreable.has(f));
  if (!allKnown || dirty.length === 0) return false;
  for (const file of dirty) {
    try {
      execSync(`git restore --source=HEAD --staged --worktree ${file}`, {
        cwd: root,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      try {
        execSync(`git checkout HEAD -- ${file}`, { cwd: root, encoding: "utf-8" });
      } catch {
        return false;
      }
    }
  }
  return true;
}

function getGitStatus(): { clean: boolean; branch: string; dirtyFiles: string[]; error?: string } {
  try {
    const root = getProjectRoot();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: root, encoding: "utf-8" }).trim();
    const dirtyFiles = listDirtyFiles(root);
    return { clean: dirtyFiles.length === 0, branch, dirtyFiles };
  } catch (error) {
    return { clean: false, branch: "unknown", dirtyFiles: [], error: String(error) };
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "status") {
    const gitStatus = getGitStatus();
    return NextResponse.json({
      currentVersion: getCurrentVersion(),
      gitBranch: gitStatus.branch,
      gitClean: gitStatus.clean,
      dirtyFiles: gitStatus.dirtyFiles,
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
        error:
          "Impossibile leggere la versione remota (HTTPS GitHub e git locale). " +
          "Serve accesso in uscita a github.com oppure una cartella installazione con .git e remote origin; " +
          "altrimenti usa «Aggiorna da Git» o ./scripts/update.sh sul server.",
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
    const root = getProjectRoot();
    let gitStatus = getGitStatus();
    if (!gitStatus.clean) {
      if (tryRestoreKnownDirtyFiles(root)) {
        gitStatus = getGitStatus();
      }
    }

    if (!gitStatus.clean) {
      const fileList = gitStatus.dirtyFiles.slice(0, 15).join(", ");
      const more = gitStatus.dirtyFiles.length > 15 ? ` (+${gitStatus.dirtyFiles.length - 15} altri)` : "";
      return NextResponse.json({
        error:
          "Ci sono modifiche locali non committate. Esegui sul server (come root): git status, poi git stash, oppure git restore <file>, oppure elimina i file non tracciati se sicuro.",
        dirtyFiles: gitStatus.dirtyFiles,
        detail: `File modificati: ${fileList}${more}`,
        status: "error" as const,
      }, { status: 400 });
    }

    if (gitStatus.branch !== "main" && gitStatus.branch !== "master") {
      return NextResponse.json({
        error: `Sei sul branch "${gitStatus.branch}". Passa al branch main/master per aggiornare.`,
        status: "error" as const,
      }, { status: 400 });
    }

    // Salva il commit corrente per rollback sicuro
    let previousCommit: string | null = null;
    try {
      previousCommit = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8", timeout: 10000 }).trim();
    } catch {
      /* se non riesce, rollback non sarà possibile */
    }

    // Backup della directory .next per poter ripristinare in caso di fallimento build
    const nextDir = path.join(root, ".next");
    const nextBackup = path.join(root, ".next.bak");
    let hasNextBackup = false;
    try {
      if (fs.existsSync(nextDir)) {
        // Rimuovi backup precedente se esiste
        if (fs.existsSync(nextBackup)) {
          fs.rmSync(nextBackup, { recursive: true, force: true });
        }
        fs.renameSync(nextDir, nextBackup);
        hasNextBackup = true;
        console.log("[Update] Backup .next → .next.bak completato");
      }
    } catch (e) {
      console.warn("[Update] Impossibile creare backup .next:", e);
    }

    try {
      const steps: UpdateStatus[] = [];

      steps.push({ status: "downloading", message: "Scaricamento aggiornamenti da GitHub...", progress: 10 });
      execSync("git fetch origin main", { cwd: root, encoding: "utf-8", timeout: 60000 });

      steps.push({ status: "downloading", message: "Applicazione modifiche...", progress: 30 });
      execSync("git pull origin main --ff-only", { cwd: root, encoding: "utf-8", timeout: 120000 });

      steps.push({ status: "installing", message: "Installazione dipendenze...", progress: 50 });
      execSync("npm install --production=false", { cwd: root, encoding: "utf-8", timeout: 300000 });

      steps.push({ status: "installing", message: "Build applicazione...", progress: 70 });
      execSync("npm run build", { cwd: root, encoding: "utf-8", timeout: 600000 });

      // Build riuscita: rimuovi backup
      if (hasNextBackup && fs.existsSync(nextBackup)) {
        try {
          fs.rmSync(nextBackup, { recursive: true, force: true });
        } catch { /* non critico */ }
      }

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

      const rollbackErrors: string[] = [];

      // 1. Ripristina il codice sorgente al commit precedente
      if (previousCommit) {
        try {
          execSync(`git reset --hard ${previousCommit}`, { cwd: root, encoding: "utf-8", timeout: 30000 });
        } catch (e) {
          rollbackErrors.push(`git reset: ${e}`);
        }
      }

      // 2. Ripristina node_modules per la versione precedente
      try {
        execSync("npm install --production=false", { cwd: root, encoding: "utf-8", timeout: 300000 });
      } catch (e) {
        rollbackErrors.push(`npm install rollback: ${e}`);
      }

      // 3. Ripristina la build precedente (.next.bak)
      if (hasNextBackup && fs.existsSync(nextBackup)) {
        try {
          // Rimuovi la build corrotta/parziale
          if (fs.existsSync(nextDir)) {
            fs.rmSync(nextDir, { recursive: true, force: true });
          }
          fs.renameSync(nextBackup, nextDir);
          console.log("[Update] Ripristinata .next da backup");
        } catch (e) {
          rollbackErrors.push(`ripristino .next: ${e}`);
          // Ultimo tentativo: ricostruisci dalla versione precedente
          try {
            execSync("npm run build", { cwd: root, encoding: "utf-8", timeout: 600000 });
            console.log("[Update] Rebuild dalla versione precedente completato");
          } catch (e2) {
            rollbackErrors.push(`rebuild fallback: ${e2}`);
          }
        }
      } else {
        // Nessun backup .next: prova a ricostruire
        try {
          execSync("npm run build", { cwd: root, encoding: "utf-8", timeout: 600000 });
          console.log("[Update] Rebuild dalla versione precedente completato");
        } catch (e) {
          rollbackErrors.push(`rebuild: ${e}`);
        }
      }

      const rollbackDetail = rollbackErrors.length > 0
        ? ` Problemi durante il rollback: ${rollbackErrors.join("; ")}`
        : "";

      return NextResponse.json({
        status: "error" as const,
        error: `Errore durante l'aggiornamento: ${errorMsg}`,
        message: `L'aggiornamento è stato annullato e il sistema ripristinato.${rollbackDetail}`,
      }, { status: 500 });
    }
  }

  if (action === "restart") {
    try {
      // Verifica che la build esista prima di riavviare
      const nextDir = path.join(getProjectRoot(), ".next");
      if (!fs.existsSync(nextDir)) {
        return NextResponse.json({
          status: "error" as const,
          error: "La directory .next non esiste. Esegui npm run build prima di riavviare.",
        }, { status: 400 });
      }

      // Verifica che la build contenga file essenziali
      const buildManifest = path.join(nextDir, "BUILD_ID");
      if (!fs.existsSync(buildManifest)) {
        return NextResponse.json({
          status: "error" as const,
          error: "La build sembra incompleta (BUILD_ID mancante). Esegui npm run build sul server.",
        }, { status: 400 });
      }

      // Strategia di riavvio:
      // 1. Se systemd è disponibile, usa systemctl restart (più affidabile)
      // 2. Altrimenti self-restart: spawna un nuovo processo e poi esce
      setTimeout(() => {
        const projectRoot = getProjectRoot();

        // Tentativo 1: systemd (produzione tipica)
        try {
          execSync("systemctl is-active da-invent", { timeout: 3000, stdio: "pipe" });
          // Il servizio systemd esiste ed è attivo → usa systemctl restart
          const restarter = spawn("systemctl", ["restart", "da-invent"], {
            detached: true,
            stdio: "ignore",
            cwd: projectRoot,
          });
          restarter.unref();
          process.exit(0);
          return;
        } catch {
          // systemd non disponibile o servizio non registrato → self-restart
        }

        // Tentativo 2: PM2
        try {
          const pm2Name = execSync("pm2 id da-invent 2>/dev/null || true", {
            timeout: 3000, encoding: "utf-8",
          }).trim();
          if (pm2Name && pm2Name !== "[]") {
            const restarter = spawn("pm2", ["restart", "da-invent"], {
              detached: true,
              stdio: "ignore",
              cwd: projectRoot,
            });
            restarter.unref();
            process.exit(0);
            return;
          }
        } catch {
          // PM2 non disponibile
        }

        // Tentativo 3: self-restart — spawna un nuovo processo Node.js identico
        const isDev = process.env.NODE_ENV !== "production";
        const cmd = isDev ? "npx" : "npx";
        const args = isDev ? ["tsx", "watch", "server.ts"] : ["tsx", "server.ts"];

        const child = spawn(cmd, args, {
          detached: true,
          stdio: "ignore",
          cwd: projectRoot,
          env: { ...process.env },
        });
        child.unref();
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

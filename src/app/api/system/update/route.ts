/**
 * API System Update - Controlla e applica aggiornamenti da GitHub
 * GET: Controlla se ci sono aggiornamenti disponibili; ?action=aggiornamento dà lo
 *      stato dell'aggiornamento in corso o dell'ultimo (data/aggiornamento.json)
 * POST: action=apply avvia il servizio d'aggiornamento di systemd
 *       (src/lib/aggiornamento-servizio.ts): la rotta non fa più pull né build
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { execSync, spawn } from "child_process";
import path from "path";
import fs from "fs";
import { isContainerDeploy } from "@/lib/env-secrets";
import {
  exitForSystemd,
  pickPm2Process,
  planRestart,
  readPm2Ids,
  readRestartContext,
  restartWithSystemd,
} from "@/lib/app-service";
import { readUpdateAction } from "@/lib/system-update-action";
import {
  avviaAggiornamento,
  cartellaBuildAttiva,
  leggiStatoAggiornamento,
  leggiRichiestaInAttesa,
  unitaAggiornamento,
} from "@/lib/aggiornamento-servizio";
import {
  getConfiguredUpdateBranch,
  getGitBranch,
  isGitUpdateSupported,
} from "@/lib/update-branch";
import { unisci } from "@/lib/percorsi";

const REPO_API_URL = "https://api.github.com/repos/grandir66/DA-IPAM";
const REPO_RAW_URL = "https://raw.githubusercontent.com/grandir66/DA-IPAM";

/** @deprecated use getConfiguredUpdateBranch */
function getCurrentBranch(): string {
  return getConfiguredUpdateBranch(getProjectRoot());
}

interface UpdateInfo {
  currentVersion: string;
  remoteVersion: string | null;
  updateAvailable: boolean;
  lastCheck: string;
  changelog?: string[];
  error?: string;
  /** systemd+git: aggiornamento da UI; container senza git: solo check versione */
  updateSupported?: boolean;
  deployMode?: "container" | "systemd";
  configuredBranch?: string;
  gitBranch?: string | null;
}

function getProjectRoot(): string {
  return process.cwd();
}

function getCurrentVersion(): string {
  try {
    const pkgPath = unisci(getProjectRoot(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function getRemoteVersion(): Promise<{ version: string; changelog: string[] } | null> {
  const changelog: string[] = [];
  let version: string | null = null;
  const branch = getCurrentBranch();

  const parsePkg = (text: string): string => {
    const pkg = JSON.parse(text) as { version?: string };
    return pkg.version || "0.0.0";
  };

  // 1) raw.githubusercontent.com — di solito non è soggetto al rate limit dell'API REST.
  //    Cache-bust con ?t=now perché raw.githubusercontent.com cacha 5 minuti su edge.
  try {
    const rawUrl = `${REPO_RAW_URL}/${encodeURIComponent(branch)}/package.json?t=${Date.now()}`;
    const rawRes = await fetch(rawUrl, {
      headers: { "User-Agent": "DA-IPAM-Updater", "Cache-Control": "no-cache" },
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
      const response = await fetch(`${REPO_API_URL}/contents/package.json?ref=${encodeURIComponent(branch)}`, {
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
  if (!fs.existsSync(unisci(root, ".git"))) {
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
  // Cerca prima sul branch corrente (per supportare canale Dev/altro), poi
  // fallback main/master per compat. Dedup con Set per evitare doppi check.
  let currentBranch: string | null = null;
  try {
    currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: root, encoding: "utf-8", timeout: 5000 }).trim();
  } catch { /* ignora */ }
  const refs = Array.from(new Set([
    currentBranch && /^[a-z][a-z0-9_\-/]*$/i.test(currentBranch) ? `origin/${currentBranch}` : null,
    "origin/main",
    "origin/master",
  ].filter((x): x is string => Boolean(x))));
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
 * Perché non si può riavviare sulla build presente, o null se si può: senza la
 * cartella della build (`.next`, o `.next-a`/`.next-b` indicata da `.next-attiva`)
 * o senza il suo BUILD_ID il processo nuovo non partirebbe.
 */
function problemaBuild(root: string): string | null {
  const nextDir = cartellaBuildAttiva(root);
  const nome = path.basename(nextDir);
  if (!fs.existsSync(nextDir)) {
    return `La directory ${nome} non esiste. Esegui npm run build prima di riavviare.`;
  }
  if (!fs.existsSync(unisci(nextDir, "BUILD_ID"))) {
    return `La build sembra incompleta (BUILD_ID mancante in ${nome}). Esegui npm run build sul server.`;
  }
  return null;
}

/**
 * Riavvia l'app (src/lib/app-service.ts). Sotto systemd si riavvia l'unità del
 * proprio cgroup, o si esce con 1 se non si capisce quale: mai il rilancio di sé
 * e mai un'uscita con 0, che con Restart=on-failure lascerebbe il servizio
 * spento. Presidiata da src/lib/__tests__/system-update-route-restart.test.ts.
 */
function riavviaApp(): void {
  const piano = planRestart(readRestartContext());
  if (piano.mode === "not-systemd") {
    riavviaFuoriDaSystemd();
    return;
  }
  if (piano.mode === "unit") restartWithSystemd(piano.unit);
  else exitForSystemd(piano.reason);
}

/** Fuori da systemd (sviluppo): PM2 se gestisce l'app, altrimenti il rilancio di sé. */
function riavviaFuoriDaSystemd(): void {
  const projectRoot = getProjectRoot();

  try {
    const pm2Name = pickPm2Process(readPm2Ids());
    if (pm2Name) {
      const restarter = spawn("pm2", ["restart", pm2Name], {
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

  // Rilancio di sé: un nuovo processo Node.js identico, poi si esce
  const isDev = process.env.NODE_ENV !== "production";
  const args = isDev ? ["tsx", "watch", "server.ts"] : ["tsx", "server.ts"];

  const child = spawn("npx", args, {
    detached: true,
    stdio: "ignore",
    cwd: projectRoot,
    env: { ...process.env },
  });
  child.unref();
  process.exit(0);
}

/** Il riavvio parte un secondo dopo, così la risposta arriva prima al browser. Solo «Riavvia». */
function programmaRiavvio(): void {
  setTimeout(riavviaApp, 1000);
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

/** Lo stato dell'aggiornamento per la pagina: file di stato, HEAD su disco, unità. */
function statoPerPagina(root: string) {
  let commitScaricato: string | null = null;
  try {
    commitScaricato = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8", timeout: 5000 }).trim() || null;
  } catch {
    /* installazione senza git */
  }
  return {
    stato: leggiStatoAggiornamento(),
    commitScaricato,
    unita: unitaAggiornamento(readRestartContext().unit),
    richiestaInAttesa: leggiRichiestaInAttesa(),
  };
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "aggiornamento") {
    return NextResponse.json(statoPerPagina(getProjectRoot()));
  }

  if (action === "status") {
    const root = getProjectRoot();
    const gitStatus = getGitStatus();
    return NextResponse.json({
      currentVersion: getCurrentVersion(),
      gitBranch: getGitBranch(root) ?? gitStatus.branch,
      configuredBranch: getConfiguredUpdateBranch(root),
      gitClean: gitStatus.clean,
      dirtyFiles: gitStatus.dirtyFiles,
      projectRoot: root,
      updateSupported: isGitUpdateSupported(root),
      deployMode: isContainerDeploy() ? "container" : "systemd",
      aggiornamento: statoPerPagina(root),
    });
  }

  const root = getProjectRoot();
  const configuredBranch = getConfiguredUpdateBranch(root);
  const gitSupported = isGitUpdateSupported(root);
  const deployMode = isContainerDeploy() ? "container" : "systemd";

  try {
    const currentVersion = getCurrentVersion();
    const remote = await getRemoteVersion();

    if (!remote) {
      return NextResponse.json({
        currentVersion,
        remoteVersion: null,
        updateAvailable: false,
        lastCheck: new Date().toISOString(),
        updateSupported: gitSupported,
        deployMode,
        configuredBranch,
        gitBranch: getGitBranch(root),
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
      updateSupported: gitSupported,
      deployMode,
      configuredBranch,
      gitBranch: getGitBranch(root),
      ...(deployMode === "container" &&
        !gitSupported &&
        updateAvailable && {
          error:
            "Aggiornamento disponibile su GitHub ma questa istanza gira in Docker senza repository git. " +
            "Esegui sul host: sudo bash scripts/appliance-systemd-install.sh (consigliato) oppure rebuild immagine da PVE.",
        }),
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

  // L'azione arriva nell'indirizzo (?action=apply, banner) o nel corpo JSON
  // ({ action: "apply" }, Impostazioni → Aggiornamenti): si accettano tutte e due.
  let corpoRichiesta: string;
  try {
    corpoRichiesta = await request.text();
  } catch (error) {
    return NextResponse.json({
      error: `Impossibile leggere il corpo della richiesta: ${error instanceof Error ? error.message : String(error)}`,
    }, { status: 400 });
  }
  const lettura = readUpdateAction(new URL(request.url).searchParams.get("action"), corpoRichiesta);
  if (!lettura.ok) {
    return NextResponse.json({ error: lettura.error }, { status: 400 });
  }
  const action = lettura.action;

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
    if (!isGitUpdateSupported(root)) {
      return NextResponse.json({
        error:
          isContainerDeploy()
            ? "Aggiornamento da UI non disponibile in modalità Docker (nessun repository git). " +
              "Sul host VM esegui: sudo DA_INVENT_BRANCH=dev bash /opt/da-ipam/scripts/appliance-systemd-install.sh " +
              "per migrare a systemd+git con auto-update, oppure rebuild l'immagine da PVE."
            : "Directory installazione senza .git — impossibile git pull. Reinstalla con git clone o usa scripts/update.sh.",
        status: "error" as const,
      }, { status: 400 });
    }

    // Una sola strada: lo stesso servizio del timer (scripts/auto-update.sh →
    // scripts/update.sh), con build in una cartella separata, salute dopo il
    // riavvio e ritorno indietro. Il ramo è quello del canale configurato, e le
    // modifiche locali le sistema lo script come nei giri del timer.
    const unita = unitaAggiornamento(readRestartContext().unit);
    if (!unita) {
      return NextResponse.json({
        error:
          "L'aggiornamento dall'interfaccia passa dal servizio d'aggiornamento di systemd, " +
          "e questa istanza non gira come servizio di systemd. Sul server esegui: bash scripts/update.sh --restart",
        status: "error" as const,
      }, { status: 400 });
    }

    const avvio = await avviaAggiornamento(unita);
    if (!avvio.ok) {
      console.error("[Update] avvio del servizio d'aggiornamento non riuscito:", avvio.errore);
      return NextResponse.json({
        error: `Impossibile avviare l'aggiornamento: ${avvio.errore}. Sul server: systemctl start ${unita}`,
        status: "error" as const,
      }, { status: 500 });
    }

    return NextResponse.json({
      status: "started" as const,
      message: `Aggiornamento avviato (${unita}). Build e riavvio richiedono alcuni minuti: la pagina segue l'avanzamento.`,
      unit: unita,
      richiestoIl: avvio.richiestoIl,
      // Il riavvio lo fa il servizio d'aggiornamento, dopo una build riuscita.
      restartScheduled: false,
      requiresRestart: false,
    });
  }

  if (action === "restart") {
    try {
      // Si riavvia solo su una build completa: senza, il processo nuovo non parte
      const ostacolo = problemaBuild(getProjectRoot());
      if (ostacolo) {
        return NextResponse.json({ status: "error" as const, error: ostacolo }, { status: 400 });
      }

      // Lo stesso riavvio di un «Aggiorna» riuscito: vedi riavviaApp
      programmaRiavvio();

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

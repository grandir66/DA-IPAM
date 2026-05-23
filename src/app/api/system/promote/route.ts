/**
 * Promote dev → main (DA-IPAM).
 *
 *   GET   — preview: lista commit di `dev` non ancora in `main` + sha base/diff
 *   POST  — esegue git fetch + checkout main + merge --no-ff dev + push origin main
 *
 *   PUT   /github-pat — salva il GitHub PAT cifrato in hub.settings, usato
 *                       per il push HTTPS quando il remote richiede auth.
 *   DELETE/github-pat — rimuove il PAT.
 *
 * Solo admin. Lavora sul repo in process.cwd() (o DA_INVENT_DIR).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import path from "node:path";
import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getSetting, setSetting } from "@/lib/db-hub";
import { encrypt, safeDecrypt } from "@/lib/crypto";

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

function getGithubPat(): string | null {
  const enc = getSetting(PAT_KEY);
  if (!enc) return null;
  return safeDecrypt(enc);
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

const PostSchema = z.object({
  /** Conferma esplicita richiesta — la UI deve passarla per evitare promote accidentali */
  confirm: z.literal(true),
});

/** Costruisce URL HTTPS con token incorporato per autenticazione push.
 *  Es. https://github.com/owner/repo.git → https://x-access-token:TOKEN@github.com/owner/repo.git */
function buildAuthedUrl(remoteUrl: string, pat: string): string {
  const m = remoteUrl.match(/^https:\/\/(.*)$/);
  if (!m) throw new Error("Push autenticato richiede remote HTTPS, trovato: " + remoteUrl);
  return `https://x-access-token:${pat}@${m[1]}`;
}

export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  let body: unknown = {};
  try { body = await req.json(); } catch { /* ok, conferma è obbligatoria */ }
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Conferma esplicita richiesta: { confirm: true }" }, { status: 400 });
  }

  const log: string[] = [];
  const out = (line: string) => { log.push(line); };

  try {
    // 1) fetch
    out(">>> git fetch origin main dev");
    const f = await git(["fetch", "origin", "main", "dev"]);
    out(f.stdout || f.stderr || "(no output)");
    if (!f.ok) throw new Error("git fetch fallito: " + (f.stderr || f.stdout));

    // 2) controllo che dev sia AHEAD di main (altrimenti niente da promuovere)
    const aheadRes = await git(["rev-list", "--count", "origin/main..origin/dev"]);
    const ahead = parseInt(aheadRes.stdout.trim() || "0", 10);
    out(`>>> dev è ${ahead} commit avanti rispetto a main`);
    if (ahead === 0) {
      return NextResponse.json({ ok: false, log, error: "Nessun commit da promuovere: dev coincide con main." });
    }

    // 3) checkout main + reset al remoto (evita conflitti locali)
    out(">>> git checkout main");
    const c = await git(["checkout", "main"]);
    out(c.stdout || c.stderr || "(ok)");
    if (!c.ok) throw new Error("checkout main fallito: " + c.stderr);

    out(">>> git reset --hard origin/main");
    const r = await git(["reset", "--hard", "origin/main"]);
    out(r.stdout || r.stderr || "(ok)");

    // 4) merge --no-ff dev (NO-FF mantiene il commit di merge nel log)
    out(">>> git merge --no-ff origin/dev -m 'promote: dev → main'");
    const m = await git([
      "-c", "user.email=da-ipam@local",
      "-c", "user.name=DA-IPAM Promote",
      "merge", "--no-ff", "origin/dev", "-m", "promote: dev → main",
    ]);
    out(m.stdout || m.stderr || "(ok)");
    if (!m.ok) throw new Error("merge fallito: " + (m.stderr || m.stdout));

    const newSha = (await git(["rev-parse", "HEAD"])).stdout.trim();
    out(`>>> nuovo HEAD: ${newSha}`);

    // 5) push (HTTPS con PAT se configurato; altrimenti tenta push standard)
    const pat = getGithubPat();
    const remoteUrl = await getRemoteUrl();
    if (!remoteUrl) throw new Error("remote 'origin' non configurato");

    let pushRes;
    if (pat && remoteUrl.startsWith("https://")) {
      const authed = buildAuthedUrl(remoteUrl, pat);
      out(">>> git push <auth> main  (token nascosto)");
      pushRes = await git(["push", authed, "main"]);
    } else {
      out(">>> git push origin main");
      pushRes = await git(["push", "origin", "main"]);
    }
    out(pushRes.stdout || pushRes.stderr || "(ok)");
    if (!pushRes.ok) {
      // Sanitize: rimuovi token da eventuali messaggi di errore
      const clean = (pushRes.stderr + pushRes.stdout).replace(/x-access-token:[^@]+@/g, "x-access-token:***@");
      throw new Error("push fallito: " + clean);
    }

    out(">>> promote completato.");
    return NextResponse.json({
      ok: true,
      newSha,
      mergedCommits: ahead,
      log,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, log, error: (e as Error).message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT/DELETE per gestire il GitHub PAT (cifrato in hub.settings)
// ─────────────────────────────────────────────────────────────────────────────

const PatSchema = z.object({
  pat: z.string().min(20).max(500),
});

export async function PUT(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON non valido" }, { status: 400 }); }
  const parsed = PatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
  }
  setSetting(PAT_KEY, encrypt(parsed.data.pat));
  return NextResponse.json({ ok: true, patConfigured: true });
}

export async function DELETE() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  setSetting(PAT_KEY, "");
  return NextResponse.json({ ok: true, patConfigured: false });
}

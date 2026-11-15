/**
 * Canale di aggiornamento DA-IPAM (Stable=main / Dev=dev).
 *
 * I due canali rispecchiano 1:1 i branch GitHub:
 *  - "stable" → branch `main` (produzione, riceve solo promote esplicite)
 *  - "dev"    → branch `dev`  (riceve ogni push di sviluppo, per test)
 *
 *  GET — ritorna canale attuale (DA_INVENT_BRANCH da .env.local) + branch
 *        git locale + se PAT GitHub configurato.
 *  PUT — cambia canale: scrive .env.local DA_INVENT_BRANCH=<branch>.
 *        Al prossimo tick di da-invent-update.service il branch viene
 *        cambiato. Non triggera l'update immediatamente.
 *
 * Solo superadmin/admin.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { getSetting } from "@/lib/db-hub";
import { unisci } from "@/lib/percorsi";

const execFile = promisify(_execFile);

const APP_DIR = process.env.DA_INVENT_DIR ?? process.cwd();
const ENV_FILE = unisci(APP_DIR, ".env.local");

const BRANCH_TO_CHANNEL: Record<string, "stable" | "dev"> = {
  main: "stable",
  dev: "dev",
};
const CHANNEL_TO_BRANCH: Record<"stable" | "dev", string> = {
  stable: "main",
  dev: "dev",
};

// Accetta sia "dev" (nuovo) che "beta" (legacy, mappato a "dev") per non
// rompere eventuali client salvati con il vecchio enum.
const PutSchema = z.object({
  channel: z.enum(["stable", "dev", "beta"]).transform((v) => (v === "beta" ? "dev" : v) as "stable" | "dev"),
});

interface UpdateChannelStatus {
  channel: "stable" | "dev" | "unknown";
  branch: string;
  configuredBranch: string;          // valore DA_INVENT_BRANCH in .env.local
  gitBranch: string | null;          // branch git effettivo
  patConfigured: boolean;            // GitHub PAT salvato (cifrato in settings)
  envFileWritable: boolean;
  /** Firma dei rilasci: modo (avvisa, blocca, spenta) e ultimo controllo fatto dall'aggiornamento. */
  firma: { modo: "avvisa" | "blocca" | "spenta"; esito: "buona" | "mancante" | "rifiutata" | null; commit: string | null; quando: string | null };
}

async function readEnvFile(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(ENV_FILE, "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

async function writeEnvKey(key: string, value: string): Promise<void> {
  let raw = "";
  try {
    raw = await fs.readFile(ENV_FILE, "utf8");
  } catch {
    raw = "";
  }
  const lines = raw.split(/\r?\n/);
  const re = new RegExp(`^\\s*${key}\\s*=`);
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }
  if (!found) {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push(`${key}=${value}`);
  }
  await fs.writeFile(ENV_FILE, lines.join("\n") + "\n", "utf8");
}

async function getGitBranch(): Promise<string | null> {
  try {
    const r = await execFile("git", ["-C", APP_DIR, "rev-parse", "--abbrev-ref", "HEAD"], { timeout: 5000 });
    return r.stdout.trim();
  } catch {
    return null;
  }
}

async function isEnvFileWritable(): Promise<boolean> {
  try {
    await fs.access(ENV_FILE, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * L'ultimo controllo della firma del rilascio, scritto da `scripts/lib/guardia-firma.sh` nella cartella dati
 * (15/11/2026). `null` = nessun controllo ancora fatto su questa installazione.
 */
async function esitoFirma(modoScritto: string | undefined): Promise<UpdateChannelStatus["firma"]> {
  const modo = modoScritto === "blocca" || modoScritto === "spenta" ? modoScritto : "avvisa";
  try {
    const dati = process.env.DA_INVENT_DATA_DIR ?? unisci(APP_DIR, "data");
    const j: unknown = JSON.parse(await fs.readFile(unisci(dati, "firma-rilasci.json"), "utf8"));
    if (j && typeof j === "object") {
      const o = j as Record<string, unknown>;
      const esito = o.esito === "buona" || o.esito === "mancante" || o.esito === "rifiutata" ? o.esito : null;
      if (esito) return { modo, esito, commit: typeof o.commit === "string" ? o.commit : null, quando: typeof o.quando === "string" ? o.quando : null };
    }
  } catch {
    /* nessun controllo ancora, o file illeggibile: si dice «mai controllata» */
  }
  return { modo, esito: null, commit: null, quando: null };
}

async function buildStatus(): Promise<UpdateChannelStatus> {
  const env = await readEnvFile();
  const configuredBranch = env.DA_INVENT_BRANCH ?? "main";
  const channel = BRANCH_TO_CHANNEL[configuredBranch] ?? "unknown";
  const gitBranch = await getGitBranch();
  const patConfigured = !!getSetting("system_github_pat_encrypted");
  const envFileWritable = await isEnvFileWritable();
  return {
    channel,
    branch: configuredBranch,
    configuredBranch,
    gitBranch,
    patConfigured,
    envFileWritable,
    firma: await esitoFirma(env.DA_INVENT_FIRMA_RILASCI),
  };
}

export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  try {
    const status = await buildStatus();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON non valido" }, { status: 400 }); }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
  }

  const newBranch = CHANNEL_TO_BRANCH[parsed.data.channel];
  try {
    await writeEnvKey("DA_INVENT_BRANCH", newBranch);
    const status = await buildStatus();
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Impossibile scrivere .env.local: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}

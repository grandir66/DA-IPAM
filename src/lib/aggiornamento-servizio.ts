/**
 * «Aggiorna ora» passa dal servizio d'aggiornamento di systemd, non dal processo
 * dell'app (passo 1c del piano di solidità, 16/10/2026).
 *
 * Prima la rotta faceva pull, npm install e build dentro il processo acceso, con un
 * suo ritorno indietro diverso da quello del timer: due strade, e la build fatta
 * sopra la `.next` del processo che stava girando. Ora la rotta lascia la richiesta
 * in `data/aggiornamento-richiesto` e avvia `<unità dell'app>-update.service`
 * (`da-invent-update` o `da-ipam-update`), che esegue `scripts/auto-update.sh`:
 * build in una cartella separata, salute dopo il riavvio, ritorno indietro. La
 * pagina segue l'avanzamento leggendo `data/aggiornamento.json`.
 *
 * Il servizio d'aggiornamento sta in un'unità sua: quando riavvia l'app non muore
 * con lei.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";
import { interpretaStatoAggiornamento, STATO_VUOTO, type StatoAggiornamento } from "@/lib/aggiornamento-stato";

/** Lo stesso percorso di scripts/stato-aggiornamento.mjs. */
export function percorsoStatoAggiornamento(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const daAmbiente = env.DA_INVENT_STATO_AGGIORNAMENTO?.trim();
  if (daAmbiente) return daAmbiente;
  return path.join(resolveDataDir(), "aggiornamento.json");
}

/** Il file che scripts/auto-update.sh consuma come «forza l'aggiornamento». */
export function percorsoRichiestaAggiornamento(): string {
  return path.join(resolveDataDir(), "aggiornamento-richiesto");
}

export function leggiStatoAggiornamento(file: string = percorsoStatoAggiornamento()): StatoAggiornamento {
  let testo: string;
  try {
    testo = fs.readFileSync(file, "utf8");
  } catch {
    return STATO_VUOTO; // nessun aggiornamento ancora registrato
  }
  try {
    return interpretaStatoAggiornamento(JSON.parse(testo));
  } catch {
    return STATO_VUOTO; // file a metà: lo riscrive il prossimo giro
  }
}

/** L'ora scritta nella richiesta ancora da prendere, o null se non ce n'è. */
export function leggiRichiestaInAttesa(file: string = percorsoRichiestaAggiornamento()): string | null {
  try {
    const testo = fs.readFileSync(file, "utf8").trim();
    return /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(testo) ? testo : new Date(fs.statSync(file).mtimeMs).toISOString();
  } catch {
    return null;
  }
}

/** `da-ipam.service` → `da-ipam-update.service`; null fuori da un servizio. */
export function unitaAggiornamento(unitaApp: string | null): string | null {
  if (!unitaApp) return null;
  const m = /^(.+)\.service$/.exec(unitaApp);
  if (!m || m[1].endsWith("-update")) return null;
  return `${m[1]}-update.service`;
}

/** `--no-block`: systemctl accoda l'avvio ed esce; il build dura minuti. */
export function argomentiAvvio(unita: string): string[] {
  return ["--no-block", "start", unita];
}

export type EsitoAvvio = { ok: true; richiestoIl: string } | { ok: false; errore: string };

export type EseguiSystemctl = (args: string[]) => Promise<{ codice: number; stderr: string }>;

const eseguiSystemctl: EseguiSystemctl = (args) =>
  new Promise((resolve) => {
    execFile("systemctl", args, { timeout: 15_000 }, (err, _stdout, stderr) => {
      if (!err) return resolve({ codice: 0, stderr: "" });
      const codice = typeof err.code === "number" ? err.code : -1;
      resolve({ codice, stderr: (stderr || err.message).trim() });
    });
  });

/**
 * Lascia la richiesta e avvia il servizio. Se systemctl rifiuta (unità che non
 * c'è, permessi: l'app non gira come root) la richiesta si toglie, così il giro
 * del timer non la scambia per un clic dell'utente.
 */
export async function avviaAggiornamento(
  unita: string,
  esegui: EseguiSystemctl = eseguiSystemctl,
  richiesta: string = percorsoRichiestaAggiornamento(),
): Promise<EsitoAvvio> {
  const richiestoIl = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(richiesta), { recursive: true });
    fs.writeFileSync(richiesta, richiestoIl + "\n");
  } catch (e) {
    return { ok: false, errore: `impossibile scrivere ${richiesta}: ${e instanceof Error ? e.message : String(e)}` };
  }
  const { codice, stderr } = await esegui(argomentiAvvio(unita));
  if (codice === 0) return { ok: true, richiestoIl };
  try {
    fs.rmSync(richiesta, { force: true });
  } catch {
    /* il prossimo giro la consuma comunque */
  }
  return { ok: false, errore: `systemctl start ${unita} non riuscito (codice ${codice}): ${stderr || "nessun dettaglio"}` };
}

/**
 * La cartella della build che l'app usa, con la stessa regola di next.config.ts:
 * `.next-attiva` se indica `.next-a` o `.next-b`, altrimenti `.next`.
 */
export function cartellaBuildAttiva(root: string): string {
  try {
    const attiva = fs.readFileSync(path.join(root, ".next-attiva"), "utf8").trim();
    if (/^\.next-[ab]$/.test(attiva)) return path.join(root, attiva);
  } catch {
    /* nessun file: la build sta in .next */
  }
  return path.join(root, ".next");
}

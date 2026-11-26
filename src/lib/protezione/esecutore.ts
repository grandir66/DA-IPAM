/**
 * Le chiamate all'esecutore del filtro (`scripts/accessi/da-ipam-accessi.sh`), dal lato dell'applicazione
 * (Protezione, tappa 2; ADR 0041). L'applicazione non chiama mai `nft` per scrivere: scrive il file della
 * politica e lancia UNO dei comandi chiusi dello script, con `execFile` e argomenti fissi (mai una shell).
 *
 * Due file: `accessi.conf` è la politica in vigore; `accessi.conf.prova` è quella in prova, che diventa in
 * vigore solo alla conferma. Così, se la prova scade e tornano le regole di prima, il file in vigore dice ancora
 * il vero.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { unisci } from "@/lib/percorsi";
import { leggiFuori, type Visto } from "./anteprima";
import { POLITICA_VUOTA, leggiPolitica, scriviPolitica, type Politica } from "./politica";

const DIR = "/etc/da-ipam";
export const FILE_POLITICA = `${DIR}/accessi.conf`;
export const FILE_IN_PROVA = `${DIR}/accessi.conf.prova`;
export const SECONDI_PROVA = 120;

const script = (): string => unisci(process.cwd(), "scripts", "accessi", "da-ipam-accessi.sh");

interface Esito {
  codice: number;
  out: string;
  err: string;
}

function lancia(argomenti: string[], conf?: string): Promise<Esito> {
  return new Promise((resolve) => {
    execFile(
      "bash",
      [script(), ...argomenti],
      { timeout: 20000, maxBuffer: 2 * 1024 * 1024, // Ambiente scritto a mano: allo script arrivano solo il PATH e, se serve, il file della politica.
      env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH ?? "/usr/sbin:/usr/bin:/sbin:/bin", ...(conf ? { DAIPAM_ACCESSI_CONF: conf } : {}) } },
      (err, stdout, stderr) => resolve({ codice: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout, err: stderr.trim() }),
    );
  });
}

export interface StatoFiltro {
  /** L'esecutore può lavorare qui: Linux, root, `nft` e lo script presenti. Altrimenti il motivo. */
  disponibile: boolean;
  motivo: string | null;
  tabella: "assente" | "osserva" | "acceso" | "minima";
  provaInCorso: boolean;
}

export async function statoFiltro(): Promise<StatoFiltro> {
  const no = (motivo: string): StatoFiltro => ({ disponibile: false, motivo, tabella: "assente", provaInCorso: false });
  if (os.platform() !== "linux") return no("Questa macchina non è un'appliance Linux: il filtro non si può caricare.");
  if (typeof process.getuid === "function" && process.getuid() !== 0) return no("DA-IPAM non gira come root su questa macchina: l'esecutore del filtro non parte.");
  if (!fs.existsSync(script())) return no("Lo script dell'esecutore non c'è in questa installazione.");
  const r = await lancia(["stato"]);
  if (r.codice !== 0) return no(r.err || "L'esecutore non risponde.");
  const valori = new Map(r.out.split("\n").map((x) => x.trim().split("=") as [string, string]).filter((x) => x.length === 2));
  const t = valori.get("tabella");
  return { disponibile: true, motivo: null, tabella: t === "osserva" || t === "acceso" || t === "minima" ? t : "assente", provaInCorso: valori.get("prova") === "in_corso" };
}

/** La politica in vigore; senza file, quella vuota (chiuso a tutti tranne NetBird). */
export function politicaInVigore(): Politica {
  try {
    return leggiPolitica(fs.readFileSync(FILE_POLITICA, "utf8"));
  } catch {
    return POLITICA_VUOTA;
  }
}

function testoInVigore(): string {
  try {
    return fs.readFileSync(FILE_POLITICA, "utf8");
  } catch {
    return "";
  }
}

function leggiSet(nome: string): Promise<Visto[]> {
  return new Promise((resolve) => {
    execFile("nft", ["-j", "list", "set", "inet", "daipam_accessi", nome], { timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? [] : leggiFuori(stdout)));
  });
}

/** Chi è stato visto arrivare senza essere in elenco, IPv4 e IPv6 (sola lettura). */
export async function vistiFuori(): Promise<Visto[]> {
  return [...(await leggiSet("fuori4")), ...(await leggiSet("fuori6"))];
}

function scriviFile(percorso: string, testo: string): void {
  // 755: nella cartella sta anche `esche.conf`, che il servizio delle esche legge con un'utenza sua. I file della politica restano 600.
  fs.mkdirSync(DIR, { recursive: true, mode: 0o755 });
  const tmp = `${percorso}.tmp`;
  fs.writeFileSync(tmp, testo, { mode: 0o600 });
  fs.renameSync(tmp, percorso);
}

export interface EsitoAzione {
  ok: boolean;
  messaggio: string;
  prima: string;
  dopo: string;
}

/** La prova a vuoto dello script su questa politica: dice se la accetta, senza toccare niente. */
export async function provaAVuoto(p: Politica): Promise<{ ok: boolean; messaggio: string }> {
  const tmp = unisci(os.tmpdir(), `daipam-accessi-${process.pid}-${Date.now()}.conf`);
  try {
    fs.writeFileSync(tmp, scriviPolitica(p), { mode: 0o600 });
    const r = await lancia(["anteprima"], tmp);
    return { ok: r.codice === 0, messaggio: r.codice === 0 ? "Le regole si generano senza errori." : r.err };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Mette in osservazione questa politica: diventa quella in vigore e le regole contano soltanto. */
export async function osserva(p: Politica): Promise<EsitoAzione> {
  const prima = testoInVigore();
  const dopo = scriviPolitica(p);
  scriviFile(FILE_POLITICA, dopo);
  const r = await lancia(["osserva"]);
  if (r.codice !== 0) {
    // Lo script ha rifiutato: il file in vigore torna quello di prima, così dice ancora il vero.
    if (prima) scriviFile(FILE_POLITICA, prima);
    else fs.rmSync(FILE_POLITICA, { force: true });
    return { ok: false, messaggio: r.err || "L'esecutore ha rifiutato.", prima, dopo };
  }
  fs.rmSync(FILE_IN_PROVA, { force: true });
  return { ok: true, messaggio: "In osservazione: nessuno viene scartato.", prima, dopo };
}

/** Carica le regole che chiudono, in prova: senza `conferma` entro il tempo tornano quelle di prima. */
export async function prova(p: Politica): Promise<EsitoAzione> {
  const prima = testoInVigore();
  const dopo = scriviPolitica(p);
  scriviFile(FILE_IN_PROVA, dopo);
  const r = await lancia(["prova", String(SECONDI_PROVA)], FILE_IN_PROVA);
  if (r.codice !== 0) fs.rmSync(FILE_IN_PROVA, { force: true });
  return { ok: r.codice === 0, messaggio: r.codice === 0 ? `Regole in prova per ${SECONDI_PROVA} secondi.` : r.err || "L'esecutore ha rifiutato.", prima, dopo };
}

/** Conferma la prova: la politica in prova diventa quella in vigore. */
export async function conferma(): Promise<EsitoAzione> {
  const prima = testoInVigore();
  let dopo = "";
  try {
    dopo = fs.readFileSync(FILE_IN_PROVA, "utf8");
  } catch {
    return { ok: false, messaggio: "Nessuna prova in corso.", prima, dopo: prima };
  }
  const r = await lancia(["conferma"]);
  if (r.codice !== 0) {
    fs.rmSync(FILE_IN_PROVA, { force: true });
    return { ok: false, messaggio: r.err || "La prova è scaduta: sono tornate le regole di prima.", prima, dopo: prima };
  }
  scriviFile(FILE_POLITICA, dopo);
  fs.rmSync(FILE_IN_PROVA, { force: true });
  return { ok: true, messaggio: "Confermato: il filtro è acceso.", prima, dopo };
}

export async function annulla(): Promise<EsitoAzione> {
  const prima = testoInVigore();
  const r = await lancia(["annulla"]);
  fs.rmSync(FILE_IN_PROVA, { force: true });
  return { ok: r.codice === 0, messaggio: r.codice === 0 ? "Tornate le regole di prima." : r.err, prima, dopo: prima };
}

/** Toglie il filtro. La politica scritta resta: riaccenderlo non chiede di riscriverla. */
export async function spegni(): Promise<EsitoAzione> {
  const prima = testoInVigore();
  const r = await lancia(["spegni"]);
  fs.rmSync(FILE_IN_PROVA, { force: true });
  return { ok: r.codice === 0, messaggio: r.codice === 0 ? "Filtro spento: l'installazione non è protetta." : r.err, prima, dopo: prima };
}

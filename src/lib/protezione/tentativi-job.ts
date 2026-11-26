/**
 * Il giro che raccoglie i tentativi e manda gli avvisi (Protezione, tappa 3). Ogni due minuti: legge le righe
 * nuove di sshd dal journal, gli indirizzi nuovi scartati dal filtro (solo a filtro acceso), poi guarda chi ha
 * superato la soglia negli ultimi dieci minuti e avvisa con le notifiche già configurate (email, webhook).
 * I login falliti della pagina li scrive `registraAccesso` nel momento in cui succedono.
 *
 * Lo stato (fin dove si è letto, chi è già stato avvisato) sta in un file, così un riavvio non rimanda gli avvisi
 * né rilegge una settimana di journal. Sola lettura sul sistema: `journalctl` e `nft list`.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { resolveDataDir } from "../data-dir";
import { elencaCartella, unisci } from "../percorsi";
import { dispatchNotification } from "../notifications/notifier";
import type { NotifiableEvent } from "../notifications/policy";
import { statoFiltro, vistiFuori } from "./esecutore";
import { daAvvisare, leggiTentativi, pulisciTentativi, scriviTentativi, tentativoDaEvento, tentativoDaRigaSsh, type Avviso, type Tentativo } from "./tentativi";

export const OGNI_MS = 2 * 60_000;
const PRIMO_MS = 90_000;

interface StatoGiro {
  /** Fin dove si è letto il journal di sshd (ISO). */
  sshFino: string | null;
  /** Coppie indirizzo|porta del filtro già registrate. */
  filtroVisti: string[];
  /** Fin dove si è letto ogni file degli eventi delle esche: nome del file → byte. */
  escheLetti: Record<string, number>;
  avvisati: Record<string, string>;
}

const fileStato = (): string => unisci(resolveDataDir(), "audit", "tentativi-stato.json");

function leggiStato(): StatoGiro {
  try {
    const s = JSON.parse(fs.readFileSync(fileStato(), "utf8")) as Partial<StatoGiro>;
    return { sshFino: typeof s.sshFino === "string" ? s.sshFino : null, filtroVisti: Array.isArray(s.filtroVisti) ? s.filtroVisti.filter((x) => typeof x === "string") : [], avvisati: s.avvisati && typeof s.avvisati === "object" ? s.avvisati : {}, escheLetti: s.escheLetti && typeof s.escheLetti === "object" ? s.escheLetti : {} };
  } catch {
    return { sshFino: null, filtroVisti: [], avvisati: {}, escheLetti: {} };
  }
}

function scriviStato(s: StatoGiro): void {
  try {
    fs.mkdirSync(unisci(resolveDataDir(), "audit"), { recursive: true });
    fs.writeFileSync(fileStato(), JSON.stringify(s));
  } catch (e) {
    console.error("[tentativi] stato del giro non scritto:", e);
  }
}

function esegui(comando: string, argomenti: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(comando, argomenti, { timeout: 15000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

/** Dove systemd tiene lo stato del servizio delle esche (`StateDirectory`, con utenza effimera sta sotto `private`). */
export const DIR_EVENTI_ESCHE = "/var/lib/private/da-ipam-esche";

/**
 * Le righe nuove di ogni file `eventi-*.jsonl`, e aggiorna `letti` (nome → byte). Al più 2000 righe per giro: un
 * visitatore che martella le esche non riempie la memoria; il resto si legge al giro dopo.
 */
export function leggiEventiEsche(letti: Record<string, number>, dir = DIR_EVENTI_ESCHE): Map<string, string[]> {
  const esito = new Map<string, string[]>();
  let file: string[];
  try {
    file = elencaCartella(dir).filter((f) => /^eventi-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
  } catch {
    return esito;
  }
  let tetto = 2000;
  for (const f of file) {
    if (tetto <= 0) break;
    const percorso = unisci(dir, f);
    try {
      const lungo = fs.statSync(percorso).size;
      const da = Math.min(letti[f] ?? 0, lungo);
      if (lungo === da) continue;
      const fd = fs.openSync(percorso, "r");
      const blocco = Buffer.alloc(Math.min(lungo - da, 2 * 1024 * 1024));
      fs.readSync(fd, blocco, 0, blocco.length, da);
      fs.closeSync(fd);
      // Solo righe intere: l'ultima può essere a metà scrittura.
      const fine = blocco.lastIndexOf(10);
      if (fine < 0) continue;
      const righe = blocco.subarray(0, fine).toString("utf8").split("\n").filter(Boolean).slice(0, tetto);
      tetto -= righe.length;
      esito.set(f, righe);
      letti[f] = da + fine + 1;
    } catch (e) {
      console.error("[tentativi] eventi delle esche non letti:", e instanceof Error ? e.message : e);
    }
  }
  for (const k of Object.keys(letti)) if (!file.includes(k)) delete letti[k];
  return esito;
}

/** Gli indirizzi di questa macchina: i tentativi che partono da qui (lo Scanner-Edge) non sono intrusi. */
export function indirizziNostri(): Set<string> {
  return new Set(Object.values(os.networkInterfaces()).flatMap((x) => (x ?? []).map((a) => a.address)));
}

export interface EsitoGiroTentativi {
  nuovi: number;
  avvisi: number;
}

export async function giroTentativi(adesso = new Date()): Promise<EsitoGiroTentativi> {
  const stato = leggiStato();
  const nuovi: Tentativo[] = [];

  // SSH: dal punto in cui si era arrivati; la prima volta solo l'ultima ora, non la storia intera.
  const da = stato.sshFino ?? new Date(adesso.getTime() - 3_600_000).toISOString();
  const journal = await esegui("journalctl", ["-u", "ssh", "-u", "sshd", "--since", `@${Math.floor(new Date(da).getTime() / 1000)}`, "--no-pager", "-o", "short-iso"]);
  if (journal !== null) {
    for (const riga of journal.split("\n")) {
      const t = tentativoDaRigaSsh(riga);
      if (t && t.il > da) nuovi.push(t);
    }
    stato.sshFino = nuovi.filter((t) => t.fonte === "ssh").reduce((m, t) => (t.il > m ? t.il : m), da);
  }

  // Filtro: solo quando chiude davvero; in osservazione chi compare «resterebbe fuori», non ha tentato niente.
  const filtro = await statoFiltro();
  if (filtro.disponibile && filtro.tabella === "acceso" && !filtro.provaInCorso) {
    const visti = await vistiFuori();
    const gia = new Set(stato.filtroVisti);
    for (const v of visti) {
      const k = `${v.indirizzo}|${v.porta}`;
      if (!gia.has(k)) nuovi.push({ il: adesso.toISOString(), fonte: "filtro", indirizzo: v.indirizzo, porta: v.porta, cosa: "scartato" });
    }
    // Si ricordano solo quelli ancora nel set: quando scadono là (7 giorni) un ritorno conta di nuovo.
    stato.filtroVisti = visti.map((v) => `${v.indirizzo}|${v.porta}`);
  } else if (filtro.tabella !== "acceso") {
    stato.filtroVisti = [];
  }

  // Esche: le righe nuove dei file scritti dal servizio (cartella di systemd, leggibile solo da root).
  for (const [nome, righe] of leggiEventiEsche(stato.escheLetti)) {
    void nome;
    for (const r of righe) {
      const t = tentativoDaEvento(r);
      // I contatti che partono da questa macchina (lo Scanner-Edge che scansiona se stesso) non sono tentativi.
      if (t && !(t.indirizzo && indirizziNostri().has(t.indirizzo))) nuovi.push(t);
    }
  }

  scriviTentativi(nuovi);

  const avvisi = daAvvisare(leggiTentativi(1, adesso), adesso, stato.avvisati, indirizziNostri());
  let mandati = 0;
  for (const a of avvisi) {
    if (await manda(a, adesso)) mandati += 1;
    // Anche se le notifiche sono spente si segna: quando le accendono non parte la coda dell'ultima ora.
    stato.avvisati[a.chiave] = adesso.toISOString();
  }
  for (const [k, v] of Object.entries(stato.avvisati)) if (adesso.getTime() - new Date(v).getTime() > 7 * 86_400_000) delete stato.avvisati[k];
  scriviStato(stato);
  pulisciTentativi(adesso);
  return { nuovi: nuovi.length, avvisi: mandati };
}

async function manda(a: Avviso, adesso: Date): Promise<boolean> {
  const nome = os.hostname();
  const evento: NotifiableEvent = {
    id: 0,
    category: `protezione_${a.aggregato.fonte}`,
    diagnostic: 0,
    rule_level: 10,
    rule_description: a.testo,
    agent_name: nome,
    event_id: null,
    target_user: a.aggregato.utenti[0] ?? null,
    source_ip: a.aggregato.indirizzo,
    occurrence_count: a.aggregato.quanti,
    first_seen_at: a.aggregato.primo,
    last_seen_at: a.aggregato.ultimo,
  };
  try {
    const esiti = await dispatchNotification({
      kind: "immediate",
      tenant: nome,
      events: [evento],
      message: { subject: `[${nome}] DA-IPAM: tentativi di accesso`, text: `${a.testo}\n\nMacchina: ${nome}\nQuando: ${adesso.toISOString()}\nDettaglio: DA-IPAM › Sicurezza › Protezione › Tentativi.` },
    });
    return esiti.some((e) => e.ok);
  } catch (e) {
    console.error("[tentativi] avviso non mandato:", e instanceof Error ? e.message : e);
    return false;
  }
}

const CHIAVE = Symbol.for("da-ipam.protezione.tentativi-job");

/** Avvia il giro periodico (una volta sola per processo). Solo su Linux: altrove non c'è niente da leggere. */
export function avviaGiroTentativi(): void {
  const g = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (g[CHIAVE] || os.platform() !== "linux") return;
  g[CHIAVE] = true;
  let inCorso = false;
  const tic = () => {
    if (inCorso) return;
    inCorso = true;
    giroTentativi()
      .catch((e: unknown) => console.error("[tentativi] giro fallito:", e instanceof Error ? e.message : e))
      .finally(() => { inCorso = false; });
  };
  setTimeout(tic, PRIMO_MS).unref?.();
  setInterval(tic, OGNI_MS).unref?.();
}

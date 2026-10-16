/**
 * Guardia degli script che SCRIVONO sui dati (tappa 2g credenziali, T27:
 * `scripts/credenziali/pulizia-t2.ts` e `togli-chiavi-hub.ts`).
 *
 * Due modi, dichiarati sempre a mano, mai dedotti:
 * - `--copia`: `--dati` è una copia; vale la guardia delle copie
 *   (`guardia-copia.ts`), che non lascia toccare la cartella del servizio;
 * - `--servizio <unità>`: `--dati` sono i dati veri di quell'unità, e si
 *   lavora solo a servizio fermo. «Fermo» si legge da `systemctl show`
 *   (LoadState e ActiveState), non da `is-active`: per un'unità che non esiste
 *   `is-active` dice «inactive», come un servizio fermo, e un nome sbagliato
 *   farebbe scrivere col servizio acceso. Tre esiti: fermo, attivo, non so;
 *   solo «fermo» lascia scrivere. Fermi anche il timer dell'aggiornamento
 *   (`<app>-update.timer`, hub e cliente A) e il servizio che lancia
 *   (`<app>-update.service`): in quei minuti farebbero pull e build sotto lo
 *   script, e un aggiornamento già partito riavvia il servizio alla fine.
 *   I nomi si ricavano dal nome dell'app senza `.service` (`unitaDelServizio`).
 *
 * Modulo puro (solo moduli di node e la guardia delle copie): gli script lo
 * importano staticamente PRIMA di toccare l'ambiente e di caricare i moduli
 * del database.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { percorsoReale } from "./guardia-copia";

export type StatoUnita =
  | { stato: "fermo" }
  | { stato: "attivo"; dettaglio: string }
  | { stato: "assente" }
  | { stato: "non_so"; motivo: string };

const ATTIVI = new Set(["active", "activating", "deactivating", "reloading", "refreshing"]);
const FERMI = new Set(["inactive", "failed"]);

/** Legge l'esito di `systemctl show <unità> -p LoadState -p ActiveState`. Non lancia. */
export function leggiStatoSystemctl(esito: { status: number | null; stdout: string; error?: Error }): StatoUnita {
  if (esito.error) return { stato: "non_so", motivo: `systemctl non risponde: ${esito.error.message}` };
  if (esito.status !== 0) return { stato: "non_so", motivo: `systemctl è uscito con ${esito.status}` };
  const campi = new Map<string, string>();
  for (const riga of esito.stdout.split("\n")) {
    const m = /^([A-Za-z]+)=(.*)$/.exec(riga.trim());
    if (m) campi.set(m[1], m[2]);
  }
  const load = campi.get("LoadState");
  const active = campi.get("ActiveState");
  if (!load || !active) return { stato: "non_so", motivo: "systemctl non ha detto LoadState e ActiveState" };
  if (load === "not-found") return { stato: "assente" };
  if (load !== "loaded") return { stato: "non_so", motivo: `LoadState=${load}` };
  if (FERMI.has(active)) return { stato: "fermo" };
  if (ATTIVI.has(active)) return { stato: "attivo", dettaglio: active };
  return { stato: "non_so", motivo: `ActiveState=${active}` };
}

/** Un nome d'unità systemd, senza opzioni, spazi né percorsi. */
export function nomeUnitaValido(nome: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9@._-]{0,127}$/.test(nome);
}

/**
 * Le unità da guardare per `--servizio <nome>`: il servizio, il timer
 * dell'aggiornamento e il servizio che il timer lancia, coi nomi che dà loro
 * `install.sh` (`<app>`, `<app>-update.timer`, `<app>-update.service`). Il
 * nome si accetta con o senza `.service`, come fa systemctl, e il timer si
 * ricava dal nome SENZA il suffisso. Un altro suffisso o un punto nel nome:
 * null, non si indovina.
 *
 * Perché (revisione della 2g, 16/10): il timer si ricavava come
 * `${unità}-update.timer`, quindi con `--servizio da-ipam.service` la guardia
 * guardava `da-ipam.service-update.timer`, che non esiste, e lasciava
 * scrivere col vero `da-ipam-update.timer` acceso.
 */
export function unitaDelServizio(nome: string): { servizio: string; timer: string; aggiornamento: string } | null {
  if (!nomeUnitaValido(nome)) return null;
  const app = nome.endsWith(".service") ? nome.slice(0, -".service".length) : nome;
  if (app.includes(".")) return null;
  return { servizio: `${app}.service`, timer: `${app}-update.timer`, aggiornamento: `${app}-update.service` };
}

function descriviStato(s: StatoUnita): string {
  if (s.stato === "fermo") return "fermo";
  if (s.stato === "attivo") return `acceso (${s.dettaglio})`;
  if (s.stato === "assente") return "non c'è";
  return `non si sa (${s.motivo})`;
}

export function statoUnita(unita: string): StatoUnita {
  const r = spawnSync("systemctl", ["show", unita, "-p", "LoadState", "-p", "ActiveState"], { encoding: "utf8", timeout: 15_000 });
  return leggiStatoSystemctl({ status: r.status, stdout: r.stdout ?? "", error: r.error });
}

export interface EsitoDatiVeri {
  /** I motivi per non scrivere (vuoto = si può). */
  errori: string[];
  /** Le unità guardate col loro stato, da stampare: si vede quale timer si è controllato. */
  controllate: string[];
}

/**
 * Si può scrivere sui dati veri del servizio `unita`? `cartelle`: le cartelle
 * dati del servizio (`cartelleServizio`); `--dati` deve essere una di loro.
 * `leggi`: lo stato di un'unità (le prove lo sostituiscono).
 *
 * Il timer che non c'è passa solo se non c'è nemmeno il servizio
 * dell'aggiornamento (nessun aggiornamento automatico con quel nome): se il
 * servizio dell'aggiornamento c'è, il timer ha un altro nome e non si sa se è
 * fermo.
 */
export function controllaDatiVeri(
  p: { dati: string; unita: string; cartelle: readonly string[] },
  leggi: (unita: string) => StatoUnita = statoUnita,
): EsitoDatiVeri {
  const u = unitaDelServizio(p.unita);
  if (!u) {
    return {
      errori: [`--servizio «${p.unita}» non è il nome di un servizio: si scrive il nome dell'app, con o senza .service (per esempio da-ipam o da-ipam.service)`],
      controllate: [],
    };
  }
  const errori: string[] = [];
  const s = leggi(u.servizio);
  const t = leggi(u.timer);
  const g = leggi(u.aggiornamento);
  const controllate = [`${u.servizio}: ${descriviStato(s)}`, `${u.timer}: ${descriviStato(t)}`, `${u.aggiornamento}: ${descriviStato(g)}`];
  if (s.stato === "attivo") errori.push(`il servizio ${u.servizio} è acceso (${s.dettaglio}): fermalo prima (systemctl stop ${u.servizio})`);
  else if (s.stato === "assente") errori.push(`l'unità ${u.servizio} non esiste: non si può dire che il servizio sia fermo`);
  else if (s.stato === "non_so") errori.push(`non si sa se il servizio ${u.servizio} è fermo (${s.motivo}): niente scritto`);
  if (t.stato === "attivo") errori.push(`il timer ${u.timer} è acceso: fermalo prima (systemctl stop ${u.timer}), farebbe pull e build sotto lo script`);
  else if (t.stato === "non_so") errori.push(`non si sa se il timer ${u.timer} è fermo (${t.motivo})`);
  else if (t.stato === "assente" && g.stato !== "assente") {
    errori.push(`il timer ${u.timer} non esiste ma ${u.aggiornamento} sì: il timer dell'aggiornamento ha un altro nome e non si sa se è fermo`);
  }
  if (g.stato === "attivo") errori.push(`l'aggiornamento ${u.aggiornamento} è in corso (${g.dettaglio}): aspetta che finisca, alla fine riavvia il servizio`);
  else if (g.stato === "non_so") errori.push(`non si sa se l'aggiornamento ${u.aggiornamento} è fermo (${g.motivo})`);

  let dati: string;
  try {
    dati = fs.realpathSync(path.resolve(p.dati));
  } catch {
    return { errori: [...errori, `La cartella --dati non esiste: ${p.dati}`], controllate };
  }
  if (!p.cartelle.some((c) => percorsoReale(c) === dati)) {
    errori.push(`--dati (${dati}) non è la cartella dati del servizio (${p.cartelle.join(", ") || "nessuna"}): sui dati veri si passa quella`);
  }
  if (!fs.existsSync(path.join(dati, "hub.db")) || !fs.existsSync(path.join(dati, "tenants"))) {
    errori.push(`--dati non sembra una cartella dati: mancano hub.db o tenants/ (${dati})`);
  }
  return { errori, controllate };
}

/** Lettore delle conferme scritte da stdin, una riga per domanda. A stdin chiuso la risposta è null (= non confermato). */
export function lettoreConferme(): { chiedi: (domanda: string) => Promise<string | null>; chiudi: () => void } {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const righe = rl[Symbol.asyncIterator]();
  return {
    chiedi: async (domanda: string) => {
      process.stdout.write(domanda);
      const r = await righe.next();
      process.stdout.write("\n");
      return r.done ? null : String(r.value).trim();
    },
    chiudi: () => rl.close(),
  };
}

/** Il valore di un'opzione (`""` se scritta senza valore, undefined se assente). */
export function valoreOpzione(a: readonly string[], k: string): string | undefined {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? "") : undefined;
}

/**
 * La prima opzione che lo script non conosce, o null. `conValore`: le opzioni
 * seguite da un valore; `senzaValore`: gli interruttori. Un'opzione scritta
 * male o tolta non si ignora: ignorata, lo script girerebbe senza quello che
 * chi l'ha scritta credeva di chiedere (revisione della 2g, 16/10: `--dal`).
 */
export function opzioneSconosciuta(a: readonly string[], conValore: readonly string[], senzaValore: readonly string[]): string | null {
  for (let i = 0; i < a.length; i++) {
    if (conValore.includes(a[i])) i++;
    else if (!senzaValore.includes(a[i])) return a[i];
  }
  return null;
}

/** Tutti i valori di un'opzione ripetibile; un'opzione scritta senza valore vale "" (errore per chi la legge). */
export function valoriOpzione(a: readonly string[], k: string): string[] {
  const out: string[] = [];
  a.forEach((x, i) => {
    if (x === k) out.push(a[i + 1] ?? "");
  });
  return out;
}

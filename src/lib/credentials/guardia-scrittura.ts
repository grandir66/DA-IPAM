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
 *   solo «fermo» lascia scrivere. Anche il timer dell'aggiornamento
 *   (`<unità>-update.timer`, cliente A) deve essere fermo o assente: in quei
 *   minuti farebbe pull e build sotto lo script.
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

export function statoUnita(unita: string): StatoUnita {
  const r = spawnSync("systemctl", ["show", unita, "-p", "LoadState", "-p", "ActiveState"], { encoding: "utf8", timeout: 15_000 });
  return leggiStatoSystemctl({ status: r.status, stdout: r.stdout ?? "", error: r.error });
}

/**
 * I motivi per non scrivere sui dati veri di `unita` (vuoto = si può).
 * `cartelle`: le cartelle dati del servizio (`cartelleServizio`); `--dati`
 * deve essere una di loro. `leggi`: lo stato di un'unità (le prove lo
 * sostituiscono).
 */
export function controllaDatiVeri(
  p: { dati: string; unita: string; cartelle: readonly string[] },
  leggi: (unita: string) => StatoUnita = statoUnita,
): string[] {
  if (!nomeUnitaValido(p.unita)) return [`--servizio «${p.unita}» non è un nome d'unità`];
  const errori: string[] = [];
  const s = leggi(p.unita);
  if (s.stato === "attivo") errori.push(`il servizio ${p.unita} è acceso (${s.dettaglio}): fermalo prima (systemctl stop ${p.unita})`);
  else if (s.stato === "assente") errori.push(`l'unità ${p.unita} non esiste: non si può dire che il servizio sia fermo`);
  else if (s.stato === "non_so") errori.push(`non si sa se il servizio ${p.unita} è fermo (${s.motivo}): niente scritto`);
  const timer = `${p.unita}-update.timer`;
  const t = leggi(timer);
  if (t.stato === "attivo") errori.push(`il timer ${timer} è acceso: fermalo prima (systemctl stop ${timer}), farebbe pull e build sotto lo script`);
  else if (t.stato === "non_so") errori.push(`non si sa se il timer ${timer} è fermo (${t.motivo})`);

  let dati: string;
  try {
    dati = fs.realpathSync(path.resolve(p.dati));
  } catch {
    return [...errori, `La cartella --dati non esiste: ${p.dati}`];
  }
  if (!p.cartelle.some((c) => percorsoReale(c) === dati)) {
    errori.push(`--dati (${dati}) non è la cartella dati del servizio (${p.cartelle.join(", ") || "nessuna"}): sui dati veri si passa quella`);
  }
  if (!fs.existsSync(path.join(dati, "hub.db")) || !fs.existsSync(path.join(dati, "tenants"))) {
    errori.push(`--dati non sembra una cartella dati: mancano hub.db o tenants/ (${dati})`);
  }
  return errori;
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

/** Tutti i valori di un'opzione ripetibile; un'opzione scritta senza valore vale "" (errore per chi la legge). */
export function valoriOpzione(a: readonly string[], k: string): string[] {
  const out: string[] = [];
  a.forEach((x, i) => {
    if (x === k) out.push(a[i + 1] ?? "");
  });
  return out;
}

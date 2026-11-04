/**
 * Dai profili agli argomenti di nmap. Funzioni **pure**: nessun processo,
 * nessuna rete, nessun database — si provano senza avere nmap installato.
 *
 * Due invocazioni separate per host, TCP e UDP, come nel resto del codice
 * (`nmap.ts`): mai `-sT` e `-sU` nello stesso comando, in molti ambienti va in
 * errore.
 */
import type { ProfiloScansione } from "./tipi";
import { SCRIPT_VIETATI } from "./profili";

/** Tetto al singolo script: `mqtt-subscribe` resta in ascolto, `ssl-cert` su una porta muta aspetta. */
const SCRIPT_TIMEOUT_S = 20;

export class ScriptVietatoError extends Error {
  constructor(script: string) {
    super(`Script NSE vietato in un profilo di scansione: ${script} (categoria intrusive o exploit)`);
    this.name = "ScriptVietatoError";
  }
}

/**
 * Gli script di un profilo per un protocollo, filtrati su quelli davvero
 * presenti sulla macchina.
 *
 * Perche' il filtro e' obbligatorio: nmap con un nome di script che non esiste
 * **aborta tutta la scansione**, non salta lo script. Il comando che Riccardo
 * aveva in mano il 04/11 citava `bacnet-discover`, che non esiste (e' `bacnet-info`):
 * non avrebbe scansionato niente, senza che il motivo fosse evidente.
 *
 * @param disponibili script presenti sulla macchina (da `scriptDisponibili()`);
 *   `null` = non si e' potuto leggere l'elenco, allora si passano tutti e nmap
 *   dira' la sua (meglio un errore leggibile che un profilo silenziosamente vuoto).
 */
export function scriptPerProtocollo(
  profilo: ProfiloScansione,
  protocollo: "tcp" | "udp",
  disponibili: ReadonlySet<string> | null
): string[] {
  const set = new Set<string>();
  for (const regola of profilo.regole) {
    if (regola.protocollo !== protocollo) continue;
    for (const s of regola.script) {
      if (SCRIPT_VIETATI.includes(s)) throw new ScriptVietatoError(s);
      if (disponibili && !disponibili.has(s)) continue;
      set.add(s);
    }
  }
  return [...set].sort();
}

/** Gli script che un profilo cita ma che sulla macchina non ci sono: vanno detti, non nascosti. */
export function scriptMancanti(profilo: ProfiloScansione, disponibili: ReadonlySet<string> | null): string[] {
  if (!disponibili) return [];
  const set = new Set<string>();
  for (const regola of profilo.regole) {
    for (const s of regola.script) if (!disponibili.has(s)) set.add(s);
  }
  return [...set].sort();
}

function elencoPorte(porte: readonly number[]): string {
  return [...new Set(porte.filter((p) => Number.isFinite(p) && p > 0))].sort((a, b) => a - b).join(",");
}

export interface OpzioniComando {
  /** `-O` funziona solo con raw socket: senza privilegi nmap va in errore. */
  privilegi: boolean;
  disponibili: ReadonlySet<string> | null;
}

/**
 * Fase TCP di un profilo. Senza privilegi `-O` si omette: il profilo degrada e
 * lo dice (lezione #6 — niente ripieghi muti), non fallisce.
 */
export function argomentiTcp(profilo: ProfiloScansione, opts: OpzioniComando): string[] {
  const script = scriptPerProtocollo(profilo, "tcp", opts.disponibili);
  const args = [
    "-Pn",
    "-sT",
    "-p",
    elencoPorte(profilo.tcp),
    "-sV",
    "--version-intensity",
    String(profilo.versionIntensity),
  ];
  if (profilo.osDetection && opts.privilegi) args.push("-O", "--osscan-limit");
  if (script.length > 0) {
    args.push("--script", script.join(","), "--script-timeout", `${SCRIPT_TIMEOUT_S}s`);
  }
  args.push("-T4", "--max-retries", "1", "--min-rate", "200", "--host-timeout", `${profilo.hostTimeoutS}s`);
  return args;
}

/**
 * Fase UDP di un profilo. `-sU` vuole privilegi: senza, `null` — la fase si
 * salta e il motore lo scrive nel registro, invece di provare e fallire muta.
 */
export function argomentiUdp(profilo: ProfiloScansione, opts: OpzioniComando): string[] | null {
  if (!opts.privilegi) return null;
  if (profilo.udp.length === 0) return null;
  const script = scriptPerProtocollo(profilo, "udp", opts.disponibili);
  const args = ["-Pn", "-sU", "-p", elencoPorte(profilo.udp), "-sV", "--version-intensity", String(profilo.versionIntensity)];
  if (script.length > 0) {
    args.push("--script", script.join(","), "--script-timeout", `${SCRIPT_TIMEOUT_S}s`);
  }
  args.push("-T4", "--max-retries", "2", "--min-rate", "40", "--host-timeout", `${profilo.hostTimeoutS}s`);
  return args;
}

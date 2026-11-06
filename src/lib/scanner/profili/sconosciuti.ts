/**
 * Riconoscimento automatico degli host `unknown` (06/11/2026, Riccardo: «il profilo con -O parte da solo»).
 *
 * I profili partono a mano; così `-O`, che al 72729 dice «Cisco SG200 or SG300 switch», non girava mai sugli host che
 * ne avrebbero bisogno. Qui un giro notturno piccolo, **spento di serie** per cliente.
 *
 * La prova che conta è chi resta fuori. `-O` manda pacchetti malformati: su un PLC vecchio è la parte che può fare
 * danno (il profilo IoT/OT lo tiene spento per questo) e il 05/11 al 72729 le stampanti hanno stampato. Si salta nel
 * dubbio: un host in più `unknown` costa meno di un apparato di campo fermo.
 */
import type Database from "better-sqlite3";
import { getTenantDb, getTenantSetting } from "@/lib/db-tenant";
import { isScanInCorso, prendiRete } from "@/lib/scanner/network-scan-lock";
import { eseguiProfilo, type EsitoProfilo } from "./motore";
import { PROFILO_APPROFONDITO } from "./profili";
import { salvaEsitoProfilo } from "./salva";
import type { ProfiloScansione } from "./tipi";

export const CHIAVE_RICONOSCIMENTO = "riconoscimento.sconosciuti";
export const GIORNI_TRA_I_TENTATIVI = 30;
/** Un errore non è una risposta: si riprova presto, ma non ogni notte. */
export const GIORNI_DOPO_UN_ERRORE = 3;
export const HOST_PER_GIRO = 10;

/** Porte di campo (profilo IoT/OT) e di stampa (raw, IPP, LPD): chi le ha aperte non riceve `-O`. */
const PORTE_DA_NON_TOCCARE = new Set([102, 502, 515, 631, 1883, 2404, 4840, 8883, 9100, 9600, 18245, 18246, 19999, 20000, 44818]);

/**
 * Produttori di apparati di campo. Microchip c'è per i moduli Ethernet dentro gli apparati (19 `unknown` al 72729):
 * dal MAC non si sa cosa c'è attorno, quindi si tratta come campo.
 */
const PRODUTTORE_DI_CAMPO =
  /schneider|siemens|rockwell|allen[- ]?bradley|phoenix contact|wago|beckhoff|omron|mitsubishi|moxa|hms industrial|sollae|advantech|weidm|turck|festo|yokogawa|honeywell|emerson|lantronix|microchip|\babb\b/i;

/** Produttori di stampanti: la 9100 può non essere fra le porte note. HP resta qui anche se fa PC e switch: nel dubbio si salta. */
const PRODUTTORE_DI_STAMPANTI =
  /\bhp\b|hewlett|canon|brother|ricoh|kyocera|xerox|epson|lexmark|konica|sharp|oki data|zebra|toshiba tec/i;

export const PROFILO_RICONOSCIMENTO: ProfiloScansione = {
  ...PROFILO_APPROFONDITO,
  id: "riconoscimento",
  nome: "Riconoscimento automatico",
  descrizione: "Come Approfondito, senza UDP, senza porte di campo e senza la 9100: gira da solo sugli host unknown.",
  tcp: PROFILO_APPROFONDITO.tcp.filter((p) => !PORTE_DA_NON_TOCCARE.has(p)),
  udp: [],
  regole: PROFILO_APPROFONDITO.regole
    .filter((r) => r.protocollo === "tcp")
    .map((r) => ({ ...r, porte: r.porte.filter((p) => !PORTE_DA_NON_TOCCARE.has(p)) }))
    .filter((r) => r.porte.length > 0),
};

export interface HostSconosciuto {
  id: number;
  ip: string;
  network_id: number;
}

function porteAperte(json: string | null): number[] {
  try {
    const v: unknown = JSON.parse(json ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.map((p: { port?: unknown }) => Number(p?.port)).filter((n) => Number.isInteger(n));
  } catch {
    return [];   // JSON rotto: nessuna porta nota, e l'host resta fuori
  }
}

export function scegliSconosciuti(d: Database.Database): HostSconosciuto[] {
  const candidati = d.prepare(
    `SELECT h.id, h.ip, h.network_id, h.open_ports, h.vendor, h.device_manufacturer
     FROM hosts h LEFT JOIN riconoscimento_tentativi t ON t.host_id = h.id
     WHERE COALESCE(NULLIF(h.classification, ''), 'unknown') = 'unknown'
       AND COALESCE(h.classification_manual, 0) = 0
       AND h.status = 'online'
       AND (t.ultimo_il IS NULL OR t.ultimo_il < datetime('now', CASE WHEN t.esito LIKE 'errore%' THEN ? ELSE ? END))
     ORDER BY t.ultimo_il IS NOT NULL, t.ultimo_il, h.id`,
  ).all(`-${GIORNI_DOPO_UN_ERRORE} days`, `-${GIORNI_TRA_I_TENTATIVI} days`) as Array<HostSconosciuto & {
    open_ports: string | null; vendor: string | null; device_manufacturer: string | null;
  }>;

  const scelti: HostSconosciuto[] = [];
  for (const c of candidati) {
    if (scelti.length >= HOST_PER_GIRO) break;
    const porte = porteAperte(c.open_ports);
    if (porte.length === 0 || porte.some((p) => PORTE_DA_NON_TOCCARE.has(p))) continue;
    const produttore = `${c.vendor ?? ""} ${c.device_manufacturer ?? ""}`;
    if (PRODUTTORE_DI_CAMPO.test(produttore) || PRODUTTORE_DI_STAMPANTI.test(produttore)) continue;
    scelti.push({ id: c.id, ip: c.ip, network_id: c.network_id });
  }
  return scelti;
}

export interface EsitoGiroSconosciuti {
  provati: number;
  campiRiempiti: number;
  retiOccupate: number;
  retiInErrore: number;
}

type Esecutore = (profilo: ProfiloScansione, ips: string[]) => Promise<EsitoProfilo>;

/** Una rete già in scansione si salta senza segnare tentativi: la prossima notte tocca di nuovo a lei. */
export async function giroSconosciuti(tenantCode: string, esegui: Esecutore = eseguiProfilo): Promise<EsitoGiroSconosciuti> {
  const esito: EsitoGiroSconosciuti = { provati: 0, campiRiempiti: 0, retiOccupate: 0, retiInErrore: 0 };
  if (getTenantSetting(CHIAVE_RICONOSCIMENTO) !== "1") return esito;
  const d = getTenantDb(tenantCode);

  const perRete = new Map<number, HostSconosciuto[]>();
  for (const h of scegliSconosciuti(d)) perRete.set(h.network_id, [...(perRete.get(h.network_id) ?? []), h]);

  const segna = d.prepare(
    `INSERT INTO riconoscimento_tentativi (host_id, ultimo_il, esito) VALUES (?, datetime('now'), ?)
     ON CONFLICT(host_id) DO UPDATE SET ultimo_il = excluded.ultimo_il, esito = excluded.esito`,
  );
  for (const [networkId, host] of perRete) {
    let rilascia: () => void;
    try {
      rilascia = prendiRete(tenantCode, networkId, { scanId: `riconoscimento-${networkId}-${Date.now()}`, scanType: "profilo_riconoscimento" });
    } catch (e) {
      if (isScanInCorso(e)) {
        esito.retiOccupate++;
        continue;
      }
      throw e;
    }
    try {
      const giro = await esegui(PROFILO_RICONOSCIMENTO, host.map((h) => h.ip));
      const salvato = salvaEsitoProfilo(giro, new Map(host.map((h) => [h.ip, h.id])));
      esito.campiRiempiti += salvato.campiRiempiti;
      /* Senza privilegi `-O` non parte: questi host non sono stati provati, e il giro lo dice invece di bruciarli per 30 giorni. */
      if (giro.osDetectionSaltata) {
        console.warn(`[riconoscimento] ${tenantCode}: -O saltato, il processo non ha i privilegi per i raw socket`);
        continue;
      }
      for (const h of host) {
        const riga = giro.host.find((x) => x.ip === h.ip);
        segna.run(h.id, riga?.errori.length ? `errore: ${riga.errori.join("; ")}`.slice(0, 200) : "ok");
        esito.provati++;
      }
    } catch (e) {
      /* Un guasto di questa rete non ferma le altre, e i suoi host si segnano: senza, la notte dopo si riprenderebbero gli stessi. */
      const testo = e instanceof Error ? e.message : String(e);
      console.warn(`[riconoscimento] ${tenantCode}: rete ${networkId} non provata: ${testo}`);
      esito.retiInErrore++;
      for (const h of host) segna.run(h.id, `errore: ${testo}`.slice(0, 200));
    } finally {
      rilascia();
    }
  }
  return esito;
}

/**
 * Ricognizione delicata (Riccardo, 06/11/2026): la prima scansione di una rete, per sapere cosa c'è
 * prima di decidere quanto toccarlo.
 *
 * Due tempi. Prima ciò che non costa niente ai device: chi risponde al ping, ARP e DHCP dal router,
 * costruttore dal MAC, annunci del trunk. Poi solo le porte, lentamente e un host alla volta, e solo
 * su chi ha un costruttore noto e non di campo: gli altri restano ai dati passivi e la pagina dice
 * perché. Nel dubbio si scende: un host senza costruttore non riceve TCP.
 *
 * Decisione di Riccardo, piano `DA-Vul-can/docs/superpowers/plans/2026-11-06-profili-per-device.md`.
 */
import { getDb, getHostsByNetwork } from "@/lib/db";
import { recomputeAttributionSafe } from "@/lib/attribution/recompute";
import { eImpianto, type HostPerImpianti } from "@/lib/vuln/impianti-in-rete";
import { aggiornaProgresso, dimenticaGiro, registraProgresso, type AvvioDiscovery, type EsitoGiro } from "@/lib/scanner/discovery";
import { conSegnaleGiro, controllaFermo, registraGiroFermabile, TESTO_GIRO_FERMATO } from "@/lib/scanner/ferma-giro";
import { prendiRete } from "@/lib/scanner/network-scan-lock";
import { withTenant } from "@/lib/db-tenant";
import { eseguiProfilo, type EsitoProfilo } from "./motore";
import { PROFILO_RICONOSCIMENTO } from "./sconosciuti";
import type { ProfiloScansione } from "./tipi";
import type { ScanProgress } from "@/types";

export const PROFILO_RICOGNIZIONE: ProfiloScansione = {
  id: "ricognizione",
  nome: "Ricognizione delicata",
  descrizione: "Solo porte aperte, lentamente e un host alla volta: niente versioni, sistema operativo né script.",
  tcp: PROFILO_RICONOSCIMENTO.tcp,
  udp: [],
  regole: [],
  osDetection: false,
  versionIntensity: 0,
  tettoByteOutput: 0,
  hostTimeoutS: 120,
  delicata: true,
};

export type MotivoPassivo = "impianto" | "senza_costruttore";

export interface SceltaRicognizione {
  daProvare: string[];
  passivi: Array<{ ip: string; motivo: MotivoPassivo }>;
}

type HostScelta = HostPerImpianti & { status?: string | null };

function haCostruttore(h: HostScelta): boolean {
  return [h.vendor, h.device_manufacturer, h.inferred_vendor, h.attr_vendor_name].some((v) => !!(v ?? "").trim());
}

/** Chi riceve le porte e chi resta ai dati passivi. Gli host spenti non si contano. */
export function scegliRicognizione(hosts: readonly HostScelta[]): SceltaRicognizione {
  const scelta: SceltaRicognizione = { daProvare: [], passivi: [] };
  for (const h of hosts) {
    if (h.status === "offline") continue;
    if (eImpianto(h)) scelta.passivi.push({ ip: h.ip, motivo: "impianto" });
    else if (!haCostruttore(h)) scelta.passivi.push({ ip: h.ip, motivo: "senza_costruttore" });
    else scelta.daProvare.push(h.ip);
  }
  return scelta;
}

interface PortaSalvata {
  port: number;
  protocol: string;
  service?: string | null;
  version?: string | null;
}

function leggiPorte(json: string | null | undefined): PortaSalvata[] {
  if (!json) return [];
  try {
    const p: unknown = JSON.parse(json);
    return Array.isArray(p) ? (p as PortaSalvata[]) : [];
  } catch {
    return [];
  }
}

/** Le porte nuove si aggiungono: una riga con la versione letta da un giro precedente non si perde. */
export function unisciPorte(note: readonly PortaSalvata[], nuove: readonly PortaSalvata[]): PortaSalvata[] {
  const chiave = (p: PortaSalvata) => `${p.protocol}/${p.port}`;
  const viste = new Set(note.map(chiave));
  return [...note, ...nuove.filter((p) => !viste.has(chiave(p)))];
}

/** Il profilo salva script e campi, non le porte: alla proposta servono. */
function salvaPorte(esito: EsitoProfilo, hostPerIp: ReadonlyMap<string, number>): number {
  const db = getDb();
  const leggi = db.prepare("SELECT open_ports FROM hosts WHERE id = ?");
  const scrivi = db.prepare("UPDATE hosts SET open_ports = ?, updated_at = datetime('now') WHERE id = ?");
  let conPorte = 0;
  for (const h of esito.host) {
    const id = hostPerIp.get(h.ip);
    if (id == null || !h.risultato || h.risultato.ports.length === 0) continue;
    const riga = leggi.get(id) as { open_ports: string | null } | undefined;
    scrivi.run(JSON.stringify(unisciPorte(leggiPorte(riga?.open_ports), h.risultato.ports)), id);
    recomputeAttributionSafe(id);
    conPorte++;
  }
  return conPorte;
}

export async function avviaRicognizione(dati: {
  tenantCode: string;
  networkId: number;
  etichetta: string;
  sequenzaId: string;
}): Promise<AvvioDiscovery> {
  const { tenantCode, networkId, etichetta, sequenzaId } = dati;
  const id = `ricognizione-${networkId}-${Date.now()}`;
  const rilasciaRete = prendiRete(tenantCode, networkId, { scanId: id, scanType: "profilo_ricognizione" });
  const progress: ScanProgress = {
    id,
    network_id: networkId,
    scan_type: "profilo_ricognizione",
    status: "running",
    total: 0,
    scanned: 0,
    found: 0,
    phase: "Costruttori dal router",
    started_at: new Date().toISOString(),
    logs: [],
    tenant_code: tenantCode,
    etichetta,
    link: `/networks/${networkId}`,
    fermabile: true,
    sequenza_id: sequenzaId,
  };
  registraProgresso(progress);
  const { segnale, libera } = registraGiroFermabile(id);

  const righe: string[] = [];
  const scrivi = (m: string) => {
    righe.push(m);
    aggiornaProgresso(id, { logs: [...righe.slice(-200)] });
  };

  const giro = async (): Promise<EsitoGiro> => {
    try {
      // Legge il router, non i device: se non c'è un router si va avanti con ciò che è già noto.
      const { runArpPoll } = await import("@/lib/cron/jobs");
      const arp = await runArpPoll(networkId).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "errore sconosciuto" }));
      if (arp.error) scrivi(`Lettura dal router non riuscita: ${arp.error}`);
      controllaFermo();

      const hosts = getHostsByNetwork(networkId);
      const scelta = scegliRicognizione(hosts);
      const impianti = scelta.passivi.filter((p) => p.motivo === "impianto").length;
      scrivi(`${scelta.daProvare.length} host da provare; ${impianti} impianti e ${scelta.passivi.length - impianti} senza costruttore restano ai dati passivi`);
      const hostPerIp = new Map(hosts.filter((h) => scelta.daProvare.includes(h.ip)).map((h) => [h.ip, h.id]));
      aggiornaProgresso(id, { total: scelta.daProvare.length, phase: `Porte aperte su ${scelta.daProvare.length} host` });

      const esito = await eseguiProfilo(PROFILO_RICOGNIZIONE, scelta.daProvare, { onLog: scrivi });
      controllaFermo();
      const conPorte = salvaPorte(esito, hostPerIp);
      aggiornaProgresso(id, {
        status: "completed",
        scanned: esito.host.length,
        found: conPorte,
        phase: `Ricognizione finita: ${conPorte} host con porte, ${scelta.passivi.length} ai soli dati passivi`,
      });
      return { status: "completed" };
    } catch (e) {
      if (segnale.aborted) {
        aggiornaProgresso(id, { status: "failed", fermato: true, phase: TESTO_GIRO_FERMATO, error: TESTO_GIRO_FERMATO });
        return { status: "failed", error: TESTO_GIRO_FERMATO, fermato: true };
      }
      const error = e instanceof Error ? e.message : "errore sconosciuto";
      aggiornaProgresso(id, { status: "failed", phase: "Ricognizione fallita", error });
      return { status: "failed", error };
    } finally {
      libera();
      dimenticaGiro(id);
      rilasciaRete();
    }
  };

  const done = withTenant(tenantCode, () => conSegnaleGiro(segnale, giro));
  return { id, progress, done };
}

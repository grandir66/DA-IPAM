/**
 * Lancia un giro dal tipo + profilo. I motori restano quelli già fatti.
 */
import { addScanHistory, getCurrentTenantCode, getNetworkById, setTenantSetting, withTenant } from "@/lib/db-tenant";
import { avviaGiro } from "@/lib/servizi-rete/giro";
import { avviaGiroSeg } from "@/lib/segmentazione/giro";
import { sincronizzaTrunk } from "@/lib/trunk/sensore-trunk";
import { discoverNetwork } from "@/lib/scanner/discovery";
import { isScanInCorso } from "@/lib/scanner/network-scan-lock";
import { haPrivilegi } from "@/lib/scanner/profili/motore";
import {
  eProfiloGiro,
  eTipoGiro,
  fasiValide,
  parametriProfilo,
  type FaseGiro,
  type ProfiloGiro,
  type ProtocolloSeg,
  type ScanModeGiro,
  type TipoGiro,
} from "./profili-giro";
import {
  DURATA_S_MAX,
  DURATA_S_MIN,
  ErroreLancio,
  RATE_PPS_MAX,
  RATE_PPS_MIN,
  RETRIES_MAX,
  RETRIES_MIN,
  booleanoOpzionale,
  interoNelRange,
  ipPerRete,
  leggiIdReti,
  leggiPorteGiro,
  leggiProtocolloSeg,
  leggiScanMode,
  leggiSrcPort,
  parseBersagliTesto,
  rifiutaTecnicheAuditor,
  tokenCopreRete,
  type PorteGiroLette,
} from "./opzioni-giro";

export { ErroreLancio };

export interface LancioGiro {
  tipo: string;
  profilo: string;
  network_ids?: number[];
  fasi?: string[];
  conferma_completo?: boolean;
  /** Login di fabbrica: solo se true, e solo da questo lanciatore. */
  prove_fabbrica?: boolean;
  timeout_ms?: number;
  concorrenza?: number;
  targets?: string;
  exclusions?: string;
  auto_targets?: boolean;
  tcp_ports?: string;
  udp_ports?: string;
  scan_mode?: string;
  rate_pps?: number;
  retries?: number;
  source_network_id?: number;
  reti_bersaglio?: number[];
  protocollo?: string;
  src_port?: number[];
  via_local_gateway?: boolean;
  via_other_next_hop?: boolean;
  l2_active?: boolean;
  conferma_l2?: boolean;
  durata_s?: number;
}

const TIMEOUT_MS_MIN = 500;
const TIMEOUT_MS_MAX = 60_000;
const CONCORRENZA_MIN = 1;
const CONCORRENZA_MAX = 256;

export interface LancioLetto {
  tipo: TipoGiro;
  profilo: ProfiloGiro;
  reti: number[];
  fasi: FaseGiro[];
  timeoutMs?: number;
  concorrenza?: number;
  autoTargets: boolean;
  bersagli: string[];
  esclusioni: string[];
  tcp?: PorteGiroLette;
  udp?: PorteGiroLette;
  scanMode?: ScanModeGiro;
  ratePps?: number;
  retries?: number;
  sourceNetworkId?: number;
  retiBersaglio: number[];
  protocollo: ProtocolloSeg;
  srcPort: number[];
  viaLocalGateway?: boolean;
  viaOtherNextHop?: boolean;
  l2Active?: boolean;
  confermaL2?: boolean;
  durataS?: number;
}

export interface AvvioGiro {
  network_id: number | null;
  job_id: string | null;
  messaggio: string;
}

export interface EsitoLancio {
  avvii: AvvioGiro[];
  saltati: Array<{ network_id: number | null; motivo: string }>;
  tipo: TipoGiro;
  profilo: ProfiloGiro;
}

export interface DipendenzeLancio {
  discovery: typeof discoverNetwork;
  servizi: typeof avviaGiro;
  segmentazione: typeof avviaGiroSeg;
  accendiTrunk: () => void;
  syncTrunk: typeof sincronizzaTrunk;
  rete: typeof getNetworkById;
  history: typeof addScanHistory;
  tenant: () => string | null;
  privilegi: () => boolean;
  attendi: (ms: number) => Promise<void>;
  inTenant: (codice: string, lavoro: () => Promise<void>) => Promise<void>;
}

const DIP: DipendenzeLancio = {
  discovery: discoverNetwork,
  servizi: avviaGiro,
  segmentazione: avviaGiroSeg,
  accendiTrunk: () => setTenantSetting("trunk_lettura", "1"),
  syncTrunk: sincronizzaTrunk,
  rete: getNetworkById,
  history: addScanHistory,
  tenant: getCurrentTenantCode,
  privilegi: haPrivilegi,
  attendi: (ms) => new Promise((r) => setTimeout(r, ms)),
  inTenant: (codice, lavoro) => withTenant(codice, lavoro),
};

export function leggiLancio(corpo: LancioGiro): LancioLetto {
  if (!eTipoGiro(corpo.tipo)) throw new ErroreLancio("Tipo di giro sconosciuto");
  if (!eProfiloGiro(corpo.profilo)) throw new ErroreLancio("Profilo sconosciuto");
  const confermaTutte = corpo.conferma_completo === true;
  if (corpo.profilo === "completo" && !confermaTutte) {
    throw new ErroreLancio("Completo non parte da solo: conferma che vuoi tutte le 65.535 porte TCP");
  }
  const reti = [...new Set((corpo.network_ids ?? []).filter((n) => Number.isInteger(n) && n > 0))];
  if ((corpo.tipo === "discovery" || corpo.tipo === "controlli") && reti.length === 0) {
    throw new ErroreLancio("Scegli almeno una rete");
  }
  const timeoutMs = interoNelRange(corpo.timeout_ms, "timeout_ms", TIMEOUT_MS_MIN, TIMEOUT_MS_MAX);
  const concorrenza = interoNelRange(corpo.concorrenza, "concorrenza", CONCORRENZA_MIN, CONCORRENZA_MAX);
  const autoTargets = booleanoOpzionale(corpo.auto_targets, "auto_targets") ?? true;
  const bersagli = parseBersagliTesto(corpo.targets, "targets");
  const esclusioni = parseBersagliTesto(corpo.exclusions, "exclusions");
  if (corpo.tipo === "discovery" && autoTargets === false && bersagli.length === 0) {
    throw new ErroreLancio("Senza auto_targets indica almeno un bersaglio");
  }
  const tcp = leggiPorteGiro(corpo.tcp_ports, "tcp_ports", confermaTutte);
  const udp = leggiPorteGiro(corpo.udp_ports, "udp_ports", confermaTutte);
  const scanMode = leggiScanMode(corpo.scan_mode);
  const ratePps = interoNelRange(corpo.rate_pps, "rate_pps", RATE_PPS_MIN, RATE_PPS_MAX);
  const retries = interoNelRange(corpo.retries, "retries", RETRIES_MIN, RETRIES_MAX);
  const sourceNetworkId = interoNelRange(corpo.source_network_id, "source_network_id", 1, 2_147_483_647);
  const retiBersaglio = leggiIdReti(corpo.reti_bersaglio, "reti_bersaglio");
  const protocollo = leggiProtocolloSeg(corpo.protocollo);
  const srcPort = leggiSrcPort(corpo.src_port);
  const viaLocalGateway = booleanoOpzionale(corpo.via_local_gateway, "via_local_gateway");
  const viaOtherNextHop = booleanoOpzionale(corpo.via_other_next_hop, "via_other_next_hop");
  const l2Active = booleanoOpzionale(corpo.l2_active, "l2_active");
  const confermaL2 = booleanoOpzionale(corpo.conferma_l2, "conferma_l2");
  const durataS = interoNelRange(corpo.durata_s, "durata_s", DURATA_S_MIN, DURATA_S_MAX);
  if (corpo.tipo === "segmentazione") {
    rifiutaTecnicheAuditor({
      protocollo,
      srcPort,
      viaLocalGateway,
      viaOtherNextHop,
      l2Active,
      confermaL2,
    });
  }
  return {
    tipo: corpo.tipo,
    profilo: corpo.profilo,
    reti,
    fasi: fasiValide(corpo.fasi),
    timeoutMs,
    concorrenza,
    autoTargets,
    bersagli,
    esclusioni,
    tcp,
    udp,
    scanMode,
    ratePps,
    retries,
    sourceNetworkId,
    retiBersaglio,
    protocollo,
    srcPort,
    viaLocalGateway,
    viaOtherNextHop,
    l2Active,
    confermaL2,
    durataS,
  };
}

function porteDaPreset(preset: string | undefined, udp: boolean): string | null | undefined {
  if (!preset) return undefined;
  if (preset === "all") return null;
  if (preset === "top100") return udp ? parametriProfilo("completo").udpPorts : parametriProfilo("rapido").tcpPorts;
  if (preset === "top1000") return udp ? parametriProfilo("standard").udpPorts : parametriProfilo("standard").tcpPorts;
  return undefined;
}

export async function lanciaGiro(corpo: LancioGiro, dip: Partial<DipendenzeLancio> = {}): Promise<EsitoLancio> {
  const d = { ...DIP, ...dip };
  const letto = leggiLancio(corpo);
  const { tipo, profilo, reti, fasi, timeoutMs, concorrenza } = letto;
  const tenant = d.tenant();
  if (!tenant) throw new ErroreLancio("Nessun tenant scelto", 400);
  const avvii: AvvioGiro[] = [];
  const saltati: EsitoLancio["saltati"] = [];

  if (tipo === "sonda_l2") {
    d.accendiTrunk();
    const registra = async () => {
      const esito = await d.syncTrunk();
      const messaggio = esito.nota ? esito.nota : `${esito.vlan} VLAN, ${esito.osservazioni} osservazioni`;
      d.history({
        host_id: null,
        network_id: null,
        scan_type: "sonda_l2",
        status: `${profilo} · ${messaggio}`,
        ports_open: null,
        raw_output: null,
        duration_ms: letto.durataS != null ? letto.durataS * 1000 : null,
      });
      return messaggio;
    };
    if (letto.durataS == null) {
      try {
        const messaggio = await registra();
        avvii.push({ network_id: null, job_id: null, messaggio });
      } catch (e) {
        throw new ErroreLancio(e instanceof Error ? e.message : "Sensore trunk non letto", 502);
      }
      return { avvii, saltati, tipo, profilo };
    }
    const secondi = letto.durataS;
    void d.inTenant(tenant, async () => {
      try {
        await d.attendi(secondi * 1000);
        await registra();
      } catch (e) {
        console.error("[sonda_l2] ascolto:", e instanceof Error ? e.message : "errore");
      }
    });
    avvii.push({ network_id: null, job_id: null, messaggio: `Ascolto per ${secondi} secondi` });
    return { avvii, saltati, tipo, profilo };
  }

  if (tipo === "segmentazione") {
    if (letto.sourceNetworkId != null && !d.rete(letto.sourceNetworkId)) {
      throw new ErroreLancio("Rete sorgente non trovata");
    }
    const avviato = d.segmentazione(tenant, undefined, {
      sourceNetworkId: letto.sourceNetworkId,
      retiBersaglio: letto.retiBersaglio.length ? letto.retiBersaglio : undefined,
      protocollo: letto.protocollo,
    });
    if (!avviato) throw new ErroreLancio("Un giro di segmentazione è già in corso", 409);
    d.history({
      host_id: null,
      network_id: letto.sourceNetworkId ?? null,
      scan_type: "segmentazione",
      status: "avviato",
      ports_open: null,
      raw_output: null,
      duration_ms: null,
    });
    avvii.push({ network_id: letto.sourceNetworkId ?? null, job_id: null, messaggio: "Matrice di segmentazione avviata" });
    return { avvii, saltati, tipo, profilo };
  }

  const proveFabbrica = corpo.prove_fabbrica === true;
  const opzioniSonde = { proveFabbrica, timeoutMs, concorrenza };

  const vuoleSonde = fasi.includes("sonde");
  const soloSonde = profilo === "su_misura" && !fasi.includes("porte") && vuoleSonde;
  if (tipo === "controlli" || soloSonde) {
    const scope = reti.filter((id) => {
      if (d.rete(id)) return true;
      saltati.push({ network_id: id, motivo: "Rete non trovata" });
      return false;
    });
    if (!scope.length) throw new ErroreLancio("Nessuna rete trovata");
    const networkId = scope.length === 1 ? scope[0]! : null;
    const avviato = d.servizi(tenant, networkId ?? scope, opzioniSonde);
    if (!avviato) throw new ErroreLancio("Un giro delle sonde è già in corso", 409);
    if (tipo === "controlli") {
      d.history({
        host_id: null,
        network_id: networkId,
        scan_type: "controlli",
        status: "avviato",
        ports_open: null,
        raw_output: null,
        duration_ms: null,
      });
    }
    const messaggio = tipo === "controlli" ? "Sonde e identità avviate" : "Solo sonde (senza nmap)";
    for (const id of scope) avvii.push({ network_id: id, job_id: null, messaggio });
    return { avvii, saltati, tipo, profilo };
  }

  if (letto.scanMode === "syn" && !d.privilegi()) {
    throw new ErroreLancio("scan_mode syn richiede privilegi di root sulla macchina");
  }

  const syn = letto.scanMode === "syn";
  const tcpOverride = letto.tcp
    ? { tcpPorts: letto.tcp.preset ? porteDaPreset(letto.tcp.preset, false) : letto.tcp.elenco, tutteLePorteTcp: letto.tcp.tutte }
    : undefined;
  const udpOverride = letto.udp
    ? { udpPorts: letto.udp.vuoto ? "" : letto.udp.preset ? (porteDaPreset(letto.udp.preset, true) ?? "") : (letto.udp.elenco ?? "") }
    : undefined;
  const params = parametriProfilo(profilo, {
    fasi,
    sovrascrivi: {
      ...tcpOverride,
      ...udpOverride,
      maxRate: letto.ratePps,
      retries: letto.retries,
      syn,
    },
  });

  const overrideBersagli = letto.bersagli.length > 0 || letto.esclusioni.length > 0 || letto.autoTargets === false;
  if (overrideBersagli) {
    for (const t of letto.bersagli) {
      if (!reti.some((id) => {
        const rete = d.rete(id);
        return rete ? tokenCopreRete(t, rete.cidr) : false;
      })) {
        throw new ErroreLancio("Un bersaglio è fuori dalle reti scelte");
      }
    }
  }

  for (const id of reti) {
    const rete = d.rete(id);
    if (!rete) {
      saltati.push({ network_id: id, motivo: "Rete non trovata" });
      continue;
    }
    const targetIps = overrideBersagli
      ? ipPerRete({ cidr: rete.cidr, auto: letto.autoTargets, bersagli: letto.bersagli, esclusioni: letto.esclusioni })
      : undefined;
    if (targetIps && targetIps.length === 0) {
      saltati.push({ network_id: id, motivo: "Nessun bersaglio in questa rete" });
      continue;
    }
    try {
      const { id: jobId } = await d.discovery(id, "network_discovery", params.nmapArgs, undefined, {
        tcpPorts: params.tcpPorts,
        udpPorts: params.udpPorts,
        proveFabbrica,
        timeoutMs,
        concorrenza,
        targetIps,
        scanMode: letto.scanMode,
        ratePps: letto.ratePps,
        retries: letto.retries,
        udpDalLancio: letto.udp != null && !letto.udp.vuoto,
      });
      avvii.push({ network_id: id, job_id: jobId, messaggio: `Discovery ${profilo} su ${rete.cidr}` });
    } catch (e) {
      if (isScanInCorso(e)) {
        saltati.push({ network_id: id, motivo: "Una scansione è già in corso su questa rete" });
        continue;
      }
      saltati.push({ network_id: id, motivo: e instanceof Error ? e.message : "Avvio fallito" });
    }
  }
  if (avvii.length === 0) {
    throw new ErroreLancio(saltati[0]?.motivo ?? "Nessuna rete avviata", saltati[0]?.motivo?.includes("già in corso") ? 409 : 400);
  }
  return { avvii, saltati, tipo, profilo };
}

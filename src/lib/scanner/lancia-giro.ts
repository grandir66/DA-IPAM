/**
 * Lancia un giro dal tipo + profilo. I motori restano quelli già fatti.
 */
import { addScanHistory, getCurrentTenantCode, getNetworkById, setTenantSetting } from "@/lib/db-tenant";
import { avviaGiro } from "@/lib/servizi-rete/giro";
import { avviaGiroSeg } from "@/lib/segmentazione/giro";
import { sincronizzaTrunk } from "@/lib/trunk/sensore-trunk";
import { discoverNetwork } from "@/lib/scanner/discovery";
import { isScanInCorso } from "@/lib/scanner/network-scan-lock";
import {
  eProfiloGiro,
  eTipoGiro,
  fasiValide,
  parametriProfilo,
  type FaseGiro,
  type ProfiloGiro,
  type TipoGiro,
} from "./profili-giro";

export class ErroreLancio extends Error {
  readonly status: number;
  constructor(messaggio: string, status = 400) {
    super(messaggio);
    this.status = status;
  }
}

export interface LancioGiro {
  tipo: string;
  profilo: string;
  network_ids?: number[];
  fasi?: string[];
  conferma_completo?: boolean;
  /** Login di fabbrica: solo se true, e solo da questo lanciatore. */
  prove_fabbrica?: boolean;
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
};

export function leggiLancio(corpo: LancioGiro): { tipo: TipoGiro; profilo: ProfiloGiro; reti: number[]; fasi: FaseGiro[] } {
  if (!eTipoGiro(corpo.tipo)) throw new ErroreLancio("Tipo di giro sconosciuto");
  if (!eProfiloGiro(corpo.profilo)) throw new ErroreLancio("Profilo sconosciuto");
  if (corpo.profilo === "completo" && corpo.conferma_completo !== true) {
    throw new ErroreLancio("Completo non parte da solo: conferma che vuoi tutte le 65.535 porte TCP");
  }
  const reti = [...new Set((corpo.network_ids ?? []).filter((n) => Number.isInteger(n) && n > 0))];
  if ((corpo.tipo === "discovery" || corpo.tipo === "controlli") && reti.length === 0) {
    throw new ErroreLancio("Scegli almeno una rete");
  }
  return { tipo: corpo.tipo, profilo: corpo.profilo, reti, fasi: fasiValide(corpo.fasi) };
}

export async function lanciaGiro(corpo: LancioGiro, dip: Partial<DipendenzeLancio> = {}): Promise<EsitoLancio> {
  const d = { ...DIP, ...dip };
  const { tipo, profilo, reti, fasi } = leggiLancio(corpo);
  const tenant = d.tenant();
  if (!tenant) throw new ErroreLancio("Nessun tenant scelto", 400);
  const avvii: AvvioGiro[] = [];
  const saltati: EsitoLancio["saltati"] = [];

  if (tipo === "sonda_l2") {
    d.accendiTrunk();
    try {
      const esito = await d.syncTrunk();
      const messaggio = esito.nota
        ? esito.nota
        : `${esito.vlan} VLAN, ${esito.osservazioni} osservazioni`;
      d.history({
        host_id: null,
        network_id: null,
        scan_type: "sonda_l2",
        status: `${profilo} · ${messaggio}`,
        ports_open: null,
        raw_output: null,
        duration_ms: null,
      });
      avvii.push({ network_id: null, job_id: null, messaggio });
    } catch (e) {
      throw new ErroreLancio(e instanceof Error ? e.message : "Sensore trunk non letto", 502);
    }
    return { avvii, saltati, tipo, profilo };
  }

  if (tipo === "segmentazione") {
    const avviato = d.segmentazione(tenant);
    if (!avviato) throw new ErroreLancio("Un giro di segmentazione è già in corso", 409);
    d.history({
      host_id: null,
      network_id: null,
      scan_type: "segmentazione",
      status: "avviato",
      ports_open: null,
      raw_output: null,
      duration_ms: null,
    });
    avvii.push({ network_id: null, job_id: null, messaggio: "Matrice di segmentazione avviata" });
    return { avvii, saltati, tipo, profilo };
  }

  const proveFabbrica = corpo.prove_fabbrica === true;

  if (tipo === "controlli") {
    const networkId = reti.length === 1 ? reti[0]! : null;
    const avviato = d.servizi(tenant, networkId, { proveFabbrica });
    if (!avviato) throw new ErroreLancio("Un giro delle sonde è già in corso", 409);
    d.history({
      host_id: null,
      network_id: networkId,
      scan_type: "controlli",
      status: "avviato",
      ports_open: null,
      raw_output: null,
      duration_ms: null,
    });
    avvii.push({ network_id: networkId, job_id: null, messaggio: "Sonde e identità avviate" });
    return { avvii, saltati, tipo, profilo };
  }

  const params = parametriProfilo(profilo, { fasi });
  const vuoleSonde = fasi.includes("sonde");
  const vuolePorte = fasi.includes("porte") || profilo !== "su_misura";
  if (profilo === "su_misura" && !vuolePorte && vuoleSonde) {
    const networkId = reti.length === 1 ? reti[0]! : null;
    const avviato = d.servizi(tenant, networkId, { proveFabbrica });
    if (!avviato) throw new ErroreLancio("Un giro delle sonde è già in corso", 409);
    avvii.push({ network_id: networkId, job_id: null, messaggio: "Solo sonde (senza nmap)" });
    return { avvii, saltati, tipo, profilo };
  }

  for (const id of reti) {
    const rete = d.rete(id);
    if (!rete) {
      saltati.push({ network_id: id, motivo: "Rete non trovata" });
      continue;
    }
    try {
      const { id: jobId } = await d.discovery(id, "network_discovery", params.nmapArgs, undefined, {
        tcpPorts: params.tcpPorts,
        udpPorts: params.udpPorts,
        proveFabbrica,
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

/**
 * Lettura e scrittura del punto raggiunto nel wizard (tappa 4 credenziali,
 * 15/10), senza la parte HTTP: la rotta `/api/onboarding/progresso` aggiunge
 * guardia e contesto del cliente.
 *
 * La lettura va chiamata nel contesto del cliente (`withTenant`): controlla
 * che router, rete e integrazione AD salvati ci siano ancora e ne restituisce
 * i dati per riaprire il wizard dov'era. Un oggetto sparito si toglie dal
 * progresso e lo si dice, così il wizard non prova a modificarlo; il passo
 * torna a quello che lo crea (al primo, se sono spariti tutti), invece di
 * riaprire sull'ultimo passo con niente dietro (revisione del 15/10).
 */
import { getSetting, setSetting } from "@/lib/db-hub";
import { getAdIntegrationById, getDeviceCredentialBindings, getNetworkById, getNetworkDeviceById, getNetworkRouterId } from "@/lib/db";
import { vociDelRouter } from "@/lib/devices/binding-apparato";
import { PASSO } from "./passi";
import type { ReteAppliance } from "./rete-appliance";
import { chiaveProgresso, leggiProgresso, scriviProgresso, type ProgressoWizard } from "./progresso";

export interface RouterDelWizard {
  id: number;
  name: string;
  host: string;
  vendor: string;
  protocol: string;
  credential_id: number | null;
  snmp_credential_id: number | null;
}

export interface ReteDelWizard {
  id: number;
  name: string;
  cidr: string;
  gateway: string | null;
  dns_server: string | null;
  /** Router collegato alla rete: uno creato dopo la rete si collega al completamento. */
  router_id: number | null;
}

export interface AdDelWizard {
  id: number;
  name: string;
  winrm_credential_id: number | null;
}

export interface RiepilogoWizard {
  /** null = nessun punto salvato (o illeggibile: allora c'è l'avviso). */
  progresso: ProgressoWizard | null;
  /** Da mostrare a chi riapre: valore guasto, oggetti non più presenti. */
  avviso: string | null;
  router: RouterDelWizard | null;
  rete: ReteDelWizard | null;
  ad: AdDelWizard | null;
  /** Il DNS del passo 3, se già salvato (impostazione dell'hub). */
  dns_predefinito: string | null;
  /**
   * La rete su cui è installata l'appliance, da proporre nei campi (24/10).
   * La aggiunge la rotta (legge la macchina): qui resta assente.
   */
  rete_appliance?: ReteAppliance | null;
}

export function leggiRiepilogoWizard(tenantCode: string): RiepilogoWizard {
  const dns = getSetting("default_network_dns");
  const riepilogo: RiepilogoWizard = {
    progresso: null,
    avviso: null,
    router: null,
    rete: null,
    ad: null,
    dns_predefinito: dns && dns.trim() ? dns : null,
  };
  const lettura = leggiProgresso(getSetting(chiaveProgresso(tenantCode)));
  if (lettura.stato === "assente") return riepilogo;
  if (lettura.stato === "illeggibile") {
    riepilogo.avviso = `Il punto raggiunto nel wizard non si è potuto leggere (${lettura.errore}): si riparte dal primo passo, gli oggetti già creati restano.`;
    return riepilogo;
  }

  const progresso = { ...lettura.progresso };
  const spariti: string[] = [];
  /** Passi che creano gli oggetti spariti: si riparte dal primo di questi. */
  const passiDaRifare: number[] = [];
  const salvati = [progresso.router_device_id, progresso.network_id, progresso.ad_integration_id].filter((x) => x != null).length;
  if (progresso.router_device_id != null) {
    const d = getNetworkDeviceById(progresso.router_device_id);
    if (d) {
      riepilogo.router = {
        id: d.id,
        name: d.name,
        host: d.host,
        vendor: d.vendor,
        protocol: d.protocol,
        // Dai binding (revisione della 2e, 16/10): le colonne sono vuote.
        ...vociDelRouter(d.protocol, getDeviceCredentialBindings(d.id)),
      };
    } else {
      spariti.push(`il router (id ${progresso.router_device_id})`);
      passiDaRifare.push(PASSO.router);
      progresso.router_device_id = null;
    }
  }
  if (progresso.network_id != null) {
    const n = getNetworkById(progresso.network_id);
    if (n) {
      riepilogo.rete = {
        id: n.id,
        name: n.name,
        cidr: n.cidr,
        gateway: n.gateway ?? null,
        dns_server: n.dns_server ?? null,
        router_id: getNetworkRouterId(n.id),
      };
    } else {
      spariti.push(`la rete (id ${progresso.network_id})`);
      passiDaRifare.push(PASSO.subnet);
      progresso.network_id = null;
    }
  }
  if (progresso.ad_integration_id != null) {
    const a = getAdIntegrationById(progresso.ad_integration_id);
    if (a) {
      riepilogo.ad = { id: a.id, name: a.name, winrm_credential_id: a.winrm_credential_id ?? null };
    } else {
      spariti.push(`l'integrazione Active Directory (id ${progresso.ad_integration_id})`);
      passiDaRifare.push(PASSO.ad);
      progresso.ad_integration_id = null;
    }
  }
  if (spariti.length) {
    // Spariti tutti (per esempio dopo una pulizia della configurazione): da capo,
    // perché anche l'archivio delle credenziali va riguardato.
    const daCapo = spariti.length === salvati;
    progresso.passo = daCapo ? PASSO.credenziali : Math.min(progresso.passo, ...passiDaRifare);
    riepilogo.avviso = `Creati dal wizard ma non più presenti: ${spariti.join(", ")}. Si possono creare di nuovo: si riparte da «${daCapo ? "Credenziali" : "il passo che li crea"}».`;
  }
  riepilogo.progresso = progresso;
  return riepilogo;
}

export function salvaProgresso(tenantCode: string, progresso: ProgressoWizard): void {
  setSetting(chiaveProgresso(tenantCode), scriviProgresso(progresso));
}

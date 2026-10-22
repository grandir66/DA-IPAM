/**
 * Scheda hypervisor (T6): elenco VM con chip e ricerca, storage del cluster e striscia dei numeri, dalla scansione
 * Proxmox (`proxmox_data`). Logica pura. Quello che la scansione non porta non si inventa: il CPU del cluster e
 * il quorum non sono raccolti, e lo stato dei nodi viene da IPAM (nella scansione è «unknown»).
 */
import type { ProxmoxScanViewModel } from "@/components/scheda/dati";
import type { Casella } from "@/components/scheda/striscia-numeri";
import type { NodoAbbinato } from "./abbinamento-proxmox";

export type VmProxmox = NonNullable<ProxmoxScanViewModel["vms"]>[number];
export type NodoProxmox = NonNullable<ProxmoxScanViewModel["hosts"]>[number];
export type ChipVm = "accese" | "spente" | "senza_agente" | "tutte";

/** Quante VM e container ha il cluster: il totale vero se l'elenco è troncato, 0 è 0 (non ricade sull'elenco). */
export function numeroVm(px: Pick<ProxmoxScanViewModel, "vms" | "_total_vm_rows"> | null | undefined): number {
  return px?._total_vm_rows ?? px?.vms?.length ?? 0;
}

const accesa = (v: VmProxmox): boolean => v.status === "running";
/** `agent` arriva come stringa «1»/«0» dall'API di Proxmox anche se il tipo dice number. Container (lxc) non ne hanno. */
const senzaAgente = (v: VmProxmox): boolean => v.type === "qemu" && accesa(v) && Number(v.agent) !== 1;

export function contaChip(vms: VmProxmox[]): Record<ChipVm, number> {
  return {
    accese: vms.filter(accesa).length,
    spente: vms.filter((v) => !accesa(v)).length,
    senza_agente: vms.filter(senzaAgente).length,
    tutte: vms.length,
  };
}

/** VLAN delle schede di rete della VM, distinte, nell'ordine in cui compaiono. */
export function vlanVm(v: VmProxmox): string[] {
  return [...new Set((v.networks_details ?? []).map((n) => (n.vlan ?? "").trim()).filter((x) => x !== ""))];
}

/** Chip + ricerca (nome, IP, VLAN, VMID, nodo; «vlan 20» e «v20» valgono come «20»), in AND. */
export function filtraVm(vms: VmProxmox[], chip: ChipVm, ricerca: string): VmProxmox[] {
  const q = ricerca.trim().toLowerCase();
  const vlanQ = q.replace(/^v(lan)?\s*/, "");
  return vms.filter((v) => {
    if (chip === "accese" && !accesa(v)) return false;
    if (chip === "spente" && accesa(v)) return false;
    if (chip === "senza_agente" && !senzaAgente(v)) return false;
    if (q === "") return true;
    return (
      v.name.toLowerCase().includes(q) ||
      String(v.vmid).includes(q) ||
      v.node.toLowerCase().includes(q) ||
      (v.ip_addresses ?? []).some((ip) => ip.includes(q)) ||
      (vlanQ !== "" && vlanVm(v).some((x) => x === vlanQ))
    );
  });
}

/** Storage condivisi fra i nodi: la stessa riga su ogni nodo è UNO storage del cluster. */
const CONDIVISI = new Set(["nfs", "cifs", "pbs", "rbd", "cephfs", "glusterfs", "iscsi", "iscsidirect"]);

export interface PoolStorage {
  nome: string;
  tipo: string;
  /** Nome del nodo, oppure «cluster» se lo storage è condiviso. */
  nodo: string;
  contenuto: string | null;
  usatoGb: number | null;
  disponibileGb: number | null;
  totaleGb: number;
  percento: number | null;
}

export function poolStorage(px: Pick<ProxmoxScanViewModel, "hosts"> | null | undefined): PoolStorage[] {
  const out = new Map<string, PoolStorage>();
  for (const h of px?.hosts ?? []) {
    for (const s of h.storage ?? []) {
      const totale = s.total_gb ?? 0;
      if (!(totale > 0)) continue;
      const tipo = (s.type ?? "").toLowerCase();
      const condiviso = CONDIVISI.has(tipo);
      const chiave = `${s.name}|${tipo}|${condiviso ? "" : h.hostname}`;
      if (out.has(chiave)) continue;
      out.set(chiave, {
        nome: s.name,
        tipo: s.type ?? "?",
        nodo: condiviso ? "cluster" : h.hostname,
        contenuto: s.content ?? null,
        usatoGb: s.used_gb ?? null,
        disponibileGb: s.available_gb ?? null,
        totaleGb: totale,
        percento: s.used_gb != null ? (s.used_gb / totale) * 100 : null,
      });
    }
  }
  return [...out.values()].sort((a, b) => (b.percento ?? -1) - (a.percento ?? -1));
}

const meseAnno = (d: string | undefined): string | null => {
  const m = /^(\d{4})-(\d{2})/.exec(d ?? "");
  return m ? `${m[2]}/${m[1]}` : null;
};
const abbonamentoAttivo = (s: NodoProxmox["subscription"]): boolean => {
  const st = s?.status?.toLowerCase();
  return st === "active" || st === "active/valid";
};

/** Striscia dei numeri: solo le caselle di cui c'è il dato. `nodi` = abbinamenti con IPAM (stato vero dei nodi). */
export function caselleHypervisor(px: ProxmoxScanViewModel | null | undefined, { nodi }: { nodi: NodoAbbinato[] }): Casella[] {
  if (!px) return [];
  const caselle: Casella[] = [];
  const hosts = px.hosts ?? [];

  if (hosts.length > 0) {
    // Lo stato letto dalla scansione è «unknown»: vale quello di IPAM, e se nessuno lo sa si conta e basta.
    const stati = hosts.map((h) => nodi.find((n) => n.nodo === h.hostname)?.stato ?? (h.status === "online" || h.status === "offline" ? h.status : null));
    const noti = stati.filter((s): s is string => s !== null);
    const online = noti.filter((s) => s === "online").length;
    caselle.push({
      etichetta: "Nodi",
      valore: noti.length === hosts.length ? `${online} / ${hosts.length}` : String(hosts.length),
      sotto: noti.length === hosts.length ? (online === hosts.length ? "✓ tutti online" : `▲ ${hosts.length - online} non online`) : "stato non letto",
      tab: "nodi",
      ...(noti.length === hosts.length && online < hosts.length ? { attenzione: true } : {}),
    });
  }

  const vms = px.vms ?? [];
  if (vms.length > 0) {
    const totale = numeroVm(px);
    caselle.push({ etichetta: "VM e container", valore: `${vms.filter(accesa).length} / ${totale}`, sotto: "in esecuzione", tab: "vm" });
  }

  const conRam = hosts.filter((h) => (h.memory_total_gb ?? 0) > 0 && h.memory_used_gb != null);
  if (conRam.length > 0) {
    const tot = conRam.reduce((a, h) => a + (h.memory_total_gb ?? 0), 0);
    const usata = conRam.reduce((a, h) => a + (h.memory_used_gb ?? 0), 0);
    const p = (usata / tot) * 100;
    caselle.push({
      etichetta: "RAM cluster",
      valore: `${Math.round(p)}%`,
      sotto: `${Math.round(usata).toLocaleString("it-IT")} di ${Math.round(tot).toLocaleString("it-IT")} GB`,
      tab: "nodi",
      ...(p >= 85 ? { attenzione: true } : {}),
    });
  }

  const peggiore = poolStorage(px).find((p) => p.percento != null);
  if (peggiore && peggiore.percento != null) {
    caselle.push({
      etichetta: "Storage peggiore",
      valore: `${Math.round(peggiore.percento)}%`,
      sotto: `${peggiore.nome} su ${peggiore.nodo}`,
      tab: "storage_px",
      ...(peggiore.percento >= 85 ? { attenzione: true } : {}),
    });
  }

  const conAbb = hosts.filter((h) => h.subscription);
  if (conAbb.length > 0) {
    const attivi = conAbb.filter((h) => abbonamentoAttivo(h.subscription));
    const prima = attivi.map((h) => h.subscription?.nextduedate).filter((d): d is string => !!d).sort()[0];
    const tutti = attivi.length === conAbb.length;
    caselle.push({
      etichetta: "Abbonamento",
      valore: tutti ? "✓ attivo" : `${attivi.length} / ${conAbb.length} attivi`,
      ...(tutti ? (meseAnno(prima) ? { sotto: `scade ${meseAnno(prima)}` } : {}) : { sotto: "▲ nodi senza abbonamento attivo" }),
      tab: "nodi",
      ...(tutti ? {} : { attenzione: true }),
    });
  }
  return caselle;
}

/** I nomi corti («DA-PX-01») con cui un host di IPAM può chiamarsi: l'hostname senza dominio, il nome personalizzato. */
const nomeCorto = (n: string | null | undefined): string => (n ?? "").trim().toLowerCase().split(".")[0];

/** Questo nodo della scansione è l'host della scheda? Per IP di una sua interfaccia o per nome. */
export function nodoDellaScheda(nodo: NodoProxmox, host: { ip: string; hostname?: string | null; custom_name?: string | null }): boolean {
  const ips = (nodo.network_interfaces ?? []).flatMap((i) => (i.ip_addresses ?? "").split(/[\s,;]+/).map((x) => x.replace(/\/\d+$/, "")));
  if (ips.includes(host.ip)) return true;
  const n = nomeCorto(nodo.hostname);
  return n !== "" && (n === nomeCorto(host.hostname) || n === nomeCorto(host.custom_name));
}

/**
 * Abbinamento tra la scansione Proxmox e gli host di IPAM (scheda hypervisor, T6): quale host è la VM n, quale
 * host è il nodo X, su quale nodo gira questo host. Logica pura: le ricerche nel DB arrivano iniettate, così
 * si prova senza database. La rotta GET `/api/devices/[id]/proxmox-match` e `/api/hosts/[id]/proxmox-vm` le usano.
 */
import type { ModelScanHostRow, ModelVmRow } from "@/lib/topology/model-types";

export interface HostNoto { id: number; ip: string; hostname: string | null; status: string | null }
export interface Ricerche {
  perIp: (ip: string) => HostNoto | undefined;
  /** Nome del nodo Proxmox («DA-PX-01») contro hostname o nome personalizzato («DA-PX-01.domarc.it»). */
  perNome: (nome: string) => HostNoto | undefined;
}

export interface VmAbbinata { vmid: number; node: string; host_id: number; hostname: string | null }
export interface NodoAbbinato { nodo: string; host_id: number | null; stato: string | null }
export interface VmSuNodo { vmid: number; nodo: string; nodoHostId: number | null; deviceId: number }

/**
 * Gli IP che stanno in UNA sola VM. 172.17.0.1 (bridge docker) o un IP duplicato non dicono quale host è:
 * abbinarli per IP attaccherebbe la VM al primo host che per caso ha quell'indirizzo.
 */
export function ipsDistintivi(vms: ModelVmRow[]): Set<string> {
  const conta = new Map<string, number>();
  for (const v of vms) for (const ip of new Set(v.ips)) conta.set(ip, (conta.get(ip) ?? 0) + 1);
  return new Set([...conta].filter(([, n]) => n === 1).map(([ip]) => ip));
}

/** Per ogni VM, l'host di IPAM col suo primo IP distintivo noto. Le VM senza abbinamento non compaiono. */
export function abbinaVm(vms: ModelVmRow[], r: Ricerche): VmAbbinata[] {
  const distintivi = ipsDistintivi(vms);
  const out: VmAbbinata[] = [];
  for (const v of vms) {
    for (const ip of v.ips) {
      if (!distintivi.has(ip)) continue;
      const h = r.perIp(ip);
      if (h) { out.push({ vmid: v.vmid, node: v.node, host_id: h.id, hostname: h.hostname }); break; }
    }
  }
  return out;
}

/** Per ogni nodo del cluster: prima per IP delle sue interfacce, poi per nome. Lo stato è quello di IPAM. */
export function abbinaNodi(nodi: ModelScanHostRow[], r: Ricerche): NodoAbbinato[] {
  return nodi.map((n) => {
    let h: HostNoto | undefined;
    for (const ip of n.ips) { h = r.perIp(ip); if (h) break; }
    h ??= r.perNome(n.hostname);
    return { nodo: n.hostname, host_id: h?.id ?? null, stato: h?.status ?? null };
  });
}

/**
 * Su quale nodo gira l'host con questo IP. Le scansioni sono una per apparato ma ognuna vede tutto il cluster:
 * la stessa VM arriva più volte e si conta una. Due VM diverse con quell'IP = nessuna identità (null).
 */
export function vmDelHost(
  ip: string,
  scans: Array<{ deviceId: number; vms: ModelVmRow[]; hosts: ModelScanHostRow[] }>,
  r: Ricerche,
): VmSuNodo | null {
  const trovate = new Map<string, { vm: ModelVmRow; scan: (typeof scans)[number] }>();
  for (const scan of scans) {
    for (const v of scan.vms) if (v.ips.includes(ip)) trovate.set(`${v.node}/${v.vmid}`, trovate.get(`${v.node}/${v.vmid}`) ?? { vm: v, scan });
  }
  if (trovate.size !== 1) return null;
  const { vm, scan } = [...trovate.values()][0];
  const nodoScan = scan.hosts.find((h) => h.hostname === vm.node);
  const nodo = abbinaNodi([nodoScan ?? { scannedDeviceId: scan.deviceId, hostname: vm.node, ips: [], macs: [] }], r)[0];
  return { vmid: vm.vmid, nodo: vm.node, nodoHostId: nodo.host_id, deviceId: scan.deviceId };
}

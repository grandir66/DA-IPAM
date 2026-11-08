/**
 * Proxmox come uno switch (Riccardo, 08/11: «gli hypervisor devono essere trattati come switch per le porte»): le porte dei
 * bridge, la tabella MAC (FDB), le VLAN e l'ARP del nodo. Prima il collector leggeva interfacce e VM ma non dove sta ogni MAC:
 * le VM restavano «sul nodo», senza porta. Logica pura sui testi JSON di `ip -d -j link show`, `bridge -j fdb show dynamic`,
 * `bridge -j -c vlan show` e `ip -j neigh show` (tutti in sola lettura). Sull'hub (08/11) la tabella intera con le voci
 * permanenti di ogni VLAN superava 1 MB (936 KB su DA-PX-04, oltre il limite su DA-PX-03 e -05): `dynamic` la porta a 39 KB.
 *
 * Porte che non si mostrano: `lo` e l'interno del firewall di Proxmox (`fwbrNNNiM`, `fwlnNNNiM` e il `tapNNNiM` che sta dentro
 * un `fwbr`). Con il firewall acceso la VM arriva sul bridge vero dalla porta `fwprNNNpM`, che resta ed è la porta della VM;
 * l'interno vedrebbe ogni MAC che parla con la VM e farebbe di ogni VM una porta «di passaggio».
 */
import type { AcquisitionSnapshot } from "./schema";

type Interfaccia = AcquisitionSnapshot["interfaces"]["data"][number];
type Vlan = AcquisitionSnapshot["vlans"]["data"][number];
type Fdb = AcquisitionSnapshot["forwarding"]["data"][number];
type Arp = AcquisitionSnapshot["network"]["data"]["arp"][number];
type Aggregato = AcquisitionSnapshot["aggregation"]["data"][number];

export interface LinkProxmox {
    ifindex: number | null; nome: string; mac: string | null; mtu: number | null; stato: string | null; master: string | null;
    /** `bond`, `bridge`, `vlan`, `veth`, `tun`…; null per una scheda fisica. */
    tipo: string | null; vlanId: number | null; padre: string | null; vlanFiltering: boolean;
}

const oggetti = (testo: string): Array<Record<string, unknown>> | null => {
    try {
        const v: unknown = JSON.parse(testo);
        return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : null;
    } catch {
        return null;
    }
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const MAC = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i;
/** Primo ottetto dispari = multicast o broadcast: non è una macchina su una porta. */
const multicast = (mac: string): boolean => (parseInt(mac.slice(0, 2), 16) & 1) === 1;

export function parseLinkProxmox(testo: string): LinkProxmox[] | null {
    const righe = oggetti(testo);
    if (!righe) return null;
    return righe.flatMap((r) => {
        const nome = str(r.ifname);
        if (!nome) return [];
        const info = (r.linkinfo && typeof r.linkinfo === "object" ? r.linkinfo : {}) as Record<string, unknown>;
        const dati = (info.info_data && typeof info.info_data === "object" ? info.info_data : {}) as Record<string, unknown>;
        const tipo = str(info.info_kind);
        // Le `tap` e le `veth` delle VM accese dicono `UNKNOWN`: con `LOWER_UP` fra le bandiere il collegamento c'è (sull'hub,
        // 08/11, tutte le porte delle VM risultavano «down»).
        const flags = Array.isArray(r.flags) ? r.flags : [];
        const op = str(r.operstate)?.toLowerCase() ?? null;
        const stato = op === "unknown" ? (flags.includes("LOWER_UP") ? "up" : null) : op;
        return [{
            ifindex: num(r.ifindex), nome, mac: str(r.address), mtu: num(r.mtu), stato, master: str(r.master),
            tipo, vlanId: tipo === "vlan" ? num(dati.id) : null, padre: str(r.link), vlanFiltering: tipo === "bridge" && dati.vlan_filtering === 1,
        }];
    });
}

/** Le porte interne del firewall di Proxmox e `lo`: vedi il commento in testa. */
export function portaInterna(l: LinkProxmox, perNome: ReadonlyMap<string, LinkProxmox>): boolean {
    if (l.nome === "lo" || /^fw(?:br|ln)\d+i\d+$/.test(l.nome)) return true;
    return /^tap\d+i\d+$/.test(l.nome) && !!l.master && perNome.get(l.master)?.nome.startsWith("fwbr") === true;
}

/** La VM dietro una porta: `tap100i0`, `fwpr100p0`, `veth200i0` → 100/200 e il numero della scheda. */
export function vmDellaPorta(nome: string): { vmid: number; scheda: number } | null {
    const m = nome.match(/^(?:tap|fwpr|veth)(\d+)[ip](\d+)$/);
    return m ? { vmid: Number(m[1]), scheda: Number(m[2]) } : null;
}

export function interfacceProxmox(link: readonly LinkProxmox[]): Interfaccia[] {
    const perNome = new Map(link.map((l) => [l.nome, l]));
    return link.filter((l) => !portaInterna(l, perNome)).map((l) => {
        const vm = vmDellaPorta(l.nome);
        const descrizione = vm ? `VM ${vm.vmid} scheda net${vm.scheda}` : l.tipo === "bridge" ? "bridge" : l.tipo === "vlan" && l.vlanId != null ? `VLAN ${l.vlanId} su ${l.padre ?? "?"}` : null;
        return {
            name: l.nome, if_index: l.ifindex, description: descrizione, kind: l.tipo === "bond" ? "aggregate" : l.tipo === null ? "physical" : "other",
            admin_status: null, oper_status: l.stato, speed_bps: null, reported_speed_bps: null, duplex: null, mtu: l.mtu, mac: l.mac, counters: {}, pvid: null,
        };
    });
}

export function aggregatiProxmox(link: readonly LinkProxmox[]): Aggregato[] {
    return link.filter((l) => l.tipo === "bond").map((b) => ({
        name: b.nome, protocol: null, admin_status: null, oper_status: b.stato, members: link.filter((m) => m.master === b.nome).map((m) => m.nome),
    }));
}

/**
 * La tabella MAC dei bridge. Si tengono solo le voci imparate su una porta di un bridge (`master`), non quelle della scheda
 * (`self`), non le permanenti (sono i MAC del nodo stesso), non i multicast, non l'interno del firewall.
 */
export function parseFdbProxmox(testo: string, link: readonly LinkProxmox[]): Fdb[] | null {
    const righe = oggetti(testo);
    if (!righe) return null;
    const perNome = new Map(link.map((l) => [l.nome, l]));
    const out: Fdb[] = [];
    for (const r of righe) {
        const mac = str(r.mac)?.toLowerCase();
        const porta = str(r.ifname), master = str(r.master);
        const flags = Array.isArray(r.flags) ? r.flags.filter((f): f is string => typeof f === "string") : [];
        if (!mac || !MAC.test(mac) || multicast(mac) || !porta || !master || master.startsWith("fwbr")) continue;
        if (str(r.state) === "permanent" || flags.includes("self")) continue;
        const l = perNome.get(porta);
        if (l && portaInterna(l, perNome)) continue;
        out.push({ mac, vlan_id: num(r.vlan), fdb_id: null, bridge_port: null, if_index: l?.ifindex ?? null, port: porta, status: "learned" });
    }
    return out;
}

/**
 * Le VLAN, da tre fonti che si sommano:
 * - `bridge -j vlan show` solo per i bridge con `vlan_filtering` acceso (negli altri ogni porta dice «VLAN 1» e non vuol dire niente);
 * - le interfacce VLAN (`bond0.40`): la VLAN è tagged sul padre e untagged sulle altre porte del bridge che la contiene;
 * - il `tag=` delle schede delle VM (configurazione di Proxmox): untagged sulla porta della VM.
 */
export function vlanProxmox(link: readonly LinkProxmox[], testoVlan: string, guests: AcquisitionSnapshot["guests"] | undefined): Vlan[] {
    const perNome = new Map(link.map((l) => [l.nome, l]));
    const visibili = new Set(link.filter((l) => !portaInterna(l, perNome)).map((l) => l.nome));
    const vlan = new Map<number, { tagged: Set<string>; untagged: Set<string> }>();
    const metti = (id: number | null, porta: string, untagged: boolean) => {
        if (id == null || id < 1 || id > 4094 || !visibili.has(porta)) return;
        const v = vlan.get(id) ?? { tagged: new Set<string>(), untagged: new Set<string>() };
        (untagged ? v.untagged : v.tagged).add(porta);
        vlan.set(id, v);
    };
    const filtranti = new Set(link.filter((l) => l.vlanFiltering).map((l) => l.nome));
    // `bridge-vids 2-4094` è il predefinito di Proxmox sulla porta verso lo switch: 4.093 VLAN «ammesse», non usate. Un
    // intervallo largo vale solo per le VLAN che qualcos'altro usa davvero (una VM, un'interfaccia VLAN): si applica in fondo.
    const larghi: Array<{ porta: string; primo: number; ultimo: number }> = [];
    for (const r of oggetti(testoVlan) ?? []) {
        const porta = str(r.ifname);
        const l = porta ? perNome.get(porta) : undefined;
        if (!porta || !l || filtranti.has(porta) || !l.master || !filtranti.has(l.master)) continue;
        // Con o senza `-c` (intervalli o una voce per VLAN: sull'hub `bridge -j vlan show` ne elencava 4.094 per porta).
        const voci: Array<{ primo: number; ultimo: number; untagged: boolean }> = [];
        for (const v of Array.isArray(r.vlans) ? r.vlans : []) {
            if (!v || typeof v !== "object") continue;
            const x = v as Record<string, unknown>;
            const flags = Array.isArray(x.flags) ? x.flags : [];
            const primo = num(x.vlan), ultimo = num(x.vlanEnd) ?? primo;
            if (primo == null || ultimo == null || ultimo < primo) continue;
            voci.push({ primo, ultimo, untagged: flags.includes("Egress Untagged") });
        }
        const quante = voci.reduce((t, v) => t + v.ultimo - v.primo + 1, 0);
        for (const v of voci) {
            if (quante > 64 && !v.untagged) { larghi.push({ porta, primo: v.primo, ultimo: v.ultimo }); continue; }
            for (let id = v.primo; id <= v.ultimo; id++) metti(id, porta, v.untagged);
        }
    }
    for (const l of link) {
        if (l.tipo !== "vlan" || l.vlanId == null) continue;
        if (l.padre) metti(l.vlanId, l.padre, false);
        if (l.master) for (const m of link) if (m.master === l.master && m.nome !== l.nome) metti(l.vlanId, m.nome, true);
    }
    for (const g of guests?.data ?? []) {
        if (g.vmid == null) continue;
        for (const n of g.networks ?? []) {
            const scheda = Number(n.id.replace(/^net/, ""));
            const tag = n.vlan != null ? Number(n.vlan) : null;
            if (!Number.isInteger(scheda) || tag == null || !Number.isInteger(tag)) continue;
            const porta = link.find((l) => { const vm = vmDellaPorta(l.nome); return !!vm && vm.vmid === g.vmid && vm.scheda === scheda && visibili.has(l.nome); });
            if (porta) metti(tag, porta.nome, true);
        }
    }
    for (const x of larghi) for (const id of [...vlan.keys()]) if (id >= x.primo && id <= x.ultimo) metti(id, x.porta, false);
    return [...vlan.entries()].sort((a, b) => a[0] - b[0]).map(([id, v]) => ({
        id, name: null, description: null, tagged_ports: [...v.tagged].sort(), untagged_ports: [...v.untagged].sort(), forbidden_ports: [],
    }));
}

/** L'ARP del nodo: si tengono le voci con un MAC (FAILED e INCOMPLETE non ne hanno), solo IPv4. */
export function parseNeighProxmox(testo: string, link: readonly LinkProxmox[]): Arp[] | null {
    const righe = oggetti(testo);
    if (!righe) return null;
    const perNome = new Map(link.map((l) => [l.nome, l]));
    return righe.flatMap((r) => {
        const ip = str(r.dst), mac = str(r.lladdr)?.toLowerCase();
        if (!ip || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) || !mac || !MAC.test(mac)) return [];
        const stato = Array.isArray(r.state) ? r.state.filter((s): s is string => typeof s === "string").join(",") : null;
        return [{ address: ip, mac, if_index: perNome.get(str(r.dev) ?? "")?.ifindex ?? null, type: stato ? stato.toLowerCase() : null }];
    });
}

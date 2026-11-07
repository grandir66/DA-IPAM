/**
 * Dalla mappa dei MAC alla mappa di tutti gli oggetti (piano 2026-11-07, «tutti i dati»). Logica pura.
 *
 * `calcolaMappa` dice dove sta ogni MAC visto su una porta. Riccardo (07/11): mancavano oggetti che la Topologia ha. Qui si
 * aggiunge ciò che nessuna tabella di porta vede (ARP, DHCP, storico, host offline o senza MAC, VM spente) e si raccoglie
 * in una riga ogni oggetto con più MAC: un hypervisor o un server con più schede non è una riga per scheda.
 *
 * La posizione non si inventa: chi non sta su una tabella di porta resta «non so», e `ramo` dice dove è stato visto.
 */
import { isVirtualMac } from "@/lib/devices/mac-virtuali";
import { parseDbDate } from "@/lib/db-date";
import { normalizeMacForStorage } from "@/lib/utils";
import type { Confidenza, IngressoMappaPorte, OggettoGrezzo, OggettoMappa, Prova } from "@/lib/mappa-porte/tipi";

const GIORNO = 86_400_000;
const norm = (s: string | null | undefined) => normalizeMacForStorage(s ?? null);
const ARP_INUTILE = new Set(["failed", "incomplete"]);
const RANGO: Record<Confidenza, number> = { certa: 0, spiegata: 1, da_capire: 2, non_so: 3 };

/** Multicast, broadcast e tutti zeri non sono oggetti: il bit basso del primo byte dice multicast. */
function macUtile(m: string | null): m is string {
  if (!m || isVirtualMac(m) || m === "00:00:00:00:00:00") return false;
  return (Number.parseInt(m.slice(0, 2), 16) & 1) === 0;
}
const istante = (s: string | null | undefined): number => {
  if (!s) return 0;
  const ms = parseDbDate(s).getTime();
  return Number.isFinite(ms) ? ms : 0;
};
const ordinaIp = (ii: Iterable<string>): string[] =>
  [...new Set(ii)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

interface Avvistato { ips: Set<string>; fonti: Set<string>; prove: Prova[]; ms: number; ramo: string | null; vlan: number | null; nome: string | null }
type Riga = OggettoGrezzo & { macs: string[]; ips: string[] };

export function completaOggetti(grezzi: readonly OggettoGrezzo[], ing: IngressoMappaPorte, diRete: (id: number) => boolean): OggettoMappa[] {
  const soglia = ing.staleDays * GIORNO;
  const nomi = new Map(ing.apparati.map((a) => [a.id, a.name]));
  const nomeDi = (d: number | null | undefined) => (d != null ? nomi.get(d) ?? `apparato ${d}` : "apparato non censito");
  const vlanInterfaccia = new Map(ing.mkVlanIf.map((r) => [`${r.device_id}|${r.name}`, r.vlan_id]));

  const avvistati = new Map<string, Avvistato>();
  const segna = (mac: string, o: { ip?: string | null; fonte: string; ms: number; prova?: Prova; ramo?: string; vlan?: number | null; nome?: string | null }) => {
    const a = avvistati.get(mac) ?? { ips: new Set<string>(), fonti: new Set<string>(), prove: [], ms: 0, ramo: null, vlan: null, nome: null };
    avvistati.set(mac, a);
    if (o.ip) a.ips.add(o.ip);
    a.fonti.add(o.fonte);
    a.ms = Math.max(a.ms, o.ms);
    if (o.prova) a.prove.push(o.prova);
    a.ramo ??= o.ramo ?? null;
    a.vlan ??= o.vlan ?? null;
    a.nome ??= o.nome ?? null;
  };
  for (const r of ing.arp) {
    const mac = norm(r.mac);
    if (!macUtile(mac) || ARP_INUTILE.has(r.status ?? "")) continue;
    const dove = r.interface_name ?? "—";
    segna(mac, {
      ip: r.ip, fonte: "ARP", ms: istante(r.timestamp), vlan: r.interface_name ? vlanInterfaccia.get(`${r.device_id}|${r.interface_name}`) ?? null : null,
      prova: { apparato: nomeDi(r.device_id), porta: dove, tipo: "vista", nMac: 0, fonte: "ARP", visto: r.timestamp ?? "" }, ramo: `Visto da ${nomeDi(r.device_id)} · ${dove}`,
    });
  }
  for (const r of ing.lnmsArp) {
    const mac = norm(r.mac);
    if (!macUtile(mac)) continue;
    segna(mac, { ip: r.ip, fonte: "LibreNMS", ms: istante(r.letto_il), prova: { apparato: nomeDi(r.device_id), porta: r.if_name ?? "—", tipo: "vista", nMac: 0, fonte: "ARP · LibreNMS", visto: r.letto_il }, ramo: `Visto da ${nomeDi(r.device_id)}${r.if_name ? ` · ${r.if_name}` : ""}` });
  }
  for (const r of ing.dhcp) {
    const mac = norm(r.mac_address);
    if (!macUtile(mac)) continue;
    const quando = r.last_seen ?? r.last_synced;
    const server = r.source_device_id != null ? nomeDi(r.source_device_id) : r.source_name ?? "DHCP";
    segna(mac, { ip: r.ip_address, fonte: "DHCP", ms: istante(quando), nome: r.hostname, prova: { apparato: server, porta: r.scope_name ?? "DHCP", tipo: "vista", nMac: 0, fonte: "DHCP", visto: quando ?? "" }, ramo: `Lease DHCP di ${server}` });
  }
  for (const r of ing.macIp) {
    const mac = norm(r.mac_normalized);
    if (macUtile(mac)) segna(mac, { ip: r.ip, fonte: "Storico MAC-IP", ms: istante(r.last_seen), nome: r.hostname, ramo: "Solo nello storico MAC-IP" });
  }

  const righe = new Map<string, Riga>();
  for (const g of grezzi) righe.set(g.chiave, { ...g, macs: g.mac ? [g.mac] : [], ips: g.ip ? [g.ip] : [] });

  const hostPerMac = new Map<string, typeof ing.hosts>();
  for (const h of ing.hosts) {
    const m = norm(h.mac);
    if (m) hostPerMac.set(m, [...(hostPerMac.get(m) ?? []), h]);
  }

  // Ciò che nessuna tabella di porta vede.
  const macDegliApparati = new Map<string, number>();
  const note = [...ing.macApparati, ...ing.macNote].sort((a, b) => Number(diRete(b.device_id)) - Number(diRete(a.device_id)) || a.device_id - b.device_id);
  for (const r of note) {
    const m = norm(r.mac);
    if (macUtile(m) && !macDegliApparati.has(m)) macDegliApparati.set(m, r.device_id);
  }
  const vmPerMac = new Map(ing.vm.map((v) => [norm(v.mac) ?? v.mac, v]));
  const vuota = (chiave: string, o: Partial<Riga>): Riga => ({
    chiave, categoria: "dispositivo", mac: null, ip: null, nIp: 0, nome: null, tipo: null, hostId: null, apparatoId: null, confidenza: "non_so", deviceId: null, apparato: null,
    portaChiave: null, porta: null, tipoPorta: null, vlan: null, ramo: null, perche: "", fonti: [], prove: [], conflitto: false, dedotta: false, vecchio: false, senzaHost: false, visto: null,
    macs: [], ips: [], ...o,
  });
  const quando = (ms: number): string | null => (ms > 0 ? new Date(ms).toISOString().slice(0, 19).replace("T", " ") : null);

  for (const [mac, hh] of hostPerMac) {
    if (righe.has(mac) || !macUtile(mac) || macDegliApparati.has(mac)) continue;
    const h = hh[0];
    righe.set(mac, vuota(mac, {
      mac, macs: [mac], ip: h.ip, ips: hh.map((x) => x.ip), nome: h.custom_name || h.hostname || h.vendor, tipo: h.classification ?? (vmPerMac.has(mac) ? "vm" : null), hostId: h.id, vecchio: true,
      ramo: "Host non online", perche: "L'host è in inventario ma non è online e nessuna tabella lo vede.",
    }));
  }
  for (const [mac, a] of avvistati) {
    if (righe.has(mac) || macDegliApparati.has(mac)) continue;
    righe.set(mac, vuota(mac, {
      mac, macs: [mac], ip: ordinaIp(a.ips)[0] ?? null, nome: a.nome, vlan: a.vlan, ramo: a.ramo, senzaHost: true, vecchio: ing.nowMs - a.ms > soglia, visto: quando(a.ms),
      perche: "Non è su nessuna tabella di porta: si sa solo che esiste, non dove è collegato.",
    }));
  }
  for (const [mac, v] of vmPerMac) {
    if (righe.has(mac) || macDegliApparati.has(mac) || !macUtile(mac)) continue;
    righe.set(mac, vuota(mac, {
      mac, macs: [mac], nome: v.nome, tipo: "vm", vecchio: !v.acceso, ramo: `Sul nodo ${v.nodo}`, fonti: ["Proxmox"], perche: v.acceso ? "VM accesa che nessuna tabella vede." : "VM spenta: quando è spenta non è su nessuna porta.",
    }));
  }
  for (const h of ing.hosts) {
    if (norm(h.mac)) continue;
    righe.set(`ip:${h.ip}`, vuota(`ip:${h.ip}`, {
      ip: h.ip, ips: [h.ip], nome: h.custom_name || h.hostname || h.vendor, tipo: h.classification, hostId: h.id, vecchio: h.status !== "online", ramo: "Senza MAC",
      perche: "L'host risponde all'indirizzo ma nessuno ha letto il suo MAC.",
    }));
  }

  // Quello che si sa su ogni MAC, anche dove la posizione c'era già.
  const arricchisci = (r: Riga, mac: string) => {
    const a = avvistati.get(mac);
    const hh = hostPerMac.get(mac) ?? [];
    r.ips = ordinaIp([...r.ips, ...hh.map((h) => h.ip), ...(a?.ips ?? [])]);
    r.ip ??= r.ips[0] ?? null;
    r.vlan ??= a?.vlan ?? null;
    r.nome ??= a?.nome ?? null;
    if (a) {
      r.fonti = [...new Set([...r.fonti, ...a.fonti])];
      r.prove = [...r.prove, ...a.prove];
      if (r.visto == null) r.visto = quando(a.ms);
    }
  };
  for (const r of righe.values()) if (r.mac) arricchisci(r, r.mac);

  const migliore = (rr: Riga[], escludi?: number): Riga | undefined =>
    [...rr].filter((r) => r.deviceId != null && r.deviceId !== escludi).sort((a, b) => Number(a.vecchio) - Number(b.vecchio) || RANGO[a.confidenza] - RANGO[b.confidenza] || (b.visto ?? "").localeCompare(a.visto ?? ""))[0];
  const altrove = (scelta: Riga, rr: Riga[]): string => {
    const altri = [...new Set(rr.filter((r) => r.deviceId != null && (r.deviceId !== scelta.deviceId || r.portaChiave !== scelta.portaChiave)).map((r) => `${r.apparato} · ${r.porta}`))];
    return altri.length > 0 ? ` Con gli altri suoi MAC è visto anche su ${altri.join(", ")}.` : "";
  };

  // Un apparato è una riga sola, con tutti i suoi MAC.
  const perApparato = new Map<number, string[]>();
  for (const [m, d] of macDegliApparati) perApparato.set(d, [...(perApparato.get(d) ?? []), m]);
  for (const a of ing.apparati) {
    const macs = (perApparato.get(a.id) ?? []).sort();
    const sue = macs.flatMap((m) => {
      const r = righe.get(m);
      return r ? [r] : [];
    });
    for (const r of sue) righe.delete(r.chiave);
    const chiave = `dev:${a.id}`;
    const esistente = righe.get(chiave);
    if (!esistente && !diRete(a.id) && sue.length === 0 && macs.length === 0) {
      // Un apparato senza un MAC noto c'è comunque: è in inventario.
      righe.set(chiave, vuota(chiave, { categoria: "apparato", nome: a.name, tipo: a.device_type, apparatoId: a.id, ramo: "Nessun MAC noto", perche: "L'apparato è in inventario ma di lui non si conosce un MAC." }));
      continue;
    }
    const base = esistente ?? vuota(chiave, { categoria: "apparato", nome: a.name, tipo: a.device_type, apparatoId: a.id, ramo: "Nessuna tabella lo vede", perche: "L'apparato è in inventario ma nessuna tabella di porta vede i suoi MAC." });
    const scelta = base.deviceId == null ? migliore(sue, a.id) : undefined;
    const unita: Riga = {
      ...base, ...(scelta ? {
        confidenza: scelta.confidenza, deviceId: scelta.deviceId, apparato: scelta.apparato, portaChiave: scelta.portaChiave, porta: scelta.porta, tipoPorta: scelta.tipoPorta, ramo: null,
        perche: scelta.perche + altrove(scelta, sue), conflitto: false, dedotta: scelta.dedotta,
      } : {}),
      macs: [...new Set([...base.macs, ...macs])].sort(), ips: ordinaIp([...base.ips, ...sue.flatMap((r) => r.ips)]),
      fonti: [...new Set([...base.fonti, ...sue.flatMap((r) => r.fonti)])], prove: [...base.prove, ...sue.flatMap((r) => r.prove)],
      hostId: base.hostId ?? sue.find((r) => r.hostId != null)?.hostId ?? null, vlan: base.vlan ?? scelta?.vlan ?? null, visto: base.visto ?? scelta?.visto ?? sue.find((r) => r.visto)?.visto ?? null,
      vecchio: sue.length > 0 && sue.every((r) => r.vecchio) && base.deviceId == null, mac: base.mac ?? macs[0] ?? null,
    };
    for (const m of macs) {
      arricchisci(unita, m);
      unita.hostId ??= hostPerMac.get(m)?.[0]?.id ?? null;
    }
    righe.set(chiave, unita);
  }

  // Una VM con più schede è una riga sola.
  const perVm = new Map<string, Riga[]>();
  for (const [mac, v] of vmPerMac) {
    const r = righe.get(mac);
    if (!r) continue;
    const k = `${v.apparatoScansione}|${v.nome}`;
    perVm.set(k, [...(perVm.get(k) ?? []), r]);
  }
  for (const rr of perVm.values()) {
    if (rr.length < 2) continue;
    const ordinate = [...rr].sort((a, b) => a.chiave.localeCompare(b.chiave));
    const scelta = migliore(ordinate) ?? ordinate[0];
    for (const r of ordinate) righe.delete(r.chiave);
    const chiave = ordinate[0].chiave;
    righe.set(chiave, {
      ...scelta, chiave, mac: chiave, macs: ordinate.flatMap((r) => r.macs).sort(), ips: ordinaIp(ordinate.flatMap((r) => r.ips)), fonti: [...new Set(ordinate.flatMap((r) => r.fonti))],
      prove: ordinate.flatMap((r) => r.prove), perche: scelta.perche + altrove(scelta, ordinate), vecchio: ordinate.every((r) => r.vecchio),
    });
  }

  const senzaDoppie = (pp: Prova[]) => [...new Map(pp.map((p) => [`${p.apparato}|${p.porta}|${p.fonte}`, p])).values()];
  return [...righe.values()].map((r) => ({ ...r, ip: r.ip ?? r.ips[0] ?? null, nIp: r.ips.length, prove: senzaDoppie(r.prove) }))
    .sort((a, b) => (a.nome ?? "~").localeCompare(b.nome ?? "~", "it") || a.chiave.localeCompare(b.chiave));
}

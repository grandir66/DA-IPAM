/**
 * La regola della Mappa porte (piano 2026-11-07): dove sta ogni MAC, con quanta certezza e perché. Logica pura.
 *
 * Misurata il 07/11 contro il controller, su 60 MAC via cavo dell'hub: «la porta con meno MAC» sbagliava 11 volte,
 * «`is_trunk`=0» 13; questa 1 (lo stesso apparato su due porte), e negli altri casi dice «non so». Il principio: fra porte
 * di passaggio non si sceglie mai, una posizione falsa costa più di un «non so».
 *
 * `is_trunk` non si usa: vuol dire «più di un MAC» (hypervisor e PC dietro un telefono sono «trunk»). Le VLAN tagged non si
 * usano: le hanno anche hypervisor e AP. Lo spanning tree non si usa: manca su 3 switch su 5 dell'hub. Un vicino LLDP vale
 * solo se è un apparato di rete: lo annunciano anche hypervisor, NAS e telefoni. Gli hypervisor NON sono apparati di rete.
 *
 * Trappola della ProMax: l'agente mette i MAC del LAG 49-50 sulla porta FDB 1, e il client vero di Port 1 lo dice solo il
 * controller. Per questo una porta che è «passaggio» solo perché vede un apparato, con ≤2 client del controller, gli cede.
 */
import { isVirtualMac } from "@/lib/devices/mac-virtuali";
import { parseDbDate } from "@/lib/db-date";
import { normalizeMacForStorage } from "@/lib/utils";
import { completaOggetti } from "@/lib/mappa-porte/completa";
import { creaIndicePorte } from "@/lib/mappa-porte/nomi-porta";
import type {
  Confidenza, ConteggiMappa, DatoVlan, IngressoMappaPorte, ModoPorta, MotivoPassaggio, OggettoGrezzo, OggettoMappa, PortaMappa, Prova,
  RigaHost, RigaMacPorta, RigaPorta, RisultatoMappa, Spostamento, TipoPorta,
} from "@/lib/mappa-porte/tipi";

const GIORNO = 86_400_000;
/** Due letture di fonti diverse dello stesso giro: SNMP ogni 30 minuti, controller ogni ora. */
const STESSO_GIRO_MS = 2 * 3_600_000;
const TIPI_DI_RETE = new Set(["switch", "access_point", "router", "firewall"]);
const CLASSI_DI_RETE = new Set(["switch", "access_point", "router", "firewall"]);
const OUI_VM = ["BC:24:11", "00:50:56", "52:54:00"];
const FONTE: Record<string, string> = { device: "SNMP", unifi: "Controller", librenms: "LibreNMS" };

const chiaveP = (d: number, k: string) => `${d}|${k}`;
const norm = (s: string | null | undefined) => normalizeMacForStorage(s ?? null);
const eVm = (m: string) => OUI_VM.some((o) => m.toUpperCase().startsWith(o));

interface StatoPorta {
  deviceId: number; chiave: string; macs: Set<string>; clienti: Set<string>; motivi: Set<MotivoPassaggio>;
  righe: RigaPorta[]; nomiVisti: Set<string>; vicino: string | null; reteRemota: number | null; hypervisor: boolean;
}
interface RigaPos extends RigaMacPorta { mac: string; ms: number; chiave: string }

/** Modo, PVID e VLAN tagged di una porta o aggregato. */
function datiVlan(indici: number[], deviceId: number, ing: IngressoMappaPorte, inverso: boolean): { modo: ModoPorta; pvid: number | null; tagged: number[]; dato: DatoVlan } {
  const ids = new Set(indici);
  const righe = ing.vlanPorte.filter((r) => r.device_id === deviceId && ids.has(r.if_index) && r.egress === 1);
  const tagged = [...new Set(righe.filter((r) => r.untagged === 0).map((r) => r.vlan_id))].sort((a, b) => a - b);
  const nulli = [...new Set(righe.filter((r) => r.untagged == null).map((r) => r.vlan_id))];
  const unt = righe.filter((r) => r.untagged === 1);
  const nativa = ing.nativa.find((r) => r.device_id === deviceId && ids.has(r.if_index))?.vlan_id ?? null;
  const pvid = nativa ?? ing.pvid.find((r) => r.device_id === deviceId && ids.has(r.if_index))?.pvid ?? null;
  if (tagged.length > 0) return { modo: "trunk", pvid, tagged, dato: inverso && nativa == null ? "dedotto" : "letto" };
  if (nulli.length >= 2) return { modo: "trunk", pvid, tagged: nulli.filter((v) => v !== pvid).sort((a, b) => a - b), dato: "dedotto" };
  if (nulli.length === 1) return { modo: "accesso", pvid, tagged: [], dato: "dedotto" };
  if (unt.length > 0) return { modo: "accesso", pvid, tagged: [], dato: inverso && nativa == null ? "dedotto" : "letto" };
  return { modo: "non_letto", pvid, tagged: [], dato: pvid == null ? "non_letto" : "dedotto" };
}

function tipoDellaPorta(p: StatoPorta, macDiRete: ReadonlySet<string>, voip: ReadonlySet<string>, vmNote: ReadonlySet<string>): TipoPorta {
  if (p.chiave === "wifi") return "wifi";
  if (p.motivi.size > 0) return "passaggio";
  const n = [...p.macs].filter((m) => !macDiRete.has(m));
  if (p.hypervisor) return "hypervisor";
  if (n.length >= 2 && n.some((m) => vmNote.has(m) || eVm(m))) return "hypervisor";
  if (n.length === 0) return "vuota";
  if (n.length === 1) return "terminale";
  if (n.length === 2 && n.some((m) => voip.has(m))) return "telefono_pc";
  return "condivisa";
}

const CONFIDENZA: Record<TipoPorta, Confidenza> = {
  terminale: "certa", vuota: "certa", wifi: "certa", hypervisor: "spiegata", telefono_pc: "spiegata", condivisa: "da_capire", passaggio: "non_so",
};
const FRASE: Record<TipoPorta, string> = {
  terminale: "È l'unico MAC su una porta che non porta ad altri apparati di rete.",
  vuota: "È l'ultima porta dove è stato visto.",
  wifi: "Il controller lo dà collegato a questo access point.",
  hypervisor: "La porta è di un hypervisor: ci passano le sue macchine virtuali.",
  telefono_pc: "Sulla porta ci sono un telefono e l'apparato collegato dietro.",
  condivisa: "Sulla porta ci sono più MAC senza una spiegazione: forse uno switch non gestito.",
  passaggio: "",
};

export function calcolaMappa(ing: IngressoMappaPorte): RisultatoMappa {
  const soglia = ing.staleDays * GIORNO;
  const apparati = new Map(ing.apparati.map((a) => [a.id, a]));
  const diRete = (id: number): boolean => {
    const a = apparati.get(id);
    return !!a && TIPI_DI_RETE.has(a.device_type) && a.protocol !== "winrm"; // 8 PC sull'hub sono registrati come switch
  };
  const haPortediBordo = (id: number) => { const t = apparati.get(id)?.device_type; return t === "switch" || t === "access_point"; };
  const indice = creaIndicePorte(ing.porte, ing.fatti);

  const macPropri = new Map<string, Set<number>>();
  const macDiRete = new Set<string>();
  for (const r of ing.macApparati) {
    const m = norm(r.mac);
    if (!m || !diRete(r.device_id)) continue;
    macDiRete.add(m);
    macPropri.set(m, (macPropri.get(m) ?? new Set()).add(r.device_id));
  }
  const hostPerMac = new Map<string, RigaHost[]>();
  const hostRetePerNome = new Set<string>();
  const hostReteMac = new Set<string>();
  const voip = new Set<string>();
  for (const h of ing.hosts) {
    const m = norm(h.mac);
    const classe = h.classification ?? "";
    if (m) {
      hostPerMac.set(m, [...(hostPerMac.get(m) ?? []), h]);
      if (classe === "voip") voip.add(m);
      if (classe === "switch" || classe === "access_point") macDiRete.add(m);
      if (CLASSI_DI_RETE.has(classe)) hostReteMac.add(m);
    }
    if (CLASSI_DI_RETE.has(classe)) for (const n of [h.hostname, h.custom_name]) if (n) hostRetePerNome.add(n.trim().toLowerCase().split(".")[0]);
  }
  const vmPerMac = new Map(ing.vm.map((v) => [norm(v.mac) ?? v.mac, v]));
  const vmNote = new Set(vmPerMac.keys());
  const perNomeApparato = new Map<string, number>();
  for (const a of ing.apparati) if (diRete(a.id)) perNomeApparato.set(a.name.trim().toLowerCase(), a.id);

  const stati = new Map<string, StatoPorta>();
  const stato = (d: number, k: string): StatoPorta => {
    const c = chiaveP(d, k);
    let s = stati.get(c);
    if (!s) {
      s = { deviceId: d, chiave: k, macs: new Set(), clienti: new Set(), motivi: new Set(), righe: [], nomiVisti: new Set(), vicino: null, reteRemota: null, hypervisor: false };
      stati.set(c, s);
    }
    return s;
  };
  for (const r of ing.porte) {
    if (!diRete(r.device_id)) continue;
    const k = indice.chiave(r.device_id, r.port_name, AGGREGATA.test(r.port_name) ? null : r.port_index);
    if (!k) continue;
    const s = stato(r.device_id, k);
    s.righe.push(r);
    if (r.is_uplink === 1) s.motivi.add("uplink");
  }

  const righe: RigaPos[] = [];
  for (const r of ing.macPorte) {
    const mac = norm(r.mac);
    if (!mac || isVirtualMac(mac) || !diRete(r.device_id)) continue;
    const chiave = indice.chiave(r.device_id, r.port_name);
    if (!chiave) continue;
    const ms = parseDbDate(r.timestamp).getTime();
    righe.push({ ...r, mac, ms, chiave });
    const s = stato(r.device_id, chiave);
    s.nomiVisti.add(r.port_name);
    if (ing.nowMs - ms <= soglia) {
      s.macs.add(mac);
      if (r.source === "unifi") s.clienti.add(mac);
    }
  }

  // I vicini. La fonte `host` è il contrario: l'hypervisor dice su quale porta dello switch sta.
  const risolvi = (nome: string, mac: string | null): number | null => {
    const n = nome.trim().toLowerCase();
    const diretto = perNomeApparato.get(n);
    if (diretto != null) return diretto;
    for (const x of [norm(nome), norm(mac)]) {
      const d = x ? macPropri.get(x) : undefined;
      if (d) return [...d].sort((a, b) => a - b)[0];
    }
    return null;
  };
  const eDiRete = (nome: string, mac: string | null, id: number | null): boolean => {
    if (id != null) return true;
    const m = norm(mac) ?? norm(nome);
    return (!!m && hostReteMac.has(m)) || hostRetePerNome.has(nome.trim().toLowerCase().split(".")[0]);
  };
  const porteHypervisor = new Map<number, Array<{ device: number; chiave: string }>>();
  const versoApparato = new Map<number, Array<{ device: number; chiave: string; fonte: string }>>();
  for (const v of ing.vicini) {
    if (v.protocol !== "lldp" && v.protocol !== "cdp") continue;
    if (v.source === "host") {
      const sw = risolvi(v.remote_device_name, v.remote_mac);
      const k = sw != null ? indice.chiave(sw, v.remote_port) : null;
      if (sw == null || !k) continue;
      stato(sw, k).hypervisor = true;
      porteHypervisor.set(v.device_id, [...(porteHypervisor.get(v.device_id) ?? []), { device: sw, chiave: k }]);
      continue;
    }
    if (!diRete(v.device_id)) continue;
    const k = indice.chiave(v.device_id, v.local_port, v.local_port_index);
    if (!k) continue;
    const s = stato(v.device_id, k);
    const remoto = risolvi(v.remote_device_name, v.remote_mac);
    s.vicino ??= remoto != null ? apparati.get(remoto)?.name ?? v.remote_device_name : v.remote_device_name || null;
    if (eDiRete(v.remote_device_name, v.remote_mac, remoto)) {
      s.motivi.add("lldp");
      if (remoto != null && remoto !== v.device_id) {
        s.reteRemota ??= remoto;
        versoApparato.set(remoto, [...(versoApparato.get(remoto) ?? []), { device: v.device_id, chiave: k, fonte: v.source }]);
      }
    }
  }
  for (const s of stati.values()) {
    for (const m of s.macs) {
      if (macDiRete.has(m) && !macPropri.get(m)?.has(s.deviceId)) { s.motivi.add("vede_apparato"); break; }
    }
  }
  const tipi = new Map<string, TipoPorta>();
  for (const [c, s] of stati) tipi.set(c, tipoDellaPorta(s, macDiRete, voip, vmNote));

  const nomeApparato = (d: number) => apparati.get(d)?.name ?? `apparato ${d}`;
  const nomePorta = (s: StatoPorta): string => {
    if (s.chiave === "wifi") return "wifi";
    if (s.chiave.startsWith("lag:")) return `LAG ${s.chiave.slice(4)}`;
    // Il nome più corto che le fonti danno: «Port 5», non «Slot: 0 Port: 5 Gigabit - Level».
    const nomi = [...s.righe.map((r) => r.port_name), ...s.nomiVisti].map(nomeBreve).sort((x, y) => x.length - y.length || x.localeCompare(y));
    return nomi[0] ?? s.chiave.replace(/^[in]:/, "");
  };

  // Le righe di ogni oggetto: nome, IP, tipo.
  const macIp = new Map(ing.macIp.map((r) => [norm(r.mac_normalized) ?? r.mac_normalized, r]));
  const identita = (mac: string) => {
    const hh = hostPerMac.get(mac) ?? [];
    const h = hh.find((x) => x.status === "online") ?? hh[0];
    const vm = vmPerMac.get(mac);
    const mi = macIp.get(mac);
    return {
      nome: h?.custom_name || h?.hostname || vm?.nome || mi?.hostname || (h?.vendor ?? mi?.vendor ?? null),
      ip: h?.ip ?? mi?.ip ?? null,
      nIp: Math.max(hh.length, mi || hh.length ? 1 : 0),
      tipo: h?.classification ?? (vm ? "vm" : null),
      hostId: h?.id ?? null,
      senzaHost: !h && !vm,
    };
  };

  const perMac = new Map<string, RigaPos[]>();
  for (const r of righe) perMac.set(r.mac, [...(perMac.get(r.mac) ?? []), r]);
  const oggetti: OggettoGrezzo[] = [];

  for (const [mac, tutte] of perMac) {
    if (macPropri.has(mac)) continue; // gli apparati di rete hanno una riga per apparato, sotto
    const ultimo = Math.max(...tutte.map((r) => r.ms));
    const vecchio = ing.nowMs - ultimo > soglia;
    const recenti = tutte.filter((r) => ultimo - r.ms <= soglia);
    const bordo = recenti.filter((r) => haPortediBordo(r.device_id));
    const prove: Prova[] = [];
    const visti = new Map<string, Prova>();
    for (const r of [...recenti].sort((a, b) => b.ms - a.ms)) {
      const c = chiaveP(r.device_id, r.chiave);
      const s = stati.get(c)!;
      const f = FONTE[r.source] ?? r.source;
      const gia = visti.get(c);
      if (gia) { if (!gia.fonte.includes(f)) gia.fonte += ` · ${f}`; continue; }
      const p: Prova = { apparato: nomeApparato(r.device_id), porta: nomePorta(s), tipo: tipi.get(c) ?? "vuota", nMac: s.macs.size, fonte: f, visto: r.timestamp };
      visti.set(c, p);
      prove.push(p);
    }
    const id = identita(mac);
    const base = {
      chiave: mac, categoria: "dispositivo" as const, mac, ip: id.ip, nIp: id.nIp, nome: id.nome, tipo: id.tipo, hostId: id.hostId, apparatoId: null,
      prove, senzaHost: id.senzaHost, vecchio, visto: new Date(ultimo).toISOString().slice(0, 19).replace("T", " "),
      fonti: [...new Set(recenti.map((r) => FONTE[r.source] ?? r.source))],
    };
    const conVlan = (rr: RigaPos[]): number | null => [...rr].sort((a, b) => b.ms - a.ms).find((r) => r.vlan != null)?.vlan ?? null;

    const wifi = bordo.filter((r) => r.chiave === "wifi").sort((a, b) => b.ms - a.ms)[0];
    if (wifi && ultimo - wifi.ms <= STESSO_GIRO_MS) {
      oggetti.push({
        ...base, confidenza: "certa", deviceId: wifi.device_id, apparato: nomeApparato(wifi.device_id), portaChiave: "wifi", porta: "wifi", tipoPorta: "wifi",
        vlan: conVlan(recenti), ramo: null, perche: FRASE.wifi, conflitto: false, dedotta: false,
      });
      continue;
    }

    const cedeAlController = (r: RigaPos): boolean => {
      if (r.source !== "unifi") return false;
      const s = stati.get(chiaveP(r.device_id, r.chiave))!;
      return s.motivi.size === 1 && s.motivi.has("vede_apparato") && s.clienti.size <= 2;
    };
    const diBordo = bordo.filter((r) => r.chiave !== "wifi" && (tipi.get(chiaveP(r.device_id, r.chiave)) !== "passaggio" || cedeAlController(r)));
    const delController = diBordo.filter((r) => r.source === "unifi");
    const scelte = delController.length > 0 ? delController : diBordo;
    if (scelte.length > 0) {
      const ultima = Math.max(...scelte.map((r) => r.ms));
      const stessoGiro = scelte.filter((r) => ultima - r.ms <= STESSO_GIRO_MS);
      const porte = [...new Map(stessoGiro.map((r) => [chiaveP(r.device_id, r.chiave), r])).values()].sort((a, b) => b.ms - a.ms);
      const r = porte[0];
      const c = chiaveP(r.device_id, r.chiave);
      const s = stati.get(c)!;
      const ceduta = tipi.get(c) === "passaggio";
      const tipo: TipoPorta = ceduta ? "terminale" : tipi.get(c)!;
      const conflitto = porte.length > 1;
      const altre = porte.slice(1).map((x) => `${nomeApparato(x.device_id)} · ${nomePorta(stati.get(chiaveP(x.device_id, x.chiave))!)}`);
      oggetti.push({
        ...base, confidenza: conflitto ? "da_capire" : ceduta ? "certa" : CONFIDENZA[tipo], deviceId: r.device_id, apparato: nomeApparato(r.device_id), portaChiave: r.chiave, porta: nomePorta(s),
        tipoPorta: tipo, vlan: conVlan(stessoGiro) ?? conVlan(recenti), ramo: null, conflitto, dedotta: false,
        perche: conflitto ? `Visto nello stesso giro anche su ${altre.join(", ")}.` : ceduta ? "Il controller lo dà su questa porta; le tabelle SNMP dello switch la confondono con un collegamento." : FRASE[tipo],
      });
      continue;
    }

    // Nessuna porta di bordo: non si sceglie. Si dice dove si ferma quello che sappiamo.
    const rami = bordo
      .map((r) => stati.get(chiaveP(r.device_id, r.chiave))!)
      .filter((s) => s.reteRemota != null && !recenti.some((r) => r.device_id === s.reteRemota));
    const ramo = rami[0];
    const senzaSwitch = bordo.length === 0;
    oggetti.push({
      ...base, confidenza: "non_so", deviceId: null, apparato: null, portaChiave: null, porta: null, tipoPorta: null, vlan: conVlan(recenti), conflitto: false, dedotta: false,
      ramo: ramo ? `A valle di ${nomeApparato(ramo.deviceId)} · ${nomePorta(ramo)}` : senzaSwitch ? `Solo sul router ${nomeApparato(recenti[0].device_id)}` : `Solo su porte di passaggio (${prove.length})`,
      perche: senzaSwitch ? "Lo vede solo un router: nessuno switch dice su quale porta sta." : "Lo vedono solo porte che portano ad altri apparati: scegliere fra queste darebbe una posizione falsa.",
    });
  }

  // VM accese che nessuna tabella vede: ereditano la porta del loro hypervisor.
  const hypervisorDi = (v: { nodo: string; apparatoScansione: number }): number | null => {
    const n = v.nodo.trim().toLowerCase();
    const a = n ? ing.apparati.find((x) => x.device_type === "hypervisor" && x.name.trim().toLowerCase().split(".")[0] === n.split(".")[0]) : undefined;
    return a?.id ?? (porteHypervisor.has(v.apparatoScansione) ? v.apparatoScansione : null);
  };
  for (const [mac, v] of vmPerMac) {
    if (perMac.has(mac) || !v.acceso || isVirtualMac(mac)) continue;
    const id = identita(mac);
    const hyp = hypervisorDi(v);
    const porta = hyp != null ? porteHypervisor.get(hyp)?.[0] : undefined;
    const s = porta ? stati.get(chiaveP(porta.device, porta.chiave)) : undefined;
    const base = {
      chiave: mac, categoria: "dispositivo" as const, mac, ip: id.ip, nIp: id.nIp, nome: id.nome, tipo: "vm", hostId: id.hostId, apparatoId: null, prove: [], senzaHost: false,
      vecchio: false, visto: null, fonti: ["Proxmox"], vlan: null, conflitto: false,
    };
    oggetti.push(porta && s
      ? { ...base, confidenza: "spiegata", deviceId: porta.device, apparato: nomeApparato(porta.device), portaChiave: porta.chiave, porta: nomePorta(s), tipoPorta: "hypervisor", ramo: null, dedotta: true, perche: `Nessuna tabella la vede: la posizione viene dal suo hypervisor${hyp != null ? ` ${nomeApparato(hyp)}` : ""}.` }
      : { ...base, confidenza: "non_so", deviceId: null, apparato: null, portaChiave: null, porta: null, tipoPorta: null, ramo: hyp != null ? `Sull'hypervisor ${nomeApparato(hyp)}` : `Sul nodo ${v.nodo}`, dedotta: true, perche: "Nessuna tabella la vede e la porta del suo hypervisor non è nota." });
  }

  // Host online che nessuna tabella vede.
  for (const [mac, hh] of hostPerMac) {
    if (perMac.has(mac) || vmPerMac.has(mac) || macPropri.has(mac) || isVirtualMac(mac) || !hh.some((h) => h.status === "online")) continue;
    const id = identita(mac);
    oggetti.push({
      chiave: mac, categoria: "dispositivo", mac, ip: id.ip, nIp: id.nIp, nome: id.nome, tipo: id.tipo, hostId: id.hostId, apparatoId: null, confidenza: "non_so", deviceId: null, apparato: null,
      portaChiave: null, porta: null, tipoPorta: null, vlan: null, ramo: "Nessuna tabella lo vede", perche: "È online ma nessuno switch, access point o router lo riporta.", fonti: [], prove: [], conflitto: false,
      dedotta: false, vecchio: false, senzaHost: false, visto: null,
    });
  }

  // Gli apparati di rete: una riga per apparato, dalla porta del vicino che lo annuncia.
  const primoMac = new Map<number, string>();
  for (const [m, dd] of macPropri) for (const d of dd) if (!primoMac.has(d) || m < primoMac.get(d)!) primoMac.set(d, m);
  for (const a of [...ing.apparati].sort((x, y) => x.id - y.id)) {
    if (!diRete(a.id)) continue;
    const dove = (versoApparato.get(a.id) ?? []).sort((x, y) => x.device - y.device);
    const v = dove[0];
    const s = v ? stati.get(chiaveP(v.device, v.chiave)) : undefined;
    const prove: Prova[] = dove.flatMap((d) => {
      const st = stati.get(chiaveP(d.device, d.chiave));
      return st ? [{ apparato: nomeApparato(d.device), porta: nomePorta(st), tipo: "passaggio" as const, nMac: st.macs.size, fonte: d.fonte === "unifi" ? "LLDP · Controller" : "LLDP", visto: "" }] : [];
    });
    oggetti.push({
      chiave: `dev:${a.id}`, categoria: "apparato", mac: primoMac.get(a.id) ?? null, ip: null, nIp: 0, nome: a.name, tipo: a.device_type, hostId: null, apparatoId: a.id,
      confidenza: v && s ? "certa" : "non_so", deviceId: v?.device ?? null, apparato: v ? nomeApparato(v.device) : null, portaChiave: v?.chiave ?? null, porta: s ? nomePorta(s) : null, tipoPorta: s ? "passaggio" : null,
      vlan: null, ramo: v ? null : "Nessun vicino lo annuncia", perche: v ? `Lo annuncia via LLDP/CDP ${nomeApparato(v.device)}.` : "Nessun apparato letto lo annuncia via LLDP o CDP.", fonti: v ? ["LLDP"] : [], prove,
      conflitto: false, dedotta: false, vecchio: false, senzaHost: false, visto: null,
    });
  }

  const porte = costruisciPorte(ing, [...stati.values()], tipi, nomeApparato, nomePorta);
  const tutti = completaOggetti(oggetti, ing, diRete);
  const vivi = tutti.filter((o) => o.categoria === "dispositivo" && !o.vecchio);
  const quanti = (c: Confidenza) => vivi.filter((o) => o.confidenza === c).length;
  const conTabella = new Set(righe.filter((r) => r.source === "device" && ing.nowMs - r.ms <= soglia).map((r) => r.device_id));
  const soloController = new Set(righe.filter((r) => r.source === "unifi" && ing.nowMs - r.ms <= soglia && !conTabella.has(r.device_id)).map((r) => r.device_id));
  const conteggi: ConteggiMappa = {
    certe: quanti("certa"), spiegate: quanti("spiegata"), daCapire: quanti("da_capire"), nonSo: quanti("non_so"),
    senzaHost: vivi.filter((o) => o.senzaHost).length, apparatiConTabella: conTabella.size, apparatiSoloController: soloController.size,
  };
  return { oggetti: tutti, porte, conteggi };
}

const AGGREGATA = /^link aggregate \d+/i;
const nomeBreve = (n: string): string => n.trim().replace(/^Slot:\s*\d+\s+Port:\s*(\d+).*$/i, "Port $1").replace(/^Port(\d+)$/i, "Port $1");
const LOGICA = /^(?:port-channel|tunnel|loopback|user defined|logic|vlan|vrf-)/i;

function costruisciPorte(ing: IngressoMappaPorte, stati: StatoPorta[], tipi: ReadonlyMap<string, TipoPorta>, nomeApparato: (d: number) => string, nomePorta: (s: StatoPorta) => string): PortaMappa[] {
  const inversi = new Set(ing.vlanLetture.filter((r) => r.ordine_bit === "inverso").map((r) => r.device_id));
  const indiceMk = creaIndicePorte(ing.porte, ing.fatti);
  const mk = new Map<string, { pvid: number | null; tagged: Set<number> }>();
  const voceMk = (d: number, k: string) => {
    const c = chiaveP(d, k);
    const v = mk.get(c) ?? { pvid: null, tagged: new Set<number>() };
    mk.set(c, v);
    return v;
  };
  for (const r of ing.mkPorte) {
    const k = indiceMk.chiave(r.device_id, r.interface);
    if (k) voceMk(r.device_id, k).pvid = r.pvid;
  }
  for (const r of ing.mkVlan) {
    const vlan = r.vlan_ids.split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0);
    for (const nome of (r.tagged ?? r.current_tagged ?? "").split(",")) {
      const k = nome.trim() ? indiceMk.chiave(r.device_id, nome) : null;
      if (k) for (const v of vlan) voceMk(r.device_id, k).tagged.add(v);
    }
  }
  const risultato: PortaMappa[] = stati.map((s) => {
    const indici = s.righe.map((r) => r.port_index);
    const fisiche = s.righe.filter((r) => !AGGREGATA.test(r.port_name));
    const leg = mk.get(chiaveP(s.deviceId, s.chiave));
    const dv = leg
      ? { modo: (leg.tagged.size > 0 ? "trunk" : leg.pvid != null ? "accesso" : "non_letto") as ModoPorta, pvid: leg.pvid, tagged: [...leg.tagged].sort((a, b) => a - b), dato: "letto" as DatoVlan }
      : datiVlan(indici, s.deviceId, ing, inversi.has(s.deviceId));
    const conPoe = s.righe.filter((r) => r.poe_status != null);
    const poeMw = s.righe.reduce<number | null>((t, r) => (r.poe_power_mw != null ? (t ?? 0) + r.poe_power_mw : t), null);
    const stpStati = s.righe.map((r) => r.stp_state).filter((x): x is string => !!x);
    const isLag = s.chiave.startsWith("lag:");
    return {
      deviceId: s.deviceId, chiave: s.chiave, apparato: nomeApparato(s.deviceId), ordine: isLag ? 100_000 + (Number(s.chiave.slice(4)) || 0) : Math.min(...indici, 99_999),
      nome: nomePorta(s), membri: isLag ? fisiche.map((r) => r.port_name) : [],
      stato: s.righe.some((r) => r.status === "up") ? "up" : s.righe[0]?.status ?? null,
      velocita: s.righe.find((r) => r.speed)?.speed ?? null,
      modo: dv.modo, pvid: dv.pvid ?? s.righe.find((r) => r.vlan != null)?.vlan ?? null, vlanTagged: dv.tagged, datoVlan: dv.dato,
      poeStato: conPoe[0]?.poe_status ?? null, poeMw,
      stp: stpStati.includes("blocking") ? "blocking" : stpStati[0] ?? null,
      tipo: tipi.get(chiaveP(s.deviceId, s.chiave)) ?? "vuota", vicino: s.vicino, nMac: s.macs.size, motivi: [...s.motivi],
    };
  });
  // Gli switch elencano aggregati e interfacce logiche mai usati (26 «Link Aggregate» su uno switch, 32 «Port-Channel»): non sono porte.
  const usata = (p: PortaMappa) => p.nMac > 0 || p.vicino != null || p.motivi.length > 0;
  const fantasma = (p: PortaMappa) => !usata(p) && ((p.chiave.startsWith("lag:") && p.membri.length === 0) || (p.stato !== "up" && LOGICA.test(p.nome)));
  return risultato.filter((p) => !fantasma(p)).sort((a, b) => a.apparato.localeCompare(b.apparato, "it") || a.ordine - b.ordine || a.chiave.localeCompare(b.chiave));
}

/** Chi ha cambiato porta fra due calcoli. Solo posizioni di cui ci si fida; un passaggio da AP ad AP è il wifi che fa il wifi. */
export function trovaSpostamenti(prima: ReadonlyArray<OggettoMappa>, dopo: ReadonlyArray<OggettoMappa>): Spostamento[] {
  const fidata = (o: OggettoMappa) => o.categoria === "dispositivo" && !o.dedotta && !o.vecchio && !o.conflitto && (o.confidenza === "certa" || o.confidenza === "spiegata") && o.deviceId != null;
  const vecchie = new Map(prima.filter(fidata).map((o) => [o.chiave, o]));
  const fuori: Spostamento[] = [];
  for (const o of dopo) {
    const p = vecchie.get(o.chiave);
    if (!p || !fidata(o) || (p.deviceId === o.deviceId && p.portaChiave === o.portaChiave)) continue;
    if (p.portaChiave === "wifi" && o.portaChiave === "wifi") continue;
    fuori.push({ chiave: o.chiave, mac: o.mac, nome: o.nome, daApparato: p.apparato ?? "", daPorta: p.porta ?? "", aApparato: o.apparato ?? "", aPorta: o.porta ?? "" });
  }
  return fuori;
}

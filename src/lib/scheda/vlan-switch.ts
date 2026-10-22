/**
 * Tab VLAN degli switch (piano 2026-10-22 accorpamento, Task 11; artboard SwitchVlan V1-V7): la matrice porte × VLAN
 * dalle quattro tabelle `switch_vlan*` (lettura «VLAN degli switch via SNMP», ADR 0029) e la striscia trunk/access.
 * Righe = le porte di `switch_ports` (stesso ordine della tab Porte); colonne = VLAN lette + PVID. Modulo puro: niente DB,
 * niente React (la rotta `GET /api/devices/[id]/vlan-switch` lo chiama, la tab lo rende).
 */
import type { Fonte } from "@/components/scheda/riga-fonti";
import type { CellaVlan, ColonnaVlan, MatriceVlanBase, RigaMatrice, StatoPortaMatrice } from "./matrice-vlan";
import { oraItaliana } from "./mikrotik";
import { eSfp, numeroPorta, type PortaSwitch } from "./porte-da-guardare";

/** La riga di `switch_ports` che serve qui (i campi del vicino e dell'host danno la nota accanto al nome). */
export interface PortaPerMatrice {
  port_index: number;
  port_name: string;
  status: "up" | "down" | "disabled" | string | null;
  vlan: number | null;
  is_trunk?: number;
  mac_count?: number;
  single_mac_hostname?: string | null;
  single_mac_ip?: string | null;
  trunk_neighbor_name?: string | null;
}

/** Stessa forma di `VlanSwitchDb` di `db-tenant` (scritta qui per non importare il modulo del DB nel codice della pagina). */
export interface DatiVlanSwitch {
  vlan: Array<{ vlan_id: number; nome: string | null }>;
  porte: Array<{ vlan_id: number; if_index: number; egress: boolean; untagged: boolean | null }>;
  pvid: Array<{ if_index: number; pvid: number }>;
  lettura: { letto_il: string; ordine_bit: "standard" | "inverso" } | null;
}

/** `porta` = presa normale; `sfp` = porte SFP+/10G (in fondo, artboard V5); `aggregato` = LAG («Link Aggregate N»). */
export type GruppoPorta = "porta" | "sfp" | "aggregato";
export interface RigaMatriceSwitch extends RigaMatrice { if_index: number; gruppo: GruppoPorta; senza_vlan: boolean }

export interface MatriceVlanSwitch extends MatriceVlanBase {
  righe: RigaMatriceSwitch[];
  /** "completa": untagged dichiarati; "dedotta": solo egress, U dal PVID; "solo_pvid": lettura spenta o mai fatta, colonne dai PVID di switch_ports. */
  qualita: "completa" | "dedotta" | "solo_pvid";
  /** Contata sulle porte fisiche (prese e SFP+): un aggregato spento con PVID 1 non è una «porta access». */
  striscia: { vlan: number; trunk: number; access: number; senza_vlan: number };
}

const eAggregato = (nome: string): boolean => /aggregat|port-?channel|^po\d|^lag\b|^trk\d|^bond/i.test(nome.trim());
/** SFP+: il nome lo dice («SFP+ 1»), o la velocità nel nome dell'interfaccia («Slot: 0 Port: 49 10G - Level»). */
const eSfpSwitch = (p: PortaPerMatrice): boolean => eSfp(p as unknown as PortaSwitch) || /\b(10|25|40|100)G\b/i.test(p.port_name);

function statoPorta(s: PortaPerMatrice["status"]): StatoPortaMatrice {
  if (s === "up") return "attiva";
  if (s === "disabled") return "disabilitata";
  return "inattiva";
}

/** «Porta 17», «SFP+ 49»; un aggregato tiene il suo nome. */
function etichetta(p: PortaPerMatrice, gruppo: GruppoPorta): string {
  if (gruppo === "aggregato") return p.port_name.trim();
  const n = numeroPorta(p as unknown as PortaSwitch);
  return gruppo === "sfp" ? `SFP+ ${n}` : `Porta ${n}`;
}

/** Accanto al nome (artboard V3/V6): il vicino del trunk come «uplink …», altrimenti l'unico host visto sulla porta. */
function nota(p: PortaPerMatrice): string | null {
  if (p.trunk_neighbor_name?.trim()) return `uplink ${p.trunk_neighbor_name.trim()}`;
  if (p.mac_count === 1) return p.single_mac_hostname?.trim() || p.single_mac_ip?.trim() || null;
  return null;
}

export function matriceVlanSwitch(i: { porte: PortaPerMatrice[]; db: DatiVlanSwitch | null }): MatriceVlanSwitch {
  const porte = [...i.porte].sort((a, b) => a.port_index - b.port_index);
  const db = i.db?.lettura ? i.db : null;

  let qualita: MatriceVlanSwitch["qualita"];
  let colonne: ColonnaVlan[];
  let pvidDi: (p: PortaPerMatrice) => number | null;
  let cellaDi: (p: PortaPerMatrice, vlan: number) => CellaVlan;

  if (!db) {
    // Senza lettura: la matrice di prima, colonne dalle VLAN di switch_ports e solo la U implicita del PVID.
    qualita = "solo_pvid";
    const ids = [...new Set(porte.map((p) => p.vlan).filter((v): v is number => v != null))].sort((a, b) => a - b);
    colonne = ids.map((id) => ({ id, etichetta: String(id), nome: null }));
    pvidDi = (p) => p.vlan;
    cellaDi = (p, v) => (p.vlan === v ? "U" : null);
  } else {
    // «dedotta»: lo switch non dichiara gli untagged, o li scrive al contrario (ProMax, caso 5 del piano).
    qualita = db.lettura!.ordine_bit === "inverso" || db.porte.some((x) => x.untagged === null) ? "dedotta" : "completa";
    const nomi = new Map(db.vlan.map((v) => [v.vlan_id, v.nome]));
    const pvid = new Map(db.pvid.map((x) => [x.if_index, x.pvid]));
    const membro = new Map(db.porte.map((x) => [`${x.vlan_id}|${x.if_index}`, x]));
    const ids = [...new Set([...db.vlan.map((v) => v.vlan_id), ...db.porte.map((x) => x.vlan_id), ...db.pvid.map((x) => x.pvid)])].sort((a, b) => a - b);
    colonne = ids.map((id) => ({ id, etichetta: String(id), nome: nomi.get(id) ?? null }));
    pvidDi = (p) => pvid.get(p.port_index) ?? null;
    cellaDi = (p, v) => {
      const e = membro.get(`${v}|${p.port_index}`);
      const proprio = pvid.get(p.port_index) === v;
      if (e?.egress) {
        // Come i MikroTik: untagged → U, egress → T, PVID → U. Dedotta: egress sul proprio PVID → U, altrimenti T.
        if (qualita === "dedotta") return proprio ? "U" : "T";
        if (e.untagged) return "U";
        return "T";
      }
      return proprio ? "U" : null;
    };
  }

  const righe: RigaMatriceSwitch[] = porte.map((p) => {
    const gruppo: GruppoPorta = eAggregato(p.port_name) ? "aggregato" : eSfpSwitch(p) ? "sfp" : "porta";
    const celle = colonne.map((c) => cellaDi(p, c.id!));
    return {
      porta: etichetta(p, gruppo), stato: statoPorta(p.status), pvid: pvidDi(p), nota: nota(p), celle,
      if_index: p.port_index, gruppo, senza_vlan: celle.every((c) => c === null),
    };
  });

  const fisiche = righe.filter((r) => r.gruppo !== "aggregato");
  const trunk = fisiche.filter((r) => r.celle.includes("T")).length;
  const access = fisiche.filter((r) => !r.celle.includes("T") && r.celle.includes("U")).length;
  return {
    colonne, righe, qualita,
    striscia: { vlan: colonne.length, trunk, access, senza_vlan: fisiche.length - trunk - access },
  };
}

/**
 * Come si divide la matrice nella tab (artboard V4-V5): le prese con almeno una VLAN, le porte senza VLAN (chiuse in una
 * riga «+N porte senza VLAN»), le SFP+ in fondo, gli aggregati attivi, quelli spenti a parte (chiusi). Ogni riga una volta.
 */
export function sezioniMatriceSwitch(m: MatriceVlanSwitch): {
  porte: RigaMatriceSwitch[]; senza: RigaMatriceSwitch[]; sfp: RigaMatriceSwitch[]; aggregati: RigaMatriceSwitch[]; aggregatiSpenti: RigaMatriceSwitch[];
} {
  const conVlan = m.righe.filter((r) => !r.senza_vlan);
  return {
    porte: conVlan.filter((r) => r.gruppo === "porta"),
    senza: m.righe.filter((r) => r.senza_vlan && r.gruppo !== "aggregato"),
    sfp: conVlan.filter((r) => r.gruppo === "sfp"),
    aggregati: m.righe.filter((r) => r.gruppo === "aggregato" && r.stato !== "disabilitata" && !r.senza_vlan),
    aggregatiSpenti: m.righe.filter((r) => r.gruppo === "aggregato" && (r.stato === "disabilitata" || r.senza_vlan)),
  };
}

/** Stato della lettura per la riga delle fonti: `letto_il` = età dei dati, `esito` = ultimo tentativo (anche fallito). */
export interface LetturaVlanSwitchScheda {
  acceso: boolean;
  letto_il: string | null;
  esito: { il: string; comandi: number; riusciti: number; codice: string | null } | null;
}

/** Perché la matrice è solo dai PVID, con le stesse parole della riga delle fonti: «spenta», «mai fatta», «non riuscita: <codice>». */
export function statoLetturaVlanSwitch(l: LetturaVlanSwitchScheda): string {
  if (!l.acceso) return "spenta";
  return l.esito?.codice ? `non riuscita: ${l.esito.codice}` : "mai fatta";
}

/** «Dati da: ✓ SNMP (Q-BRIDGE) <ora>» con l'ora dei DATI, o perché non ci sono (spenta, mai letta, non riuscita: <codice>). */
export function fonteVlanSwitch(l: LetturaVlanSwitchScheda): Fonte {
  const nome = "SNMP (Q-BRIDGE)";
  const fallita = l.esito?.codice ? l.esito : null;
  if (l.letto_il) {
    const coda = !l.acceso
      ? " · lettura spenta"
      : fallita && fallita.il > l.letto_il ? ` · ultima prova ${oraItaliana(fallita.il)} non riuscita: ${fallita.codice}` : "";
    return { nome, esito: "ok", quando: oraItaliana(l.letto_il) + coda };
  }
  if (!l.acceso) return { nome, esito: "assente", nota: "lettura spenta" };
  if (fallita) return { nome, esito: "assente", nota: `non riuscita: ${fallita.codice}` };
  return { nome, esito: "assente", nota: "mai letta" };
}

/**
 * Una porta, una chiave (piano Mappa porte, passo 2). La stessa porta ha nomi diversi secondo chi la legge: sull'hub 77
 * porte su 150 ne hanno più d'uno («Slot: 0 Port: 5 Gigabit - Level», «Port 5», l'alias del controller). Chiavi:
 * «i:<indice>», «lag:<gruppo>», «wifi», «n:<nome>» per ciò che non si riconosce; null = la CPU o il bridge, che non sono
 * una porta dove sta qualcosa. Trappola: «SFP+ 1» NON è l'indice 1 (su uno switch a 48 porte è la 49): l'indice lo dice
 * solo il controller. Il membro di un LAG si piega sull'aggregato: i MAC si contano lì. Logica pura.
 */
import type { RigaFatto, RigaPorta } from "@/lib/mappa-porte/tipi";

const CPU = /^(?:cpu interface\b.*|bridge\d*|port\s*0)$/;
const AGGREGATO = /^link aggregate (\d+)/;
const SFP = /^(sfp28|sfp\+)\s*(\d+)/;
const PORTA_N = /^(?:port|slot:\s*\d+\s+port:)\s*(\d+)/;

const basso = (s: string) => s.trim().toLowerCase();
const conPiu = (s: string) => basso(s).replace(/_/g, "+");
const baseSfp = (s: string): string | null => {
  const m = SFP.exec(s);
  return m ? `${m[1]} ${m[2]}` : null;
};

export interface IndicePorte {
  /** La chiave della porta, o null se non è una porta (CPU, bridge) o il nome è vuoto. */
  chiave(deviceId: number, nome: string, indice?: number | null): string | null;
}

export function creaIndicePorte(porte: ReadonlyArray<Pick<RigaPorta, "device_id" | "port_index" | "port_name">>, fatti: ReadonlyArray<RigaFatto>): IndicePorte {
  const perNome = new Map<string, number>();
  const delController = new Map<string, number>();
  const lagIndice = new Map<string, string>();
  const lagNome = new Map<string, string>();
  for (const p of porte) perNome.set(`${p.device_id}|${basso(p.port_name)}`, p.port_index);
  for (const f of fatti) {
    const gruppo = f.lag_group?.trim() ? (f.lag_group.startsWith("lag:") ? f.lag_group : `lag:${f.lag_group}`) : null;
    if (f.source === "controller" && f.port_index != null) {
      const n = conPiu(f.port_name);
      delController.set(`${f.device_id}|${n}`, f.port_index);
      const b = baseSfp(n);
      if (b) delController.set(`${f.device_id}|${b}`, f.port_index);
      if (gruppo) lagIndice.set(`${f.device_id}|${f.port_index}`, gruppo);
    } else if (gruppo) {
      lagNome.set(`${f.device_id}|${basso(f.port_name)}`, gruppo);
    }
  }
  const indiceDi = (d: number, l: string): number | null => {
    const n = l.replace(/_/g, "+");
    const b = baseSfp(n);
    const m = PORTA_N.exec(l);
    return perNome.get(`${d}|${l}`) ?? delController.get(`${d}|${n}`) ?? (b ? delController.get(`${d}|${b}`) : undefined) ?? (m ? Number(m[1]) : null);
  };
  return {
    chiave(deviceId, nome, indice) {
      // Il MikroTik scrive la porta seguita dal suo bridge: «sfp28-1,bond1,br_in».
      const l = basso(nome).split(",")[0].trim();
      if (indice == null && l === "") return null;
      if (l.startsWith("wifi")) return "wifi";
      if (CPU.test(l)) return null;
      const agg = AGGREGATO.exec(l);
      if (agg) return `lag:${agg[1]}`;
      const i = indice ?? indiceDi(deviceId, l);
      const gruppo = (i != null ? lagIndice.get(`${deviceId}|${i}`) : undefined) ?? lagNome.get(`${deviceId}|${l}`);
      if (gruppo) return gruppo;
      return i != null ? `i:${i}` : `n:${l}`;
    },
  };
}

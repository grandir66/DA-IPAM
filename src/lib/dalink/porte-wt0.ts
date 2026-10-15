/**
 * Le porte aperte sull'interfaccia NetBird (`wt0`), lette dal sistema vivo (tappa C1).
 *
 * Servono a R5 (spec NetBird §4.3): il segnale di vita dice quali porte l'istanza apre
 * su `wt0`, e DA-Link le confronta con l'elenco atteso (Wazuh mai).
 *
 * Fonti, in quest'ordine:
 * 1. `firewall`: la tabella `inet dalink` caricata (`nft -j list table inet dalink`),
 *    quella che scrive `scripts/dalink/firewall-wt0.sh`. Vale solo se la catena finisce
 *    con lo scarto: senza, la tabella non chiude niente.
 * 2. `ascolto`: senza tabella, le porte TCP in ascolto raggiungibili da `wt0`
 *    (indirizzo jolly o indirizzo di `wt0`) da `/proc/net/tcp*`. È il caso peggiore: per
 *    R5 sbaglia per eccesso, mai per difetto.
 * 3. `non_so`: niente `/proc` (non Linux, cioè lo sviluppo su Mac). Lista vuota, e la
 *    fonte lo dice nel segnale (`salute.firewall_wt0`).
 *
 * DA-IPAM gira come root sulle appliance (deploy/da-invent.service): `nft` si può leggere.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

export const INTERFACCIA = "wt0";
const TABELLA = "dalink";
const CATENA = "ingresso_wt0";

export type FontePorte = "firewall" | "ascolto" | "non_so";

export interface PorteWt0 {
  fonte: FontePorte;
  porte: number[];
  /** Le porte accettano solo da sorgenti dichiarate (DALINK_FW_SORGENTI). */
  sorgentiRistrette: boolean;
  wt0Presente: boolean;
}

export interface DipendenzePorte {
  nftJson: () => Promise<string>;
  leggiFile: (percorso: string) => string;
  indirizziWt0: () => string[];
}

type Json = unknown;

function oggetto(v: Json): Record<string, Json> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : null;
}

/** Porte dal lato destro di `tcp dport`: un numero, un set di numeri o di intervalli. */
function porteDa(destra: Json): number[] | null {
  if (typeof destra === "number") return [destra];
  const o = oggetto(destra);
  const set = o?.set;
  if (!Array.isArray(set)) return null;
  const porte: number[] = [];
  for (const e of set) {
    if (typeof e === "number") porte.push(e);
    else {
      const r = oggetto(e)?.range;
      if (!Array.isArray(r) || typeof r[0] !== "number" || typeof r[1] !== "number") return null;
      for (let p = r[0]; p <= r[1] && porte.length < 70000; p++) porte.push(p);
    }
  }
  return porte;
}

/**
 * Porte accettate su `wt0` dalla tabella `inet dalink`, da `nft -j`. Null se la
 * tabella o la catena mancano, se la catena non finisce con uno scarto, o se il JSON
 * non si legge.
 */
export function porteDaNftJson(testo: string): { porte: number[]; sorgentiRistrette: boolean } | null {
  let dati: Json;
  try {
    dati = JSON.parse(testo);
  } catch {
    return null;
  }
  const elenco = oggetto(dati)?.nftables;
  if (!Array.isArray(elenco)) return null;

  let catenaTrovata = false;
  const regole: Json[][] = [];
  for (const voce of elenco) {
    const o = oggetto(voce);
    const catena = oggetto(o?.chain);
    if (catena && catena.table === TABELLA && catena.name === CATENA && catena.family === "inet") catenaTrovata = true;
    const regola = oggetto(o?.rule);
    if (regola && regola.table === TABELLA && regola.chain === CATENA && regola.family === "inet" && Array.isArray(regola.expr)) {
      regole.push(regola.expr);
    }
  }
  if (!catenaTrovata || regole.length === 0) return null;

  const ultima = regole[regole.length - 1];
  if (!ultima.some((e) => oggetto(e) && "drop" in (oggetto(e) as object))) return null;

  const porte = new Set<number>();
  let sorgentiRistrette = false;
  for (const expr of regole) {
    const accetta = expr.some((e) => oggetto(e) && "accept" in (oggetto(e) as object));
    if (!accetta) continue;
    let porteRegola: number[] | null = null;
    let conSorgente = false;
    for (const e of expr) {
      const m = oggetto(oggetto(e)?.match);
      const payload = oggetto(oggetto(m?.left)?.payload);
      if (!m || !payload || m.op !== "==") continue;
      if (payload.protocol === "tcp" && payload.field === "dport") porteRegola = porteDa(m.right);
      if ((payload.protocol === "ip" || payload.protocol === "ip6") && payload.field === "saddr") conSorgente = true;
    }
    if (!porteRegola) continue;
    for (const p of porteRegola) porte.add(p);
    if (conSorgente) sorgentiRistrette = true;
  }
  return { porte: [...porte].sort((a, b) => a - b), sorgentiRistrette };
}

/** Indirizzo IPv4 di /proc/net/tcp (esadecimale, byte al contrario) in forma puntata. */
function ipv4DaProc(hex: string): string | null {
  if (!/^[0-9A-Fa-f]{8}$/.test(hex)) return null;
  const b = [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `${b[3]}.${b[2]}.${b[1]}.${b[0]}`;
}

function righeInAscolto(testo: string): Array<{ indirizzo: string; porta: number }> {
  const out: Array<{ indirizzo: string; porta: number }> = [];
  for (const riga of testo.split("\n")) {
    const c = riga.trim().split(/\s+/);
    if (c.length < 4 || !/^\d+:$/.test(c[0])) continue;
    if (c[3] !== "0A") continue; // 0A = TCP_LISTEN
    const [ind, portaHex] = c[1].split(":");
    const porta = parseInt(portaHex ?? "", 16);
    if (!ind || !Number.isInteger(porta)) continue;
    out.push({ indirizzo: ind.toUpperCase(), porta });
  }
  return out;
}

/** Porte TCP in ascolto raggiungibili da `wt0`: indirizzo jolly o indirizzo di `wt0`. */
export function porteInAscolto(tcp4: string, tcp6: string, indirizziWt0: string[]): number[] {
  const porte = new Set<number>();
  const wt0 = new Set(indirizziWt0);
  for (const r of righeInAscolto(tcp4)) {
    if (r.indirizzo === "00000000" || wt0.has(ipv4DaProc(r.indirizzo) ?? "")) porte.add(r.porta);
  }
  for (const r of righeInAscolto(tcp6)) {
    if (/^0{32}$/.test(r.indirizzo)) porte.add(r.porta);
  }
  return [...porte].sort((a, b) => a - b);
}

export const dipendenzeReali: DipendenzePorte = {
  nftJson: () =>
    new Promise((resolve, reject) => {
      execFile("nft", ["-j", "list", "table", "inet", TABELLA], { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    }),
  leggiFile: (p) => fs.readFileSync(p, "utf8"),
  indirizziWt0: () =>
    (os.networkInterfaces()[INTERFACCIA] ?? []).filter((a) => a.family === "IPv4").map((a) => a.address),
};

export async function leggiPorteWt0(dip: DipendenzePorte = dipendenzeReali): Promise<PorteWt0> {
  let indirizzi: string[] = [];
  try {
    indirizzi = dip.indirizziWt0();
  } catch {
    indirizzi = [];
  }
  const wt0Presente = indirizzi.length > 0;
  try {
    const fw = porteDaNftJson(await dip.nftJson());
    if (fw) return { fonte: "firewall", ...fw, wt0Presente };
  } catch {
    // Tabella assente o nft mancante: si passa al caso peggiore.
  }
  let tcp4: string;
  try {
    tcp4 = dip.leggiFile("/proc/net/tcp");
  } catch {
    return { fonte: "non_so", porte: [], sorgentiRistrette: false, wt0Presente };
  }
  let tcp6 = "";
  try {
    tcp6 = dip.leggiFile("/proc/net/tcp6");
  } catch {
    // IPv6 spento nel kernel: manca solo questo file.
  }
  return { fonte: "ascolto", porte: porteInAscolto(tcp4, tcp6, indirizzi), sorgentiRistrette: false, wt0Presente };
}

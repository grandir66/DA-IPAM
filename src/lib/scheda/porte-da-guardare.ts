/**
 * Calcoli puri della scheda switch (21/10): quali porte «guardare», VLAN distinte, PoE erogato, numero e tipo
 * di porta per il pannello frontale, caselle della striscia. Nessun database, nessun React (prova:
 * `__tests__/porte-da-guardare.test.ts`).
 *
 * Cosa NON c'è, perché il dato non esiste: `switch_ports` non ha contatori di errori (CRC) né lo storico della
 * velocità. Quindi niente «porta lenta che ha visto 1G» e `errori` è un campo opzionale che oggi nessuna fonte
 * riempie: appena un collettore lo scrive la regola scatta già (e la prova la copre).
 */
import type { Casella } from "@/components/scheda/striscia-numeri";

/** Il sottoinsieme di `SwitchPort` che serve qui, più `errori` (opzionale, oggi sempre assente). */
export interface PortaSwitch {
  id: number;
  port_index: number;
  port_name: string;
  status: "up" | "down" | "disabled" | null;
  speed: string | null;
  duplex: string | null;
  vlan: number | null;
  poe_status: string | null;
  poe_power_mw: number | null;
  mac_count: number;
  is_trunk: number;
  stp_state: string | null;
  errori?: number | null;
}

/** Oltre questa soglia, su una porta non trunk, c'è quasi certamente uno switch o un AP non gestito dietro. */
export const SOGLIA_MAC = 5;

/** Perché una porta va guardata. Una porta non «su» non conta: duplex e MAC di una porta giù sono dati vecchi. */
export function motiviPorta(p: PortaSwitch): string[] {
  if (p.status !== "up") return [];
  const motivi: string[] = [];
  if (p.errori != null && p.errori > 0) motivi.push(`${p.errori} errori sulla porta`);
  if (p.duplex === "half") motivi.push("duplex half");
  if (!p.is_trunk && p.mac_count > SOGLIA_MAC) motivi.push(`switch non gestito? ${p.mac_count} MAC su una porta`);
  return motivi;
}

export function porteDaGuardare(porte: PortaSwitch[]): Array<{ porta: PortaSwitch; motivi: string[] }> {
  const r: Array<{ porta: PortaSwitch; motivi: string[] }> = [];
  for (const porta of porte) {
    const motivi = motiviPorta(porta);
    if (motivi.length > 0) r.push({ porta, motivi });
  }
  return r;
}

/** «1000 Mbps» / «10 Gbps» → Mbps; testo non numerico («auto») o assente = null. */
export function velocitaMbps(s: string | null | undefined): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([gm])?b?(?:ps|it)?/i.exec(s ?? "");
  if (!m) return null;
  const n = Number((m[1] ?? "").replace(",", "."));
  return (m[2] ?? "m").toLowerCase() === "g" ? n * 1000 : n;
}

/** «100M», «1G», «10G»; ciò che non si capisce resta com'è. */
export function etichettaVelocita(s: string | null | undefined): string | null {
  if (!s) return null;
  const mbps = velocitaMbps(s);
  if (mbps == null) return s;
  return mbps >= 1000 ? `${mbps / 1000}G` : `${mbps}M`;
}

/** VLAN distinte lette da `switch_ports.vlan`, con quante porte e quante sono trunk. Senza VLAN non conta. */
export function vlanDistinte(porte: PortaSwitch[]): Array<{ vlan: number; porte: number; trunk: number }> {
  const m = new Map<number, { vlan: number; porte: number; trunk: number }>();
  for (const p of porte) {
    if (p.vlan == null) continue;
    const e = m.get(p.vlan) ?? { vlan: p.vlan, porte: 0, trunk: 0 };
    e.porte += 1;
    if (p.is_trunk) e.trunk += 1;
    m.set(p.vlan, e);
  }
  return [...m.values()].sort((a, b) => a.vlan - b.vlan);
}

/** PoE: somma in watt delle porte che erogano; `haPoe` = lo switch ha almeno una porta con stato PoE. */
export function sommaPoe(porte: PortaSwitch[]): { watt: number; porte: number; haPoe: boolean } {
  let mw = 0;
  let n = 0;
  for (const p of porte) {
    if (p.poe_status === "delivering" && (p.poe_power_mw ?? 0) > 0) { mw += p.poe_power_mw ?? 0; n += 1; }
  }
  return { watt: Math.round(mw / 100) / 10, porte: n, haPoe: porte.some((p) => p.poe_status != null) };
}

/**
 * Numero stampato sul pannello: l'ultimo numero di un nome da costruttore («Port 17», «SFP+ 1», «gi1/0/5»);
 * un nome scelto dall'utente («CITOFONO 185») non è un numero di porta e vale l'indice.
 */
export function numeroPorta(p: PortaSwitch): number {
  const m = /^(?:port|sfp\+?_?|[a-z]*ethernet|gi|fa|te|eth|ge|xe|et)[\s_]*[\d/.:]*?(\d+)\s*$/i.exec(p.port_name.trim());
  return m ? Number(m[1]) : p.port_index;
}

/** Porte SFP/10G: stanno a parte nel pannello. */
export function eSfp(p: PortaSwitch): boolean {
  return /sfp|tengig|ten-gig|xgigabit|^te\d|^xg/i.test(p.port_name);
}

/** Interfacce che non sono prese fisiche (loopback, tunnel, VLAN logiche): fuori dal pannello. */
export function ePortaFisica(p: PortaSwitch): boolean {
  return !/loopback|tunnel|logical|^vlan|^lo\d|null|user defined/i.test(p.port_name);
}

const virgola = (n: number): string => String(n).replace(".", ",");

/** Striscia dei numeri: solo caselle con dato (max sei). */
export function casellePanoramicaSwitch(i: {
  porte: PortaSwitch[];
  vicini: number;
  protocolliVicini: string[];
  acceso: string | null;
}): Casella[] {
  const c: Casella[] = [];
  const su = i.porte.filter((p) => p.status === "up").length;
  const uplink = i.porte.filter((p) => p.is_trunk).length;
  c.push({ etichetta: "Porte su", valore: `${su} / ${i.porte.length}`, ...(uplink > 0 ? { sotto: `${uplink} trunk / uplink` } : {}), tab: "porte" });
  const poe = sommaPoe(i.porte);
  if (poe.haPoe) c.push({ etichetta: "PoE erogato", valore: `${virgola(poe.watt)} W`, sotto: `su ${poe.porte} porte`, tab: "porte" });
  const guarda = porteDaGuardare(i.porte);
  c.push({
    etichetta: "Da guardare",
    valore: String(guarda.length),
    ...(guarda.length === 1 ? { sotto: `porta ${numeroPorta(guarda[0]!.porta)}` } : guarda.length > 1 ? { sotto: "porte da controllare" } : {}),
    ...(guarda.length > 0 ? { attenzione: true } : {}),
    tab: "porte",
  });
  const vlan = vlanDistinte(i.porte);
  if (vlan.length > 0) {
    c.push({ etichetta: "VLAN", valore: String(vlan.length), sotto: vlan.slice(0, 4).map((v) => v.vlan).join(" · ") + (vlan.length > 4 ? " …" : ""), tab: "vlan" });
  }
  if (i.vicini > 0) {
    c.push({ etichetta: "Vicini", valore: String(i.vicini), ...(i.protocolliVicini.length > 0 ? { sotto: i.protocolliVicini.map((p) => p.toUpperCase()).join(" · ") } : {}), tab: "vicini" });
  }
  if (i.acceso) c.push({ etichetta: "Acceso da", valore: i.acceso });
  return c.slice(0, 6);
}

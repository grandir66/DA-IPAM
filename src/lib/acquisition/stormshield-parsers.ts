/**
 * Stormshield SNS (NS-BSD, cioè FreeBSD) letto come un firewall (Riccardo, 08/11: «acquisiti con porte, tabella arp, tabelle
 * di routing, vlan»). Prima SNS EVA2 dava 12 porte e l'ARP da SNMP, nessuna VLAN e nessuna interfaccia logica: SNMP non ha il
 * Q-BRIDGE e non dice di chi è figlia una VLAN. `ifconfig -a` lo dice (`vlan: 40 … parent interface: ix1`, `laggport:`).
 * Logica pura sui testi di `ifconfig -a` e `arp -an` nella forma di FreeBSD; un testo che non si riconosce dà `null`.
 */

export interface IfconfigInterfaccia {
  nome: string; su: boolean; mtu: number | null; descrizione: string | null; mac: string | null;
  indirizzi: Array<{ ip: string; maschera: string | null }>;
  vlanId: number | null; padre: string | null; membri: string[]; velocitaBps: number | null; duplex: string | null; collegata: boolean | null;
}

const MAC = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i;

/** `0xffffff00` → `255.255.255.0`. */
function maschera(esa: string): string | null {
  if (!/^0x[0-9a-f]{8}$/i.test(esa)) return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(esa) ? esa : null;
  const n = parseInt(esa.slice(2), 16);
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
}

/** «1000baseT», «10Gbase-SR», «100baseTX» → bit al secondo. */
function velocita(media: string): number | null {
  const m = media.match(/\((\d+)(G?)base/i);
  if (!m) return null;
  return Number(m[1]) * (m[2] ? 1e9 : 1e6);
}

export function parseIfconfigFreebsd(testo: string): IfconfigInterfaccia[] | null {
  const out: IfconfigInterfaccia[] = [];
  let cur: IfconfigInterfaccia | null = null;
  for (const riga of testo.replace(/\r/g, "").split("\n")) {
    const testa = riga.match(/^([A-Za-z][\w.-]*): flags=[0-9a-f]+<([^>]*)>(?:.*?\bmtu (\d+))?/i);
    if (testa) {
      cur = { nome: testa[1], su: testa[2].split(",").includes("UP"), mtu: testa[3] ? Number(testa[3]) : null, descrizione: null, mac: null, indirizzi: [], vlanId: null, padre: null, membri: [], velocitaBps: null, duplex: null, collegata: null };
      out.push(cur);
      continue;
    }
    if (!cur || !/^\s/.test(riga)) continue;
    const r = riga.trim();
    let m: RegExpMatchArray | null;
    if ((m = r.match(/^description: (.+)$/))) cur.descrizione = m[1].trim();
    else if ((m = r.match(/^(?:ether|lladdr|hwaddr) ([0-9a-f:]{17})/i)) && MAC.test(m[1])) cur.mac = m[1].toLowerCase();
    else if ((m = r.match(/^inet (\d{1,3}(?:\.\d{1,3}){3}) netmask (\S+)/))) cur.indirizzi.push({ ip: m[1], maschera: maschera(m[2]) });
    else if ((m = r.match(/^vlan: (\d+)(?:.*?parent interface: (\S+))?/))) { cur.vlanId = Number(m[1]); cur.padre = m[2] ?? null; }
    else if ((m = r.match(/^laggport: (\S+)/))) cur.membri.push(m[1]);
    else if ((m = r.match(/^media: (.+)$/))) { cur.velocitaBps = velocita(m[1]); cur.duplex = /full-duplex/.test(m[1]) ? "full" : /half-duplex/.test(m[1]) ? "half" : null; }
    else if ((m = r.match(/^status: (.+)$/))) cur.collegata = m[1].trim() === "active";
  }
  return out.length > 0 ? out : null;
}

export interface VoceArpFreebsd { ip: string; mac: string; interfaccia: string | null; permanente: boolean }

/** `? (192.0.2.1) at 02:00:00:00:00:01 on ix0 expires in 1180 seconds [ethernet]`; le voci `(incomplete)` non hanno un MAC. */
export function parseArpFreebsd(testo: string): VoceArpFreebsd[] | null {
  const righe = testo.replace(/\r/g, "").split("\n").filter((r) => r.trim());
  if (righe.length === 0) return [];
  const out: VoceArpFreebsd[] = [];
  let riconosciute = 0;
  for (const r of righe) {
    const m = r.match(/^\S+ \((\d{1,3}(?:\.\d{1,3}){3})\) at (\S+)(?: on (\S+))?(.*)$/);
    if (!m) continue;
    riconosciute++;
    if (!MAC.test(m[2])) continue;
    out.push({ ip: m[1], mac: m[2].toLowerCase(), interfaccia: m[3] ?? null, permanente: /\bpermanent\b/.test(m[4]) });
  }
  return riconosciute > 0 ? out : null;
}

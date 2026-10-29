/**
 * La rete dell'appliance come la vede il suo sistema, per il segnale verso DA-Link (29/10).
 *
 * Riccardo: «DA-Link deve memorizzare le configurazioni di rete delle installazioni, sapere come
 * raggiungerle e con che IP». Contratto: `Rete` in DA-Link (`dalink/segnale.py`): interfaccia della
 * rotta di default, il suo IPv4/prefisso, il gateway, fino a tre DNS. Non è inventario del cliente:
 * è la macchina stessa, e parte a ogni livello di privacy.
 *
 * Fonti senza comandi esterni: `/proc/net/route` (rotta di default), `os.networkInterfaces()`
 * (indirizzo e prefisso), i DNS veri di systemd-resolved (`/run/systemd/resolve/resolv.conf`,
 * poi `/etc/resolv.conf`, mai lo stub 127.0.0.53). Se qualcosa non si legge il campo non parte:
 * DA-Link tiene l'ultima rete ricevuta.
 */
import fs from "node:fs";
import os from "node:os";

export interface ReteAppliance {
  interfaccia: string;
  ip_cidr: string;
  gateway: string | null;
  dns: string[];
}

export interface DipendenzeRete {
  leggiFile: (p: string) => string;
  interfacce: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
}

const RESOLV = ["/run/systemd/resolve/resolv.conf", "/etc/resolv.conf"];
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const NOME_INTERFACCIA = /^[A-Za-z0-9._@-]{1,15}$/;

/** `0128A8C0` (little endian, come lo scrive il kernel) → `192.168.40.1`. */
function daEsadecimale(h: string): string | null {
  if (!/^[0-9A-Fa-f]{8}$/.test(h)) return null;
  const b = [6, 4, 2, 0].map((i) => parseInt(h.slice(i, i + 2), 16));
  return b.join(".");
}

/** La rotta di default da `/proc/net/route`: interfaccia e gateway, o null. */
export function rottaDiDefault(testo: string): { interfaccia: string; gateway: string | null } | null {
  for (const riga of testo.split("\n").slice(1)) {
    const c = riga.trim().split(/\s+/);
    if (c.length < 8 || c[1] !== "00000000" || c[7] !== "00000000") continue;
    if (!NOME_INTERFACCIA.test(c[0])) return null;
    const gw = daEsadecimale(c[2]);
    return { interfaccia: c[0], gateway: gw && gw !== "0.0.0.0" ? gw : null };
  }
  return null;
}

export function dnsDa(testo: string): string[] {
  const out: string[] = [];
  for (const riga of testo.split("\n")) {
    const c = riga.trim().split(/\s+/);
    if (c[0] !== "nameserver" || !c[1] || !IPV4.test(c[1]) || c[1].startsWith("127.")) continue;
    if (!out.includes(c[1])) out.push(c[1]);
  }
  return out.slice(0, 3);
}

export const dipendenzeReteReali: DipendenzeRete = {
  leggiFile: (p) => fs.readFileSync(p, "utf8"),
  interfacce: () => os.networkInterfaces(),
};

export function leggiReteAppliance(d: DipendenzeRete = dipendenzeReteReali): ReteAppliance | null {
  let rotta: ReturnType<typeof rottaDiDefault>;
  try {
    rotta = rottaDiDefault(d.leggiFile("/proc/net/route"));
  } catch {
    return null; // niente /proc: lo sviluppo su Mac
  }
  if (!rotta) return null;
  let cidr: string | null = null;
  try {
    const a = (d.interfacce()[rotta.interfaccia] ?? []).find((x) => x.family === "IPv4" && !x.internal);
    if (a?.cidr && IPV4.test(a.address)) cidr = a.cidr;
  } catch {
    cidr = null;
  }
  if (!cidr) return null;
  let dns: string[] = [];
  for (const f of RESOLV) {
    try {
      dns = dnsDa(d.leggiFile(f));
    } catch {
      dns = [];
    }
    if (dns.length) break;
  }
  return { interfaccia: rotta.interfaccia, ip_cidr: cidr, gateway: rotta.gateway, dns };
}

/**
 * Catalogo canonico delle classificazioni (decisioni V3-V6 di Riccardo, 21/10).
 * Gli slug «doppi» (server_windows, dns_server, nas_qnap, ont...) diventano uno
 * slug solo, più un vendor (piattaforma) o un ruolo del server. Modulo puro:
 * lo usano le funzioni di scrittura (db.ts, db-tenant.ts, attribuzione) e la
 * conversione una tantum.
 */

export const RUOLI_SERVER = ["dc", "dns", "dhcp", "mail", "web", "database", "backup", "nfs"] as const;
export type RuoloServer = (typeof RUOLI_SERVER)[number];

export const ETICHETTE_RUOLI: Record<RuoloServer, string> = {
  dc: "Domain controller",
  dns: "DNS",
  dhcp: "DHCP",
  mail: "Posta",
  web: "Web",
  database: "Database",
  backup: "Backup",
  nfs: "NFS",
};

export interface Canonica {
  classificazione: string;
  vendor: string | null;
  ruolo: RuoloServer | null;
}

const TABELLA = {
  server_windows: { classificazione: "server", vendor: "windows", ruolo: null },
  server_linux: { classificazione: "server", vendor: "linux", ruolo: null },
  nas_synology: { classificazione: "nas", vendor: "synology", ruolo: null },
  nas_qnap: { classificazione: "nas", vendor: "qnap", ruolo: null },
  storage: { classificazione: "nas", vendor: null, ruolo: null },
  controller: { classificazione: "network_controller", vendor: null, ruolo: null },
  controller_wifi: { classificazione: "network_controller", vendor: null, ruolo: null },
  fotocopiatrice: { classificazione: "multifunzione", vendor: null, ruolo: null },
  ont: { classificazione: "modem", vendor: null, ruolo: null },
  dns_server: { classificazione: "server", vendor: null, ruolo: "dns" },
  dhcp_server: { classificazione: "server", vendor: null, ruolo: "dhcp" },
  mail_server: { classificazione: "server", vendor: null, ruolo: "mail" },
  web_server: { classificazione: "server", vendor: null, ruolo: "web" },
  database_server: { classificazione: "server", vendor: null, ruolo: "database" },
  backup_server: { classificazione: "server", vendor: null, ruolo: "backup" },
  nfs_server: { classificazione: "server", vendor: null, ruolo: "nfs" },
} as const satisfies Record<string, Canonica>;

/** Slug vecchi che i produttori (classificatori, SNMP, seed) possono ancora emettere: la scrittura li converte. */
export type SlugVecchio = keyof typeof TABELLA;

/** Slug vecchi riconosciuti (per i filtri che devono ancora leggere dati non convertiti). */
export const SLUG_VECCHI: readonly string[] = Object.keys(TABELLA);

/** Slug sconosciuto: invariato, senza vendor né ruolo. Nullo o vuoto: `unknown`. */
export function canonicalizza(slug: string | null | undefined): Canonica {
  if (!slug) return { classificazione: "unknown", vendor: null, ruolo: null };
  const t = (TABELLA as Record<string, Canonica>)[slug];
  return t ? { ...t } : { classificazione: slug, vendor: null, ruolo: null };
}

/** Unisce un ruolo a un elenco JSON di ruoli: ordinato, senza doppioni; JSON rotto riparte da vuoto. */
export function unisciRuoli(attuali: string | null, nuovo: RuoloServer | null): string | null {
  if (!nuovo) return attuali;
  let lista: string[] = [];
  if (attuali) {
    try {
      const p = JSON.parse(attuali) as unknown;
      if (Array.isArray(p)) lista = p.map(String);
    } catch {
      lista = [];
    }
  }
  return JSON.stringify([...new Set([...lista, nuovo])].sort());
}

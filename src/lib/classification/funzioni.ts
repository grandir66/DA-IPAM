/**
 * Le funzioni di un apparato: che cosa FA, accanto alla categoria che dice che cosa È (Riccardo, 11/11/2026:
 * «classificare le funzioni… DNS, DHCP, AD, DB, web… molte si potrebbero determinare direttamente dalle
 * scansioni e servizi»; «le funzioni si riempiranno o si inseriranno manualmente da un gruppo definito»).
 *
 * Un server virtuale può fare da firewall, da router, da storage o da centralino: quelle voci esistono sia
 * come categoria sia come funzione. L'elenco sta tutto qui, e aggiungere una funzione è una riga in `FUNZIONI`.
 * Modulo puro: le regole lavorano su ciò che il chiamante ha già letto (porte, servizi, categoria).
 */
export type GruppoFunzioni =
  | "rete" | "identita" | "dati" | "file" | "posta" | "sicurezza" | "backup" | "virtualizzazione" | "impianti";

export const GRUPPI_FUNZIONI: ReadonlyArray<{ gruppo: GruppoFunzioni; titolo: string }> = [
  { gruppo: "rete", titolo: "Rete" },
  { gruppo: "identita", titolo: "Identità e accessi" },
  { gruppo: "dati", titolo: "Dati e applicazioni" },
  { gruppo: "file", titolo: "File e storage" },
  { gruppo: "posta", titolo: "Posta e telefonia" },
  { gruppo: "sicurezza", titolo: "Sicurezza e monitoraggio" },
  { gruppo: "backup", titolo: "Backup" },
  { gruppo: "virtualizzazione", titolo: "Virtualizzazione e gestione" },
  { gruppo: "impianti", titolo: "Impianti e domotica" },
];

export const FUNZIONI = [
  { slug: "dns", etichetta: "DNS", gruppo: "rete" },
  { slug: "dhcp", etichetta: "DHCP", gruppo: "rete" },
  { slug: "ntp", etichetta: "NTP", gruppo: "rete" },
  { slug: "router", etichetta: "Router", gruppo: "rete" },
  { slug: "firewall", etichetta: "Firewall", gruppo: "rete" },
  { slug: "vpn", etichetta: "VPN", gruppo: "rete" },
  { slug: "proxy", etichetta: "Proxy e bilanciatore", gruppo: "rete" },
  { slug: "controller_rete", etichetta: "Controller di rete", gruppo: "rete" },
  { slug: "ad_ldap", etichetta: "AD o LDAP", gruppo: "identita" },
  { slug: "radius", etichetta: "RADIUS", gruppo: "identita" },
  { slug: "certificati", etichetta: "Certificati", gruppo: "identita" },
  { slug: "accesso_remoto", etichetta: "Accesso remoto", gruppo: "identita" },
  { slug: "db_server", etichetta: "DB Server", gruppo: "dati" },
  { slug: "web", etichetta: "Web", gruppo: "dati" },
  { slug: "server_applicativo", etichetta: "Server applicativo", gruppo: "dati" },
  { slug: "ia_locale", etichetta: "IA locale", gruppo: "dati" },
  { slug: "file_server", etichetta: "File server", gruppo: "file" },
  { slug: "storage", etichetta: "Storage", gruppo: "file" },
  { slug: "trasferimento_file", etichetta: "Trasferimento file", gruppo: "file" },
  { slug: "server_stampa", etichetta: "Server di stampa", gruppo: "file" },
  { slug: "posta", etichetta: "Posta", gruppo: "posta" },
  { slug: "centralino", etichetta: "Centralino VoIP", gruppo: "posta" },
  { slug: "monitoraggio", etichetta: "Monitoraggio", gruppo: "sicurezza" },
  { slug: "log_siem", etichetta: "Log e SIEM", gruppo: "sicurezza" },
  { slug: "protezione_endpoint", etichetta: "Protezione endpoint", gruppo: "sicurezza" },
  { slug: "scansione_vulnerabilita", etichetta: "Scansione vulnerabilità", gruppo: "sicurezza" },
  { slug: "ndr", etichetta: "NDR", gruppo: "sicurezza" },
  { slug: "backup", etichetta: "Backup", gruppo: "backup" },
  { slug: "hypervisor", etichetta: "Hypervisor", gruppo: "virtualizzazione" },
  { slug: "container", etichetta: "Container", gruppo: "virtualizzazione" },
  { slug: "gestione_aggiornamenti", etichetta: "Gestione e aggiornamenti", gruppo: "virtualizzazione" },
  { slug: "controller_domotica", etichetta: "Controller domotica", gruppo: "impianti" },
] as const satisfies ReadonlyArray<{ slug: string; etichetta: string; gruppo: GruppoFunzioni }>;

export type Funzione = (typeof FUNZIONI)[number]["slug"];

const PER_SLUG = new Map<string, (typeof FUNZIONI)[number]>(FUNZIONI.map((f) => [f.slug, f]));

export function eFunzione(s: unknown): s is Funzione {
  return typeof s === "string" && PER_SLUG.has(s);
}

export function etichettaFunzione(slug: string): string {
  return PER_SLUG.get(slug)?.etichetta ?? slug;
}

/** I gruppi con le loro funzioni, nell'ordine dell'elenco: per menu e filtri a due livelli. */
export function gruppiFunzioni(): Array<{ gruppo: GruppoFunzioni; titolo: string; voci: Array<{ slug: Funzione; etichetta: string }> }> {
  return GRUPPI_FUNZIONI.map((g) => ({
    ...g,
    voci: FUNZIONI.filter((f) => f.gruppo === g.gruppo).map((f) => ({ slug: f.slug, etichetta: f.etichetta })),
  })).filter((g) => g.voci.length > 0);
}

/** Ciò che serve per riconoscere le funzioni di un apparato. Tutto facoltativo: chi non c'è non conta. */
export interface SegnaliFunzioni {
  /** La classe (`hosts.classification`). */
  classe?: string | null;
  /** Le porte TCP aperte. */
  porte?: readonly number[];
  /** I nomi dei servizi IN ESECUZIONE letti da un agente, così come sono (`wazuh_service.service_id`). */
  servizi?: readonly string[];
  /** L'apparato è nell'elenco dei server di dominio che leggiamo (`dc_lettura`). */
  serverDiDominio?: boolean;
  /** I ruoli messi a mano nella scheda del server (`hosts.server_roles`). */
  ruoli?: readonly string[];
}

export interface FunzioneTrovata { funzione: Funzione; origine: string }

/** La classe che porta con sé una funzione: chi È un router FA da router. */
const DA_CLASSE: Record<string, Funzione> = {
  router: "router", firewall: "firewall", vpn_gateway: "vpn", proxy: "proxy", load_balancer: "proxy",
  network_controller: "controller_rete", nas: "storage", centralino: "centralino", hypervisor: "hypervisor",
};

/** I ruoli vecchi della scheda del server. */
const DA_RUOLO: Record<string, Funzione> = {
  dc: "ad_ldap", dns: "dns", dhcp: "dhcp", mail: "posta", web: "web", database: "db_server", backup: "backup", nfs: "file_server",
};

/**
 * Porte che dicono una funzione da sole. Fuori di proposito: 80 e 443 (sul 70791 stanno su 113 host, sono le
 * pagine di gestione di ogni apparato: «web» si dice solo dal programma), 445 (ogni Windows), 22 (ogni Linux).
 */
const DA_PORTA: ReadonlyArray<readonly [readonly number[], Funzione]> = [
  [[53], "dns"],
  [[88], "ad_ldap"],
  [[1433, 3306, 5432, 1521, 27017], "db_server"],
  [[25], "posta"],
  [[8007], "backup"],
  [[10051], "monitoraggio"],
  [[11434], "ia_locale"],
  [[8123], "controller_domotica"],
  [[21], "trasferimento_file"],
];

/**
 * Nomi di servizio che dicono una funzione. Ancorati: sul 70791 «dns» preso a pezzi trovava 22 computer (il
 * client `dnscache` di ogni Windows) invece di 3. Fuori di proposito: `lanmanserver` e `spooler` (girano su ogni
 * Windows: file server e server di stampa non si dicono da lì), i client VPN (`netbird`, `openvpnservice`,
 * `wireguardmanager`), gli agenti (`zabbix agent`, `wazuhsvc`, `veeamendpointbackupsvc`), `mssql$microsoft##wid`.
 */
const DA_SERVIZIO: ReadonlyArray<readonly [RegExp, Funzione]> = [
  [/^(dns|named|bind9|unbound|dnsmasq|pihole-ftl)$/, "dns"],
  [/^(dhcpserver|isc-dhcp-server|kea-dhcp4-server|dhcpd)$/, "dhcp"],
  [/^(ntds|slapd|389-ds|samba-ad-dc)$/, "ad_ldap"],
  [/^(mssqlserver|mysql|mysqld|mariadb|mongod|oracleservice.*)$|^mssql\$(?!microsoft##)|^postgresql/, "db_server"],
  [/^(w3svc|nginx|apache2|httpd|caddy)$/, "web"],
  [/^(smtpsvc|postfix|exim4|dovecot|hmailserver)$|^msexchange/, "posta"],
  [/^(tssdis|rdms|guacd)$/, "accesso_remoto"],
  [/^(ftpsvc|vsftpd|proftpd)$/, "trasferimento_file"],
  [/^(vmms|pvedaemon|pveproxy|libvirtd)$/, "hypervisor"],
  [/^(docker|dockerd|containerd|com\.docker\.service|k3s|kubelet|podman)$/, "container"],
  [/^(certsvc)$/, "certificati"],
  [/^(wsusservice)$/, "gestione_aggiornamenti"],
  [/^(veeambackupsvc|proxmox-backup-proxy|bacula-dir|urbackupsrv)$/, "backup"],
  [/^(zabbix-server|zabbix_server|prometheus|grafana-server|librenms)$/, "monitoraggio"],
  [/^(wazuh-manager|wazuh-indexer|graylog-server|elasticsearch|opensearch)$/, "log_siem"],
  [/^(squid|haproxy|traefik)$/, "proxy"],
  [/^(ollama|vllm|llama-server)$/, "ia_locale"],
  [/^(home-assistant|hass|homeassistant)$/, "controller_domotica"],
  [/^(ias|freeradius|radiusd)$/, "radius"],
];

function nomeServizio(s: string): string {
  return s.trim().toLowerCase().replace(/\.service$/, "");
}

/** Le funzioni che si riconoscono dai segnali, ognuna con la prima origine che l'ha detta. */
export function funzioniDi(s: SegnaliFunzioni): FunzioneTrovata[] {
  const trovate = new Map<Funzione, string>();
  const aggiungi = (f: Funzione, origine: string) => { if (!trovate.has(f)) trovate.set(f, origine); };

  if (s.serverDiDominio) aggiungi("ad_ldap", "dall'elenco dei server di dominio");
  for (const grezzo of s.servizi ?? []) {
    const nome = nomeServizio(grezzo);
    for (const [regola, funzione] of DA_SERVIZIO) if (regola.test(nome)) aggiungi(funzione, `dal servizio «${grezzo.trim()}» in esecuzione`);
  }
  const porte = new Set(s.porte ?? []);
  for (const [numeri, funzione] of DA_PORTA) {
    const aperta = numeri.find((n) => porte.has(n));
    if (aperta != null) aggiungi(funzione, `dalla porta ${aperta} aperta`);
  }
  const daClasse = s.classe ? DA_CLASSE[s.classe] : undefined;
  if (daClasse) aggiungi(daClasse, "dalla categoria");
  for (const r of s.ruoli ?? []) {
    const f = DA_RUOLO[r];
    if (f) aggiungi(f, "dal ruolo scritto nella scheda");
  }
  return [...trovate.entries()].map(([funzione, origine]) => ({ funzione, origine }));
}

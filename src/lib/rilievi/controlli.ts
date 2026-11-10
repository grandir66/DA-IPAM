/**
 * Rilievi dei giri oltre il TLS: si derivano da ntlm/ssh/http già salvati
 * e da `controllo_json` (LDAP, Redis, Mongo, NFS, SNMP, VNC, login di fabbrica).
 * Funzioni pure: la rete sta in `sonde-controlli.ts`, la query in `unione.ts`.
 */
import type { InfoHttp, InfoNtlm, InfoSsh } from "@/lib/servizi-rete/sonde";
import type { RilievoUnito } from "./tipi";
import type { ContestoServizio } from "./da-servizi";

export interface InfoControllo {
  ldap_anonimo?: boolean;
  redis_aperto?: boolean;
  mongo_aperto?: boolean;
  nfs_risponde?: boolean;
  snmp_public?: string | null;
  vnc_senza_auth?: boolean;
  fabbrica?: { servizio: string; utente: string } | null;
  smbv1?: boolean;
  smb_null?: boolean;
  smb_guest?: boolean;
  smb_share_anon?: string[];
  memcached?: boolean;
  zookeeper?: boolean;
  elasticsearch?: boolean;
  docker?: boolean;
  etcd?: boolean;
  couchdb?: boolean;
  kubelet?: boolean;
  actuator?: boolean;
  git_env?: string | null;
  x11?: boolean;
  ms17_010?: boolean;
  ipmi_esposto?: boolean;
  ipmi_cipher0?: boolean;
}

export const TETTO_FABBRICA_PER_HOST = 6;

const SSH_KEX_DEBOLI = new Set([
  "diffie-hellman-group1-sha1",
  "diffie-hellman-group14-sha1",
  "diffie-hellman-group-exchange-sha1",
]);
const SSH_CIFRARI_DEBOLI = new Set(["3des-cbc", "3des-ctr", "arcfour", "arcfour128", "arcfour256", "blowfish-cbc", "none"]);
const SSH_MAC_DEBOLI = new Set(["hmac-md5", "hmac-md5-96", "hmac-sha1-96"]);

const CONSOLE_WEB: ReadonlyArray<{ re: RegExp; nome: string }> = [
  { re: /phpmyadmin/i, nome: "phpMyAdmin" },
  { re: /tomcat/i, nome: "Apache Tomcat" },
  { re: /jenkins/i, nome: "Jenkins" },
  { re: /grafana/i, nome: "Grafana" },
  { re: /kibana/i, nome: "Kibana" },
  { re: /\bilogin\b|hp ilo|\bilo[\s/]/i, nome: "HPE iLO" },
  { re: /idrac/i, nome: "Dell iDRAC" },
  { re: /unifi/i, nome: "UniFi" },
  { re: /pfsense/i, nome: "pfSense" },
  { re: /opnsense/i, nome: "OPNsense" },
  { re: /webmin/i, nome: "Webmin" },
  { re: /cockpit/i, nome: "Cockpit" },
  { re: /weblogic/i, nome: "WebLogic" },
  { re: /synology|\bdsm\b/i, nome: "Synology DSM" },
  { re: /mikrotik|routeros/i, nome: "MikroTik" },
];

function riga(
  ctx: ContestoServizio,
  id: string,
  gravita: RilievoUnito["gravita"],
  titolo: string,
  prova: string,
  rimedio: string,
): RilievoUnito {
  return {
    id: `giro:${id}:${ctx.host_id}:${ctx.porta}`,
    fonte: "giro",
    gravita,
    titolo,
    prova,
    rimedio,
    ip: ctx.ip,
    host_id: ctx.host_id,
    network_id: ctx.network_id,
    network_name: ctx.network_name,
    visto: null,
    cve_key: null,
    host_count: 1,
  };
}

/** OpenSSH sotto la 8, o protocollo SSH-1. */
export function eSshVecchio(ident: string | null | undefined): boolean {
  if (!ident) return false;
  if (/^SSH-1(\.|$)/.test(ident.trim())) return true;
  const m = /OpenSSH[_-](\d+)/i.exec(ident);
  return m != null && Number(m[1]) < 8;
}

export function nomeConsolaWeb(http: Pick<InfoHttp, "title" | "server" | "location"> | null): string | null {
  if (!http) return null;
  const testo = [http.title, http.server, http.location].filter(Boolean).join(" ");
  if (!testo) return null;
  for (const c of CONSOLE_WEB) {
    if (c.re.test(testo)) return c.nome;
  }
  return null;
}

export function rilieviDaNtlm(n: InfoNtlm | null, ctx: ContestoServizio): RilievoUnito[] {
  if (!n) return [];
  const dove = `${ctx.ip}:${ctx.porta}`;
  const out: RilievoUnito[] = [];
  if (n.fonte === "smb" && n.smb_signing === false) {
    out.push(
      riga(
        ctx,
        "smb-signing",
        "Medium",
        `SMB senza firma obbligatoria su ${dove}`,
        "Il server accetta sessioni SMB senza message signing: in LAN si può inoltrare un login NTLM.",
        "Su Windows: «Microsoft network server: Digitally sign communications (always)». Su Samba: server signing = mandatory.",
      ),
    );
  }
  if (n.fonte === "rdp" && n.rdp_nla === false) {
    out.push(
      riga(
        ctx,
        "rdp-nla",
        "Medium",
        `RDP senza NLA su ${dove}`,
        "Il desktop remoto non chiede Network Level Authentication prima della sessione.",
        "Abilita NLA (CredSSP) sul server: Criteri di gruppo «Require user authentication for remote connections by using Network Level Authentication».",
      ),
    );
  }
  return out;
}

export function algoritmiSshDeboli(s: Partial<Pick<InfoSsh, "kex" | "cifrari" | "mac">> | null): string[] {
  if (!s) return [];
  const out: string[] = [];
  for (const a of s.kex ?? []) if (SSH_KEX_DEBOLI.has(a) || a.startsWith("gss-group1-sha1")) out.push(`kex ${a}`);
  for (const a of s.cifrari ?? []) if (SSH_CIFRARI_DEBOLI.has(a) || a.startsWith("arcfour")) out.push(`cifrario ${a}`);
  for (const a of s.mac ?? []) if (SSH_MAC_DEBOLI.has(a)) out.push(`mac ${a}`);
  return out;
}

export function rilieviDaSsh(
  s: (Pick<InfoSsh, "ident"> & Partial<Pick<InfoSsh, "kex" | "cifrari" | "mac">>) | null,
  ctx: ContestoServizio,
): RilievoUnito[] {
  if (!s) return [];
  const out: RilievoUnito[] = [];
  if (eSshVecchio(s.ident)) {
    out.push(
      riga(
        ctx,
        "ssh-vecchio",
        "Medium",
        `SSH vecchio su ${ctx.ip}:${ctx.porta}`,
        `Banner ${s.ident}`,
        "Aggiorna OpenSSH alla 8 o successiva, o spegni SSH-1. Le versioni vecchie hanno cifrari e KEX deboli.",
      ),
    );
  }
  const deboli = algoritmiSshDeboli(s);
  if (deboli.length > 0) {
    out.push(
      riga(
        ctx,
        "ssh-debole",
        "Low",
        `SSH con algoritmi deboli su ${ctx.ip}:${ctx.porta}`,
        deboli.slice(0, 8).join(", "),
        "In sshd_config lascia solo curve25519, aes-gcm/ctr e hmac-sha2. Togli group1, 3DES, RC4 e HMAC-MD5.",
      ),
    );
  }
  return out;
}

/** Telnet, WinRM, WSUS: la porta è già in inventario. */
export function rilieviDaPorta(ctx: ContestoServizio, tls: boolean): RilievoUnito[] {
  const dove = `${ctx.ip}:${ctx.porta}`;
  if (ctx.porta === 23) {
    return [
      riga(
        ctx,
        "telnet",
        "Medium",
        `Telnet in chiaro su ${dove}`,
        "La porta 23 è aperta: login e comandi viaggiano senza cifratura.",
        "Spegni Telnet e usa SSH.",
      ),
    ];
  }
  if (ctx.porta === 5985 || ctx.porta === 5986) {
    return [
      riga(
        ctx,
        "winrm",
        "Low",
        `WinRM raggiungibile su ${dove}`,
        `Porta ${ctx.porta} aperta${ctx.porta === 5985 ? " (HTTP, senza TLS)" : ""}.`,
        "Limita WinRM agli amministratori e alla rete di gestione. Sulla 5985 passa a HTTPS (5986).",
      ),
    ];
  }
  if (ctx.porta === 8530 && !tls) {
    return [
      riga(
        ctx,
        "wsus-http",
        "High",
        `WSUS in HTTP su ${dove}`,
        "Il servizio aggiornamenti risponde in chiaro: un attaccante in LAN può iniettare aggiornamenti.",
        "Pubblica WSUS solo in HTTPS (8531) e vincola i client al certificato.",
      ),
    ];
  }
  return [];
}

export function rilieviDaHttp(h: InfoHttp | null, ctx: ContestoServizio): RilievoUnito[] {
  const nome = nomeConsolaWeb(h);
  if (!nome) return [];
  return [
    riga(
      ctx,
      "consola-web",
      "Low",
      `${nome} esposto su ${ctx.ip}:${ctx.porta}`,
      [h?.title, h?.server, h?.status_code != null ? `HTTP ${h.status_code}` : null].filter(Boolean).join(" · "),
      "Tieni il pannello fuori dalla LAN utente, o metti un login e un certificato dell'azienda. Se non serve, spegnilo.",
    ),
  ];
}

export function rilieviDaControllo(c: InfoControllo | null, ctx: ContestoServizio): RilievoUnito[] {
  if (!c) return [];
  const dove = `${ctx.ip}:${ctx.porta}`;
  const out: RilievoUnito[] = [];
  if (c.ldap_anonimo) {
    out.push(
      riga(
        ctx,
        "ldap-anonimo",
        "Medium",
        `LDAP accetta il bind anonimo su ${dove}`,
        "Bind senza nome né password riuscito: la directory è leggibile da chiunque in rete.",
        "Disabilita anonymous bind sul directory e limita chi può interrogare gli attributi.",
      ),
    );
  }
  if (c.redis_aperto) {
    out.push(
      riga(
        ctx,
        "redis-aperto",
        "High",
        `Redis senza password su ${dove}`,
        "PING ha risposto PONG senza AUTH.",
        "Imposta requirepass (o ACL) e non esporre Redis sulla LAN utente.",
      ),
    );
  }
  if (c.mongo_aperto) {
    out.push(
      riga(
        ctx,
        "mongo-aperto",
        "High",
        `MongoDB senza autenticazione su ${dove}`,
        "listDatabases è andato a buon fine senza credenziali.",
        "Abilita authorization e un utente. Non lasciare 27017 raggiungibile da tutta la LAN.",
      ),
    );
  }
  if (c.nfs_risponde) {
    out.push(
      riga(
        ctx,
        "nfs-aperto",
        "Medium",
        `NFS risponde su ${dove}`,
        "La chiamata RPC NULL a nfs (programma 100003) è stata accettata.",
        "Limita gli export agli host che servono, con root_squash, e non esportare / a *.",
      ),
    );
  }
  if (typeof c.snmp_public === "string") {
    out.push(
      riga(
        ctx,
        "snmp-public",
        "Medium",
        `SNMP risponde alla community public su ${dove}`,
        `sysDescr: ${c.snmp_public.slice(0, 180)}`,
        "Togli la community public, usa una stringa lunga o passa a SNMPv3.",
      ),
    );
  }
  if (c.vnc_senza_auth) {
    out.push(
      riga(
        ctx,
        "vnc-aperto",
        "High",
        `VNC senza autenticazione su ${dove}`,
        "Il server offre il tipo di sicurezza None: lo schermo è visibile a chi si collega.",
        "Imposta una password VNC (meglio: tunnel SSH o spegni VNC se non serve).",
      ),
    );
  }
  if (c.fabbrica) {
    out.push(
      riga(
        ctx,
        "login-fabbrica",
        "High",
        `Login di fabbrica su ${dove} (${c.fabbrica.servizio})`,
        `Accettato l'utente «${c.fabbrica.utente}».`,
        "Cambia la password di fabbrica e spegni l'accesso se il servizio non serve in LAN.",
      ),
    );
  }
  if (c.smbv1) {
    out.push(
      riga(
        ctx,
        "smbv1",
        "Medium",
        `SMBv1 attivo su ${dove}`,
        "Il server ha accettato il dialetto NT LM 0.12 (SMB1).",
        "Disabilita SMBv1 (Set-SmbServerConfiguration -EnableSMB1Protocol $false, o min protocol SMB2 su Samba).",
      ),
    );
  }
  if (c.smb_null) {
    out.push(
      riga(
        ctx,
        "smb-null",
        "Medium",
        `SMB accetta la sessione anonima su ${dove}`,
        "Session setup senza nome né password riuscito.",
        "Imposta RestrictAnonymous e «Do not allow anonymous enumeration of SAM accounts and shares».",
      ),
    );
  }
  if (c.smb_guest) {
    out.push(
      riga(
        ctx,
        "smb-guest",
        "Medium",
        `SMB accetta l'account Guest su ${dove}`,
        "Login Guest con password vuota riuscito.",
        "Disabilita Guest e AllowInsecureGuestAuth; su Samba map to guest = never.",
      ),
    );
  }
  if (c.smb_share_anon && c.smb_share_anon.length > 0) {
    out.push(
      riga(
        ctx,
        "smb-share",
        "High",
        `Condivisione SMB senza credenziali su ${dove}`,
        `Aperte: ${c.smb_share_anon.slice(0, 8).join(", ")}`,
        "Togli Everyone/Guest dalle share e dagli ACL NTFS.",
      ),
    );
  }
  if (c.memcached) {
    out.push(riga(ctx, "memcached", "Medium", `Memcached aperto su ${dove}`, "Il comando stats ha risposto senza autenticazione.", "Metti Memcached in localhost o con SASL, e non esporlo in LAN."));
  }
  if (c.zookeeper) {
    out.push(riga(ctx, "zookeeper", "Medium", `ZooKeeper risponde su ${dove}`, "Il comando ruok ha risposto imok.", "Chiudi i four-letter-word o metti ACL; non esporre 2181."));
  }
  if (c.elasticsearch) {
    out.push(riga(ctx, "elasticsearch", "High", `Elasticsearch senza autenticazione su ${dove}`, "GET / ha restituito il cluster senza login.", "Abilita xpack.security e non esporre 9200 sulla LAN utente."));
  }
  if (c.docker) {
    out.push(riga(ctx, "docker", "High", `API Docker senza autenticazione su ${dove}`, "GET /version è andato a buon fine.", "Non esporre il socket Docker in TCP. Usa TLS e autorizzazione, o solo lo unix socket."));
  }
  if (c.etcd) {
    out.push(riga(ctx, "etcd", "High", `etcd senza autenticazione su ${dove}`, "GET /version è andato a buon fine.", "Abilita autenticazione e TLS su etcd."));
  }
  if (c.couchdb) {
    out.push(riga(ctx, "couchdb", "High", `CouchDB senza autenticazione su ${dove}`, "GET / è andato a buon fine (admin party).", "Crea un admin e spegni l'accesso anonimo."));
  }
  if (c.kubelet) {
    out.push(riga(ctx, "kubelet", "High", `Kubelet senza autenticazione su ${dove}`, "GET /runningpods ha risposto.", "Chiudi l'API read-only del kubelet (--read-only-port=0) e autentica la 10250."));
  }
  if (c.actuator) {
    out.push(riga(ctx, "actuator", "High", `Spring Actuator esposto su ${dove}`, "GET /actuator/health (o /env) senza login.", "Disabilita gli endpoint o mettili dietro autenticazione."));
  }
  if (c.git_env) {
    out.push(
      riga(
        ctx,
        "git-env",
        "High",
        `File ${c.git_env} esposto su ${dove}`,
        `GET /${c.git_env} ha risposto 200.`,
        "Togli .git e .env dalla root del sito; ruota i segreti se erano lì.",
      ),
    );
  }
  if (c.x11) {
    out.push(riga(ctx, "x11", "High", `X11 senza autenticazione su ${dove}`, "Il server X ha accettato la connessione.", "Spegni X11 in rete o usa SSH -X; xhost -"));
  }
  if (c.ms17_010) {
    out.push(
      riga(
        ctx,
        "ms17-010",
        "Critical",
        `EternalBlue (MS17-010) su ${dove}`,
        "PeekNamedPipe su IPC$ ha restituito STATUS_INSUFF_SERVER_RESOURCES: il server SMB1 non è patchato.",
        "Installa gli aggiornamenti MS17-010 e disabilita SMBv1.",
      ),
    );
  }
  if (c.ipmi_cipher0) {
    out.push(riga(ctx, "ipmi-cipher0", "High", `IPMI accetta cipher zero su ${dove}`, "Open Session con cipher suite 0 accettato: comandi BMC senza autenticazione.", "Disabilita cipher 0 sul BMC e tieni IPMI fuori dalla LAN utente."));
  } else if (c.ipmi_esposto) {
    out.push(riga(ctx, "ipmi", "Medium", `IPMI raggiungibile su ${dove}`, "RMCP Presence Pong sulla 623 UDP.", "Tieni IPMI sulla rete di gestione, password lunghe, disabilita LAN se non serve."));
  }
  return out;
}

export function ntlmDaJson(grezzo: string | null): InfoNtlm | null {
  if (!grezzo) return null;
  try {
    const v = JSON.parse(grezzo) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const fonte = o.fonte === "smb" || o.fonte === "http" || o.fonte === "rdp" ? o.fonte : null;
    if (!fonte) return null;
    return {
      netbios: typeof o.netbios === "string" ? o.netbios : null,
      dominio_netbios: typeof o.dominio_netbios === "string" ? o.dominio_netbios : null,
      dns_computer: typeof o.dns_computer === "string" ? o.dns_computer : null,
      dominio_dns: typeof o.dominio_dns === "string" ? o.dominio_dns : null,
      versione_os: typeof o.versione_os === "string" ? o.versione_os : null,
      fonte,
      smb_signing: typeof o.smb_signing === "boolean" ? o.smb_signing : undefined,
      rdp_nla: typeof o.rdp_nla === "boolean" ? o.rdp_nla : undefined,
    };
  } catch {
    return null;
  }
}

export function sshDaJson(grezzo: string | null): Pick<InfoSsh, "ident" | "kex" | "cifrari" | "mac"> | null {
  if (!grezzo) return null;
  try {
    const v = JSON.parse(grezzo) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const ident = typeof o.ident === "string" ? o.ident : "";
    const liste = (k: string): string[] =>
      Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (!ident && liste("kex").length === 0) return null;
    return { ident, kex: liste("kex"), cifrari: liste("cifrari"), mac: liste("mac") };
  } catch {
    return null;
  }
}

export function httpDaJson(grezzo: string | null): InfoHttp | null {
  if (!grezzo) return null;
  try {
    const v = JSON.parse(grezzo) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const scheme = o.scheme === "https" ? "https" : o.scheme === "http" ? "http" : null;
    if (!scheme || typeof o.status_code !== "number") return null;
    return {
      scheme,
      status_code: o.status_code,
      status_text: typeof o.status_text === "string" ? o.status_text : "",
      title: typeof o.title === "string" ? o.title : null,
      server: typeof o.server === "string" ? o.server : null,
      location: typeof o.location === "string" ? o.location : null,
      content_type: typeof o.content_type === "string" ? o.content_type : null,
      headers: o.headers && typeof o.headers === "object" && !Array.isArray(o.headers)
        ? (o.headers as Record<string, string>)
        : {},
      body_sha256: typeof o.body_sha256 === "string" ? o.body_sha256 : null,
    };
  } catch {
    return null;
  }
}

export function controlloDaJson(grezzo: string | null): InfoControllo | null {
  if (!grezzo) return null;
  try {
    const v = JSON.parse(grezzo) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const fab = o.fabbrica;
    let fabbrica: InfoControllo["fabbrica"];
    if (fab && typeof fab === "object" && !Array.isArray(fab)) {
      const f = fab as Record<string, unknown>;
      if (typeof f.servizio === "string" && typeof f.utente === "string") {
        fabbrica = { servizio: f.servizio, utente: f.utente };
      }
    }
    const share = Array.isArray(o.smb_share_anon)
      ? o.smb_share_anon.filter((x): x is string => typeof x === "string")
      : undefined;
    return {
      ldap_anonimo: o.ldap_anonimo === true,
      redis_aperto: o.redis_aperto === true,
      mongo_aperto: o.mongo_aperto === true,
      nfs_risponde: o.nfs_risponde === true,
      snmp_public: typeof o.snmp_public === "string" ? o.snmp_public : o.snmp_public === null ? null : undefined,
      vnc_senza_auth: o.vnc_senza_auth === true,
      fabbrica: fabbrica ?? undefined,
      smbv1: o.smbv1 === true,
      smb_null: o.smb_null === true,
      smb_guest: o.smb_guest === true,
      smb_share_anon: share && share.length > 0 ? share : undefined,
      memcached: o.memcached === true,
      zookeeper: o.zookeeper === true,
      elasticsearch: o.elasticsearch === true,
      docker: o.docker === true,
      etcd: o.etcd === true,
      couchdb: o.couchdb === true,
      kubelet: o.kubelet === true,
      actuator: o.actuator === true,
      git_env: typeof o.git_env === "string" ? o.git_env : undefined,
      x11: o.x11 === true,
      ms17_010: o.ms17_010 === true,
      ipmi_esposto: o.ipmi_esposto === true,
      ipmi_cipher0: o.ipmi_cipher0 === true,
    };
  } catch {
    return null;
  }
}

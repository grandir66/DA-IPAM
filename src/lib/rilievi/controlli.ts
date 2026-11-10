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
  actuator_health?: boolean;
  git_env?: string | null;
  x11?: boolean;
  ms17_010?: boolean;
  ipmi_esposto?: boolean;
  ipmi_cipher0?: boolean;
  nfs_export_pubblico?: boolean;
  snmp_write?: boolean;
  dns_axfr?: boolean;
  tftp?: boolean;
  ntp_monlist?: boolean;
  rsync?: boolean;
  smtp_vrfy?: boolean;
  adcs_enrollment?: boolean;
  jenkins_script_console?: boolean;
  vnc_auth_debole?: boolean;
  ipmi_rakp?: boolean;
  ssh_password?: boolean;
}

export const TETTO_FABBRICA_PER_HOST = 6;

export function protocolloControllo(porta: number): "tcp" | "udp" {
  return porta === 69 || porta === 123 || porta === 161 || porta === 623 ? "udp" : "tcp";
}

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
  { re: /\bcups\b|common unix printing/i, nome: "CUPS" },
  { re: /jetdirect|hp embedded web|hp laserjet/i, nome: "HP JetDirect" },
  { re: /\bxerox\b/i, nome: "Xerox" },
  { re: /kyocera|command center/i, nome: "Kyocera" },
  { re: /\bbrother\b/i, nome: "Brother" },
];

function riga(
  ctx: ContestoServizio,
  id: string,
  gravita: RilievoUnito["gravita"],
  titolo: string,
  prova: string,
  rimedio: string,
): RilievoUnito {
  const chiave = `giro:${id}:${ctx.host_id}:${ctx.porta}${ctx.protocollo === "udp" ? ":udp" : ""}`;
  return {
    id: chiave,
    chiaveTriage: chiave,
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
  if (n.fonte === "rdp" && n.rdp_tls === false) {
    out.push(
      riga(
        ctx,
        "rdp-standard",
        "High",
        `RDP in chiaro (Standard) su ${dove}`,
        "Il server ha scelto il protocollo RDP classico, senza TLS né CredSSP: la sessione viaggia in chiaro.",
        "Imposta «Negotiate» o «SSL» e richiedi NLA. Spegni «RDP Security Layer».",
      ),
    );
  } else if (n.fonte === "rdp" && n.rdp_nla === false) {
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
        `Possibile Telnet su ${dove}`,
        "La porta TCP 23 è nell’inventario. Verifica che il servizio sia Telnet.",
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
        `Possibile WinRM su ${dove}`,
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
        "Low",
        `Possibile WSUS su ${dove}`,
        "Porta TCP 8530 in inventario, senza TLS osservato. Verifica che sia WSUS e controlla la configurazione dei client.",
        "Pubblica WSUS solo in HTTPS (8531) e vincola i client al certificato.",
      ),
    ];
  }
  if (ctx.porta === 135) {
    return [
      riga(
        ctx,
        "rpc-135",
        "Medium",
        `Possibile mapper RPC su ${dove}`,
        "La porta TCP 135 è nell’inventario. Verifica il servizio prima di valutare l’esposizione RPC.",
        "Filtra la 135 verso la LAN utente; tieni RPC sulla rete di gestione.",
      ),
    ];
  }
  if (ctx.porta === 512 || ctx.porta === 513 || ctx.porta === 514) {
    const nome = ctx.porta === 512 ? "rexec" : ctx.porta === 513 ? "rlogin" : "rsh";
    return [
      riga(
        ctx,
        "r-services",
        "Medium",
        `Possibile ${nome} su ${dove}`,
        `La porta TCP ${ctx.porta} è nell’inventario. Verifica il servizio prima di intervenire.`,
        "Spegni rsh/rlogin/rexec; usa SSH.",
      ),
    ];
  }
  if (ctx.porta === 631) {
    return [
      riga(
        ctx,
        "ipp",
        "Low",
        `IPP / pannello stampante su ${dove}`,
        "La porta 631 (Internet Printing Protocol) è aperta. Non si interroga la 9100.",
        "Tieni CUPS/JetDirect fuori dalla LAN utente, con login; spegni IPP se non serve.",
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
        "Medium",
        `Redis risponde a PING senza autenticazione su ${dove}`,
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
    out.push(riga(ctx, "docker", "Medium", `Versione Docker accessibile su ${dove}`, "GET /version ha restituito ApiVersion senza credenziali.", "Non esporre il socket Docker in TCP. Usa TLS e autorizzazione, o solo lo unix socket."));
  }
  if (c.etcd) {
    out.push(riga(ctx, "etcd", "Low", `Versione etcd accessibile su ${dove}`, "GET /version ha risposto senza credenziali.", "Abilita autenticazione e TLS su etcd."));
  }
  if (c.couchdb) {
    out.push(riga(ctx, "couchdb", "Low", `Pagina iniziale CouchDB accessibile su ${dove}`, "GET / ha restituito una risposta CouchDB senza credenziali.", "Verifica che database e funzioni amministrative richiedano autenticazione."));
  }
  if (c.kubelet) {
    out.push(riga(ctx, "kubelet", "High", `Kubelet senza autenticazione su ${dove}`, "GET /runningpods ha risposto.", "Chiudi l'API read-only del kubelet (--read-only-port=0) e autentica la 10250."));
  }
  if (c.actuator_health) {
    out.push(riga(ctx, "actuator", "Low", `Spring Actuator health accessibile su ${dove}`, "GET /actuator/health restituisce lo stato senza login.", "Verifica che health esponga solo lo stato previsto e proteggi gli endpoint amministrativi."));
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
  if (c.ipmi_rakp) {
    out.push(riga(ctx, "ipmi-rakp", "High", `IPMI RAKP utente admin su ${dove}`, "RAKP Message 2 con status 0 per l'utente admin: HMAC recuperabile.", "Togli gli utenti di fabbrica dal BMC; password lunghe; IPMI fuori dalla LAN."));
  }
  if (c.nfs_export_pubblico) {
    out.push(
      riga(
        ctx,
        "nfs-stella",
        "High",
        `NFS esportato a * su ${dove}`,
        "MOUNT EXPORT elenca almeno un percorso con gruppo `*` o senza gruppi.",
        "Limita gli export agli host che servono, con root_squash; non esportare a *.",
      ),
    );
  }
  if (c.snmp_write) {
    out.push(
      riga(
        ctx,
        "snmp-write",
        "High",
        `SNMP accetta la community private in scrittura su ${dove}`,
        "SET di sysName con community private riuscito (stesso valore letto prima).",
        "Togli le community di scrittura, usa SNMPv3 con authPriv.",
      ),
    );
  }
  if (c.dns_axfr) {
    out.push(riga(ctx, "dns-axfr", "High", `Trasferimento zona DNS aperto su ${dove}`, "La sonda ha ricevuto il primo record SOA del trasferimento AXFR per la zona inversa provata.", "Limita AXFR ai secondari noti; spegni il trasferimento verso il mondo."));
  }
  if (c.tftp) {
    out.push(riga(ctx, "tftp", "Medium", `TFTP risponde su ${dove}`, "RRQ ha ricevuto DATA o ERROR: il servizio TFTP è raggiungibile.", "Spegni TFTP se non serve, o vincolalo alla rete di gestione."));
  }
  if (c.ntp_monlist) {
    out.push(riga(ctx, "ntp-monlist", "High", `NTP monlist attivo su ${dove}`, "Mode 7 MON_GETLIST ha restituito la lista dei client: si usa per amplificare DDoS.", "Aggiorna ntpd e disabilita monlist (restrict default noquery)."));
  }
  if (c.rsync) {
    out.push(riga(ctx, "rsync", "Medium", `rsync elenca i moduli su ${dove}`, "Il saluto @RSYNCD è stato accettato senza autenticazione.", "Metti un login sui moduli, o non esporre 873 in LAN."));
  }
  if (c.smtp_vrfy) {
    out.push(riga(ctx, "smtp-vrfy", "Low", `SMTP VRFY aperto su ${dove}`, "VRFY postmaster ha risposto 250 e conferma il destinatario postmaster.", "Disabilita VRFY (e EXPN) sul relay."));
  }
  if (c.adcs_enrollment) {
    out.push(riga(ctx, "adcs", "Low", `AD CS enrollment web su ${dove}`, "GET /certsrv/ mostra una pagina di iscrizione certificati AD CS.", "Tieni certsrv sulla rete di gestione, con HTTPS e autenticazione forte."));
  }
  if (c.jenkins_script_console) {
    out.push(riga(ctx, "jenkins-script", "High", `Jenkins Script Console su ${dove}`, "GET /script ha aperto la console Groovy.", "Togli Script Console agli anonimi; autentica Jenkins; non esporlo in LAN."));
  }
  if (c.vnc_auth_debole && !c.vnc_senza_auth) {
    out.push(riga(ctx, "vnc-debole", "Medium", `VNC con autenticazione debole su ${dove}`, "Il server offre il tipo 2 (password DES a 8 caratteri).", "Usa un tunnel SSH o un VNC con TLS; password lunghe non bastano sul tipo 2."));
  }
  if (c.ssh_password) {
    out.push(
      riga(
        ctx,
        "ssh-password",
        "Low",
        `SSH offre il login con password su ${dove}`,
        "Il server ha dichiarato password o keyboard-interactive. Nessun login è stato completato.",
        "In sshd_config: PasswordAuthentication no, e solo chiavi.",
      ),
    );
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
      rdp_tls: typeof o.rdp_tls === "boolean" ? o.rdp_tls : undefined,
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
      actuator_health: o.actuator_health === true,
      git_env: typeof o.git_env === "string" ? o.git_env : undefined,
      x11: o.x11 === true,
      ms17_010: o.ms17_010 === true,
      ipmi_esposto: o.ipmi_esposto === true,
      ipmi_cipher0: o.ipmi_cipher0 === true,
      nfs_export_pubblico: o.nfs_export_pubblico === true,
      snmp_write: o.snmp_write === true,
      dns_axfr: o.dns_axfr === true,
      tftp: o.tftp === true,
      ntp_monlist: o.ntp_monlist === true,
      rsync: o.rsync === true,
      smtp_vrfy: o.smtp_vrfy === true,
      adcs_enrollment: o.adcs_enrollment === true,
      jenkins_script_console: o.jenkins_script_console === true,
      vnc_auth_debole: o.vnc_auth_debole === true,
      ipmi_rakp: o.ipmi_rakp === true,
      ssh_password: o.ssh_password === true,
    };
  } catch {
    return null;
  }
}

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
}

export const TETTO_FABBRICA_PER_HOST = 3;

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

export function rilieviDaSsh(s: Pick<InfoSsh, "ident"> | null, ctx: ContestoServizio): RilievoUnito[] {
  if (!s || !eSshVecchio(s.ident)) return [];
  return [
    riga(
      ctx,
      "ssh-vecchio",
      "Medium",
      `SSH vecchio su ${ctx.ip}:${ctx.porta}`,
      `Banner ${s.ident}`,
      "Aggiorna OpenSSH alla 8 o successiva, o spegni SSH-1. Le versioni vecchie hanno cifrari e KEX deboli.",
    ),
  ];
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

export function sshDaJson(grezzo: string | null): Pick<InfoSsh, "ident"> | null {
  if (!grezzo) return null;
  try {
    const v = JSON.parse(grezzo) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const ident = (v as { ident?: unknown }).ident;
    return typeof ident === "string" ? { ident } : null;
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
    return {
      ldap_anonimo: o.ldap_anonimo === true,
      redis_aperto: o.redis_aperto === true,
      mongo_aperto: o.mongo_aperto === true,
      nfs_risponde: o.nfs_risponde === true,
      snmp_public: typeof o.snmp_public === "string" ? o.snmp_public : o.snmp_public === null ? null : undefined,
      vnc_senza_auth: o.vnc_senza_auth === true,
      fabbrica: fabbrica ?? undefined,
    };
  } catch {
    return null;
  }
}

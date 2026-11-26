/**
 * I container della macchina, letti da `docker inspect` (Protezione, tappa 1: sola lettura).
 * Modulo puro. Dell'ispezione si tengono solo nome, immagine, rete, porte e permessi: mai `Env`,
 * dove stanno i segreti dei moduli.
 */
export interface PortaContainer {
  porta: number;
  proto: "tcp" | "udp";
}
export interface PortaPubblicata extends PortaContainer {
  /** Porta sulla macchina e indirizzo su cui Docker la pubblica. */
  suMacchina: number;
  indirizzo: string;
}
export interface Container {
  nome: string;
  immagine: string;
  /** `host` = usa la rete della macchina: le sue porte non compaiono fra le pubblicate. */
  rete: string;
  privilegiato: boolean;
  /** Capability in più (`NET_ADMIN`, `NET_RAW`…), senza il prefisso `CAP_`. */
  permessi: string[];
  pubblicate: PortaPubblicata[];
  /** Dichiarate dall'immagine e non pubblicate: raggiungibili solo dagli altri container. */
  interne: PortaContainer[];
  modulo: string;
}

type Json = unknown;
const ogg = (v: Json): Record<string, Json> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : null);
const testo = (v: Json): string => (typeof v === "string" ? v : "");

/** Il modulo di DA-IPAM a cui appartiene un container, dal nome. Elenco chiuso: il resto è «Altro». */
const MODULI: ReadonlyArray<readonly [RegExp, string]> = [
  [/librenms/i, "LibreNMS"],
  [/meshcentral/i, "MeshCentral"],
  [/wazuh/i, "Wazuh"],
  [/graylog|opensearch|mongo/i, "Graylog"],
  [/hmdm|headwind|mdm/i, "MDM"],
  [/zabbix/i, "Zabbix"],
  [/adguard|net-services/i, "Servizi di rete"],
  [/edge|gvmd|ospd|openvas|gsad|pg-gvm|redis-server|gb-nginx|notus|-data-|vulnerability-tests|report-formats|data-objects|cert-bund|dfn-cert|scap/i, "Scanner-Edge"],
  [/nginx/i, "DA-IPAM"],
];

export function moduloDelContainer(nome: string): string {
  return MODULI.find(([re]) => re.test(nome))?.[1] ?? "Altro";
}

function portaDa(chiave: string): PortaContainer | null {
  const m = /^(\d+)\/(tcp|udp)$/.exec(chiave);
  return m ? { porta: Number(m[1]), proto: m[2] as "tcp" | "udp" } : null;
}

/** L'uscita di `docker inspect <id…>` (un array JSON). Un testo che non è JSON dà `null`: «non so», non «nessuno». */
export function leggiContainer(json: string): Container[] | null {
  let dati: Json;
  try {
    dati = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(dati)) return null;
  const elenco: Container[] = [];
  for (const d of dati) {
    const c = ogg(d);
    if (!c) continue;
    const host = ogg(c.HostConfig);
    const config = ogg(c.Config);
    const nome = testo(c.Name).replace(/^\//, "");
    const pubblicate: PortaPubblicata[] = [];
    for (const [chiave, legami] of Object.entries(ogg(ogg(c.NetworkSettings)?.Ports) ?? {})) {
      const p = portaDa(chiave);
      if (!p || !Array.isArray(legami)) continue;
      for (const l of legami) {
        const suMacchina = Number(ogg(l)?.HostPort);
        if (Number.isInteger(suMacchina) && suMacchina > 0) pubblicate.push({ ...p, suMacchina, indirizzo: testo(ogg(l)?.HostIp) || "0.0.0.0" });
      }
    }
    const interne = Object.keys(ogg(config?.ExposedPorts) ?? {})
      .map(portaDa)
      .filter((p): p is PortaContainer => p !== null && !pubblicate.some((x) => x.porta === p.porta && x.proto === p.proto));
    elenco.push({
      nome,
      immagine: testo(config?.Image),
      rete: testo(host?.NetworkMode) || "default",
      privilegiato: host?.Privileged === true,
      permessi: (Array.isArray(host?.CapAdd) ? host.CapAdd : []).map((x) => testo(x).replace(/^CAP_/, "")).filter(Boolean),
      pubblicate,
      interne,
      modulo: moduloDelContainer(nome),
    });
  }
  return elenco.sort((a, b) => a.modulo.localeCompare(b.modulo) || a.nome.localeCompare(b.nome));
}

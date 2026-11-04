/**
 * Dall'output degli script NSE ai fatti sull'host. Funzioni **pure**: si provano
 * con una fixture XML, senza rete e senza database.
 *
 * I nomi delle chiavi degli script cambiano fra versioni di nmap (`DNS_Computer_Name`
 * contro `DNS Computer Name`, `Serial Number` contro `SerialNumber`), quindi si
 * cercano **normalizzate** — minuscole, senza spazi, trattini e underscore —
 * invece di fidarsi della forma esatta: una chiave che cambia nome non deve far
 * sparire il dato in silenzio.
 */
import type { NmapResult, NmapScriptOutput } from "@/types";
import type { FattiProfilo, ProfiloScansione, RilievoProfilo } from "./tipi";

function normalizza(k: string): string {
  return k.toLowerCase().replace(/[\s_\-.]/g, "");
}

/** Primo valore non vuoto fra i candidati, confrontati normalizzati. */
function prendi(elems: Record<string, string>, ...candidati: string[]): string | undefined {
  const mappa = new Map<string, string>();
  for (const [k, v] of Object.entries(elems)) {
    const n = normalizza(k);
    if (!mappa.has(n) && v.trim()) mappa.set(n, v.trim());
  }
  for (const c of candidati) {
    const v = mappa.get(normalizza(c));
    if (v) return v;
  }
  return undefined;
}

/** Valori di tutte le chiavi che finiscono con il suffisso dato (per le liste indicizzate). */
function prendiTutti(elems: Record<string, string>, suffisso: string): string[] {
  const atteso = normalizza(suffisso);
  const out: string[] = [];
  for (const [k, v] of Object.entries(elems)) {
    if (normalizza(k).endsWith(atteso) && v.trim()) out.push(v.trim());
  }
  return out;
}

/** Scarta i segnaposto che nmap usa quando un campo non c'e'. */
function pulito(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (!t) return undefined;
  if (/^(<unknown>|unknown|n\/a|none|null|-)$/i.test(t)) return undefined;
  return t;
}

/** Un CN di certificato vale come nome host solo se ne ha la forma (no wildcard, no spazi). */
function cnComeHostname(cn: string | undefined): string | undefined {
  const t = pulito(cn);
  if (!t) return undefined;
  if (t.includes("*") || /\s/.test(t)) return undefined;
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(t)) return undefined;
  return t;
}

/** Unisce i fatti senza sovrascrivere ciò che è già stato stabilito da uno script più affidabile. */
function unisci(base: FattiProfilo, aggiunta: FattiProfilo): FattiProfilo {
  const out: FattiProfilo = { ...base };
  for (const [k, v] of Object.entries(aggiunta) as Array<[keyof FattiProfilo, unknown]>) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      const presenti = (out[k] as string[] | undefined) ?? [];
      out[k] = [...new Set([...presenti, ...(v as string[])])] as never;
      continue;
    }
    if (out[k] === undefined) out[k] = v as never;
  }
  return out;
}

/**
 * Un singolo script -> fatti. L'ordine in cui il chiamante passa gli script
 * conta: il primo che riempie un campo vince (vedi `ORDINE_AFFIDABILITA`).
 */
export function fattiDaScript(s: NmapScriptOutput): FattiProfilo {
  const e = s.elems;
  switch (s.id) {
    case "rdp-ntlm-info":
      return {
        hostname: pulito(prendi(e, "DNS_Computer_Name", "DNS Computer Name")),
        dominio: pulito(prendi(e, "DNS_Domain_Name", "DNS Domain Name", "NetBIOS_Domain_Name")),
        netbios: pulito(prendi(e, "NetBIOS_Computer_Name", "NetBIOS Computer Name", "Target_Name")),
        /* `Product_Version` e' la build di Windows ("10.0.19041"): non e' un nome
         * di sistema operativo, quindi si etichetta, altrimenti `os_family`
         * (colonna generata) non la riconoscerebbe come Windows. */
        osInfo: pulito(prendi(e, "Product_Version", "Product Version"))
          ? `Windows build ${prendi(e, "Product_Version", "Product Version")}`
          : undefined,
      };
    case "smb-os-discovery":
      return {
        osInfo: pulito(prendi(e, "OS")),
        hostname: pulito(prendi(e, "FQDN", "Computer name", "Computer_name")),
        dominio: pulito(prendi(e, "Domain name", "Domain_name", "Forest name")),
        netbios: pulito(prendi(e, "NetBIOS computer name", "NetBIOS_computer_name")),
      };
    case "nbstat": {
      /* nbstat mette il nome negli elem quando puo', altrimenti resta solo
       * nell'output ("NetBIOS name: PC01, NetBIOS user: <unknown>, ..."). */
      const dagliElem = pulito(prendi(e, "server_name", "server name"));
      const dalTesto = s.output?.match(/NetBIOS name:\s*([^,\n]+)/i)?.[1];
      return { netbios: dagliElem ?? pulito(dalTesto) };
    }
    case "ssl-cert":
      return {
        hostname: cnComeHostname(prendi(e, "subject.commonName", "commonName")),
        produttore: pulito(prendi(e, "subject.organizationName", "organizationName")),
      };
    case "ssh-hostkey":
      return { chiaviSsh: prendiTutti(e, "fingerprint") };
    case "http-title":
      return { titoloWeb: pulito(prendi(e, "title")) };
    case "http-generator":
      return { titoloWeb: undefined, produttore: pulito(prendi(e, "0", "generator")) };
    case "snmp-sysdescr":
      return { osInfo: pulito(s.output?.split("\n")[0]) };
    case "upnp-info":
      return {
        modello: pulito(s.output?.match(/Model(?:\s*(?:Name|Number))?:\s*([^\n]+)/i)?.[1]),
        produttore: pulito(s.output?.match(/Manufacturer:\s*([^\n]+)/i)?.[1]),
      };
    case "ipmi-version":
      return { protocolloOt: undefined, osInfo: undefined, produttore: undefined };

    // --- OT ---
    case "s7-info":
      return {
        protocolloOt: "s7",
        produttore: "Siemens",
        modello: pulito(prendi(e, "Module", "Basic Hardware", "Module Name")),
        seriale: pulito(prendi(e, "Serial Number", "SerialNumber")),
        firmware: pulito(prendi(e, "Version", "Basic Firmware", "Firmware")),
        hostname: pulito(prendi(e, "Module Name", "Plant Identification")),
      };
    case "enip-info":
      return {
        protocolloOt: "enip",
        produttore: pulito(prendi(e, "Vendor", "Vendor Name")),
        modello: pulito(prendi(e, "Product Name", "ProductName", "Device Type")),
        seriale: pulito(prendi(e, "Serial Number", "SerialNumber")),
        firmware: pulito(prendi(e, "Revision", "Product Code Revision")),
      };
    case "omron-info":
      return {
        protocolloOt: "fins",
        produttore: "Omron",
        modello: pulito(prendi(e, "Controller Model", "ControllerModel", "Model")),
        firmware: pulito(prendi(e, "Controller Version", "ControllerVersion", "Version")),
      };
    case "bacnet-info":
      return {
        protocolloOt: "bacnet",
        produttore: pulito(prendi(e, "Vendor Name", "VendorName", "Vendor ID")),
        modello: pulito(prendi(e, "Model Name", "ModelName", "Object-identifier")),
        firmware: pulito(prendi(e, "Firmware", "Application Software", "Firmware Revision")),
        seriale: pulito(prendi(e, "Serial Number", "SerialNumber")),
      };
    case "mqtt-subscribe":
      return { protocolloOt: "mqtt" };
    default:
      return {};
  }
}

/**
 * Ordine di affidabilita': chi viene prima riempie il campo.
 *
 * `rdp-ntlm-info` e `smb-os-discovery` parlano col sistema operativo e danno il
 * nome vero; il CN di un certificato e' spesso autofirmato con un nome di
 * fantasia, quindi arriva per ultimo fra quelli che propongono un hostname.
 */
const ORDINE_AFFIDABILITA: readonly string[] = [
  "s7-info",
  "enip-info",
  "bacnet-info",
  "omron-info",
  "rdp-ntlm-info",
  "smb-os-discovery",
  "nbstat",
  "snmp-sysdescr",
  "upnp-info",
  "ssh-hostkey",
  "http-title",
  "http-generator",
  "ssl-cert",
  "mqtt-subscribe",
];

/** Peso dello script nell'ordine di affidabilita': piu' basso = piu' affidabile. */
export function pesoScript(id: string): number {
  const i = ORDINE_AFFIDABILITA.indexOf(id);
  return i === -1 ? ORDINE_AFFIDABILITA.length : i;
}

/** Tutti gli script di un risultato nmap, porta per porta piu' quelli dell'host. */
export function scriptDelRisultato(
  r: NmapResult
): Array<{ porta: number | null; protocollo: "tcp" | "udp" | null; script: NmapScriptOutput }> {
  const out: Array<{ porta: number | null; protocollo: "tcp" | "udp" | null; script: NmapScriptOutput }> = [];
  for (const p of r.ports) {
    for (const s of p.scripts ?? []) {
      out.push({ porta: p.port, protocollo: p.protocol === "udp" ? "udp" : "tcp", script: s });
    }
  }
  for (const s of r.hostScripts ?? []) out.push({ porta: null, protocollo: null, script: s });
  return out;
}

/** Rilievi da salvare, uno per script eseguito. */
export function rilieviDaRisultato(r: NmapResult, profilo: ProfiloScansione["id"]): RilievoProfilo[] {
  return scriptDelRisultato(r).map(({ porta, protocollo, script }) => ({
    ip: r.ip,
    profilo,
    porta,
    protocollo,
    script: script.id,
    elems: script.elems,
    output: script.output,
  }));
}

/** I fatti dell'host: tutti gli script fusi secondo `ORDINE_AFFIDABILITA`. */
export function fattiDaRisultato(r: NmapResult): FattiProfilo {
  const script = scriptDelRisultato(r)
    .map((x) => x.script)
    .sort((a, b) => pesoScript(a.id) - pesoScript(b.id));
  let fatti: FattiProfilo = {};
  for (const s of script) fatti = unisci(fatti, fattiDaScript(s));
  /* `-O` scrive l'OS a livello host: vale come ripiego, non vince su chi ha
   * parlato col sistema operativo (SMB, RDP). */
  if (!fatti.osInfo && pulito(r.os ?? undefined)) fatti.osInfo = r.os ?? undefined;
  /* Porte di campo aperte senza nessuno script che risponda: il protocollo si
   * dice, la classificazione la decide l'attribuzione. */
  if (!fatti.protocolloOt) {
    const aperte = new Set(r.ports.filter((p) => p.protocol !== "udp").map((p) => p.port));
    if (aperte.has(102)) fatti.protocolloOt = "s7";
    else if (aperte.has(502)) fatti.protocolloOt = "modbus";
    else if (aperte.has(44818)) fatti.protocolloOt = "enip";
    else if (aperte.has(4840)) fatti.protocolloOt = "opcua";
    else if (aperte.has(1883) || aperte.has(8883)) fatti.protocolloOt = "mqtt";
    else if (aperte.has(19999) || aperte.has(20000)) fatti.protocolloOt = "dnp3";
    else if (aperte.has(18245) || aperte.has(18246)) fatti.protocolloOt = "ge_srtp";
    else if (aperte.has(9600)) fatti.protocolloOt = "fins";
  }
  return fatti;
}

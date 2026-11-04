/**
 * Dai rilievi di un profilo di scansione alle evidenze dell'attribuzione v2.
 * Funzioni **pure**: nessuna rete, nessun database.
 *
 * Perche' serve (04/11/2026): dal Fix C1 l'unico motore che scrive
 * `hosts.classification` e' l'attribuzione v2. Un profilo che trova un PLC e non
 * emette evidenza non classifica niente — e' esattamente il buco trovato la
 * mattina del 04/11 con le regole OT, che funzionavano ma non scrivevano la classe.
 */
import type { EvidenceInput } from "./types";
import { isValidCategory } from "./taxonomy";
import { vendorSlug } from "./emitters";
import type { NmapScriptOutput } from "@/types";

const FASE = "scan_profilo" as const;

/**
 * Produttori riconosciuti da un nome di organizzazione (certificato TLS, UPnP,
 * CIP). Elenco chiuso di proposito: l'organizzazione di un certificato e'
 * spesso un segnaposto ("Internet Widgits Pty Ltd") o l'autorita' che l'ha
 * firmato, e trasformarla in produttore a occhi chiusi sporca l'inventario.
 */
const PRODUTTORI_NOTI: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bsiemens\b/i, "Siemens"],
  [/\brockwell|allen.?bradley\b/i, "Rockwell Automation"],
  [/\bschneider|modicon|telemecanique\b/i, "Schneider Electric"],
  [/\bomron\b/i, "Omron"],
  [/\bmitsubishi\b/i, "Mitsubishi Electric"],
  [/\bbeckhoff\b/i, "Beckhoff"],
  [/\bwago\b/i, "WAGO"],
  [/\bphoenix contact\b/i, "Phoenix Contact"],
  [/\bweintek\b/i, "Weintek"],
  [/\bcrevis\b/i, "CREVIS"],
  [/\bvacon|danfoss\b/i, "Danfoss"],
  [/\bcontrol techniques|nidec\b/i, "Control Techniques"],
  [/\babb\b/i, "ABB"],
  [/\bhoneywell\b/i, "Honeywell"],
  [/\bjohnson controls\b/i, "Johnson Controls"],
  [/\bcarel\b/i, "Carel"],
  [/\bsynology\b/i, "Synology"],
  [/\bqnap\b/i, "QNAP"],
  [/\bubiquiti\b/i, "Ubiquiti"],
  [/\bmikrotik\b/i, "MikroTik"],
  [/\bzyxel\b/i, "Zyxel"],
  [/\bfortinet\b/i, "Fortinet"],
  [/\bsophos\b/i, "Sophos"],
  [/\bstormshield|netasq\b/i, "Stormshield"],
  [/\bvmware\b/i, "VMware"],
  [/\bproxmox\b/i, "Proxmox"],
  [/\bcisco\b/i, "Cisco"],
  [/\bhewlett|hpe\b/i, "HPE"],
  [/\bdell\b/i, "Dell"],
  [/\bapc\b|\bschneider.?electric.?it\b/i, "APC"],
  [/\beaton\b/i, "Eaton"],
  [/\baxis communications\b/i, "Axis"],
  [/\bhikvision\b/i, "Hikvision"],
  [/\bdahua\b/i, "Dahua"],
];

/** Nome di organizzazione -> produttore noto, oppure `null` se non e' riconoscibile. */
export function produttoreNoto(testo: string | undefined): string | null {
  if (!testo) return null;
  const trovato = PRODUTTORI_NOTI.find(([re]) => re.test(testo));
  return trovato ? trovato[1] : null;
}

function famigliaOs(testo: string | undefined): string | null {
  if (!testo) return null;
  const t = testo.toLowerCase();
  if (t.includes("windows")) return "windows";
  if (/linux|ubuntu|debian|centos|rhel|red hat|alpine|suse/.test(t)) return "linux";
  if (/mac os|macos|darwin/.test(t)) return "macos";
  return null;
}

/**
 * `Device Type` di EtherNet/IP -> foglia della tassonomia.
 *
 * Il campo CIP e' testuale e dichiarato dall'apparato: "Programmable Logic
 * Controller", "AC Drive", "Communications Adapter", "Human Machine Interface".
 * Dove non e' riconoscibile si resta sulla radice `ot`: meglio dire "e' un
 * apparato di campo" che inventare la foglia.
 */
export function fogliaDaTipoCip(tipo: string | undefined): string {
  if (!tipo) return "ot";
  const t = tipo.toLowerCase();
  if (/logic controller|\bplc\b|controller/.test(t)) return "ot.plc";
  if (/drive|inverter|motor/.test(t)) return "ot.drive";
  if (/human machine|\bhmi\b|operator/.test(t)) return "ot.hmi";
  if (/adapter|gateway|bridge|communications/.test(t)) return "ot.gateway";
  if (/\bi\/?o\b|point/.test(t)) return "ot.io_remoto";
  return "ot";
}

/**
 * Evidenze da un singolo script. L'host a cui appartengono lo sa il chiamante.
 *
 * Le confidenze alte (0.95) sugli script di campo sono volute: `ot_probe` sta
 * fra le sorgenti dichiarative per la categoria, quindi a >= 0.9 salta la somma
 * pesata. Una risposta S7 o CIP non e' un indizio sul tipo di apparato: e' il
 * protocollo industriale che si dichiara. `mqtt-subscribe` invece resta sotto
 * soglia (0.5): un broker MQTT puo' essere un gateway di campo come un server.
 */
export function evidenzeDaScript(s: NmapScriptOutput): EvidenceInput[] {
  const out: EvidenceInput[] = [];
  const e = s.elems;
  const grezzo = (v: string | undefined) => (v ? v.slice(0, 200) : null);

  switch (s.id) {
    case "s7-info": {
      out.push({ source: "ot_probe", phase: FASE, dimension: "category", claim: "ot.plc", confidence: 0.95, raw_value: grezzo(e["Module"] ?? s.output ?? undefined) });
      out.push({ source: "ot_probe", phase: FASE, dimension: "vendor", claim: vendorSlug("Siemens"), confidence: 0.95, raw_value: "s7-info" });
      break;
    }
    case "enip-info": {
      const claim = fogliaDaTipoCip(e["Device Type"] ?? e["DeviceType"]);
      if (isValidCategory(claim)) {
        out.push({ source: "ot_probe", phase: FASE, dimension: "category", claim, confidence: 0.95, raw_value: grezzo(e["Device Type"] ?? e["Product Name"]) });
      }
      const v = produttoreNoto(e["Vendor"] ?? e["Vendor Name"]);
      if (v) out.push({ source: "ot_probe", phase: FASE, dimension: "vendor", claim: vendorSlug(v), confidence: 0.9, raw_value: grezzo(e["Vendor"]) });
      break;
    }
    case "omron-info": {
      out.push({ source: "ot_probe", phase: FASE, dimension: "category", claim: "ot.plc", confidence: 0.95, raw_value: grezzo(e["Controller Model"] ?? s.output ?? undefined) });
      out.push({ source: "ot_probe", phase: FASE, dimension: "vendor", claim: vendorSlug("Omron"), confidence: 0.95, raw_value: "omron-info" });
      break;
    }
    case "bacnet-info": {
      /* BACnet/IP e' building automation: l'apparato e' di campo, ma il tipo
       * (controllore, termostato, centrale) il protocollo non lo dice. Radice. */
      out.push({ source: "ot_probe", phase: FASE, dimension: "category", claim: "ot", confidence: 0.92, raw_value: grezzo(e["Vendor Name"] ?? s.output ?? undefined) });
      const v = produttoreNoto(e["Vendor Name"] ?? e["VendorName"]);
      if (v) out.push({ source: "ot_probe", phase: FASE, dimension: "vendor", claim: vendorSlug(v), confidence: 0.9, raw_value: grezzo(e["Vendor Name"]) });
      break;
    }
    case "mqtt-subscribe":
      out.push({ source: "ot_probe", phase: FASE, dimension: "category", claim: "iot", confidence: 0.5, raw_value: "mqtt-subscribe" });
      break;

    case "rdp-ntlm-info": {
      out.push({ source: "rdp_ntlm", phase: FASE, dimension: "os", claim: "windows", confidence: 0.9, raw_value: grezzo(e["Product_Version"] ?? e["Target_Name"]) });
      break;
    }
    case "smb-os-discovery": {
      const fam = famigliaOs(e["OS"]);
      if (fam) out.push({ source: "smb", phase: FASE, dimension: "os", claim: fam, confidence: 0.85, raw_value: grezzo(e["OS"]) });
      break;
    }
    case "nbstat":
      /* Un nome NetBIOS implica SMB, quindi quasi sempre Windows: indizio
       * debole, apposta — un NAS Linux con Samba risponde allo stesso modo. */
      out.push({ source: "netbios", phase: FASE, dimension: "os", claim: "windows", confidence: 0.45, raw_value: grezzo(e["server_name"]) });
      break;
    case "ssl-cert": {
      const v = produttoreNoto(e["subject.organizationName"] ?? e["organizationName"] ?? e["subject.commonName"]);
      if (v) out.push({ source: "tls_cert", phase: FASE, dimension: "vendor", claim: vendorSlug(v), confidence: 0.8, raw_value: grezzo(e["subject.organizationName"] ?? e["subject.commonName"]) });
      break;
    }
    case "upnp-info": {
      const v = produttoreNoto(s.output ?? undefined);
      if (v) out.push({ source: "ssdp", phase: FASE, dimension: "vendor", claim: vendorSlug(v), confidence: 0.75, raw_value: grezzo(s.output ?? undefined) });
      break;
    }
    default:
      break;
  }
  return out;
}

/**
 * Porta di campo aperta e nessuno script che risponda: si dice che e' un
 * apparato OT, non quale. Sotto 0.9 di proposito: non e' dichiarativa, e una
 * 502 aperta puo' stare anche su un gateway o un software di supervisione.
 */
export function evidenzaDaPortaOt(porteTcpAperte: readonly number[]): EvidenceInput | null {
  const set = new Set(porteTcpAperte);
  const porta = [102, 502, 44818, 4840, 9600, 19999, 20000, 18245, 18246].find((p) => set.has(p));
  if (porta === undefined) return null;
  return {
    source: "ot_probe",
    phase: FASE,
    dimension: "category",
    claim: "ot",
    confidence: 0.7,
    raw_value: `porta ${porta} aperta, nessuno script di campo ha risposto`,
  };
}

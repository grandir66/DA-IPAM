/**
 * Esiti di autenticazione (`credential_validate`) → evidenze di attribuzione
 * (fase 1b credenziali, §7.3 della spec). Funzione PURA: nessuna chiamata DB
 * né di rete — il chiamante (`scanner/discovery.ts`) passa l'esito già
 * osservato e poi persiste il risultato con `recordEvidence` +
 * `recomputeAttributionSafe`.
 *
 * Regole (dal brief Task 4):
 * - WinRM OK → `os=windows` @0.95 (autoritativa: `winrm` è in
 *   `AUTHORITATIVE_SOURCES.os` e 0.95 ≥ `AUTHORITY_MIN_CONFIDENCE`=0.9).
 * - WinRM auth rifiutata ma servizio presente (banner/segnale non vuoto) →
 *   `category=compute` @0.3 (debole: `winrm` non è autoritativa su
 *   `category`, e 0.3 è comunque ben sotto `AUTHORITY_MIN_CONFIDENCE`).
 * - SSH OK con banner OpenSSH/Debian/Ubuntu → `os=linux` @0.9 + `category=compute` @0.6.
 * - SSH OK con banner RouterOS/IOS/VyOS/EdgeOS → `os=network-os` @0.9 +
 *   `category=network` @0.7 + `vendor` (mikrotik/cisco/vyos/ubiquiti) @0.7.
 * - SSH auth rifiutata → nessuna evidenza: un servizio SSH presente è troppo
 *   generico (qualunque server/apparato risponde in SSH) per giustificare
 *   anche solo un claim debole.
 * - SNMP (OK o rifiutata) → nessuna evidenza qui: sysObjectID/sysDescr sono
 *   già coperti da `emitEvidenceFromSignals` (emitters.ts) sui dati persistiti.
 * - API → nessuna regola in questa fase (nessun test di autenticazione reale
 *   per questo protocollo in `credential_validate`, vedi Task 3).
 */
import type { CredProtocol } from "@/lib/credentials/resolve";
import type { EvidenceInput } from "./types";
import { vendorSlug } from "./emitters";

export interface AuthOutcome {
  protocol: CredProtocol;
  ok: boolean;
  /** Banner SSH, output hostname WinRM, sysDescr SNMP — qualunque testo osservato durante il tentativo. */
  banner?: string | null;
  sysObjectId?: string | null;
}

const LINUX_BANNER_RE = /openssh|debian|ubuntu/i;
const ROUTEROS_RE = /routeros|mikrotik/i;
const EDGEOS_RE = /edgeos|edgerouter/i;
const VYOS_RE = /vyos/i;
const CISCO_IOS_RE = /cisco|\bios\b/i;

/** Rileva un OS di rete "network-os" nel banner SSH e il vendor associato. Match più specifico prima del generico Linux. */
function detectNetworkOsVendor(banner: string): string | null {
  if (ROUTEROS_RE.test(banner)) return vendorSlug("MikroTik");
  if (EDGEOS_RE.test(banner)) return vendorSlug("Ubiquiti");
  if (VYOS_RE.test(banner)) return vendorSlug("VyOS");
  if (CISCO_IOS_RE.test(banner)) return vendorSlug("Cisco");
  return null;
}

export function evidenceFromAuthOutcome(o: AuthOutcome): EvidenceInput[] {
  const banner = (o.banner ?? "").trim();

  if (o.protocol === "winrm") {
    if (o.ok) {
      return [
        {
          source: "winrm", phase: "credential_validate", dimension: "os",
          claim: "windows", confidence: 0.95, raw_value: banner || null,
        },
      ];
    }
    // Auth rifiutata ma il servizio ha risposto (il chiamante passa un banner/marker
    // solo quando l'errore indica un WinRM raggiunto, non una porta chiusa/timeout).
    if (banner) {
      return [
        {
          source: "winrm", phase: "credential_validate", dimension: "category",
          claim: "compute", confidence: 0.3, raw_value: banner,
        },
      ];
    }
    return [];
  }

  if (o.protocol === "ssh") {
    if (!o.ok || !banner) return [];

    const netVendor = detectNetworkOsVendor(banner);
    if (netVendor) {
      return [
        { source: "ssh", phase: "credential_validate", dimension: "os", claim: "network-os", confidence: 0.9, raw_value: banner },
        { source: "ssh", phase: "credential_validate", dimension: "category", claim: "network", confidence: 0.7, raw_value: banner },
        { source: "ssh", phase: "credential_validate", dimension: "vendor", claim: netVendor, confidence: 0.7, raw_value: banner },
      ];
    }

    // Minor 2 (review post-fase1b): "SSH-2.0-OpenSSH_for_Windows_8.1" matcha
    // LINUX_BANNER_RE (contiene "openssh") ma è un banner Windows — produrrebbe
    // un falso os=linux. Escludere esplicitamente i banner con "windows" PRIMA
    // del match linux: meglio nessuna evidenza che una evidenza sbagliata.
    if (!/windows/i.test(banner) && LINUX_BANNER_RE.test(banner)) {
      return [
        { source: "ssh", phase: "credential_validate", dimension: "os", claim: "linux", confidence: 0.9, raw_value: banner },
        { source: "ssh", phase: "credential_validate", dimension: "category", claim: "compute", confidence: 0.6, raw_value: banner },
      ];
    }

    return [];
  }

  // snmp: già coperto da emitEvidenceFromSignals (sysobj/sysdescr sui dati persistiti).
  // api: nessun test di autenticazione reale in questa fase (Task 3) — nessuna regola.
  return [];
}

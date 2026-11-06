/**
 * Raccolta credenziali subnet IPAM → payload sicuro per sync su scanner-edge/GVM.
 * Solo server-side: i secret non escono mai verso il client browser.
 */

import {
  accessoSshCredenziale,
  getAdIntegrations,
  getAdRealm,
  getCredentialById,
  getCredentialCommunityString,
  getCredentialLoginPair,
  getDb,
  getNetworkById,
  getOrderedDetectCredentialIds,
  getOrderedSshLinuxCredentialIds,
  buildSnmpCommunitiesForNetwork,
} from "@/lib/db";
import { credenzialeLdapDb } from "@/lib/ad/credenziale-ldap";
import { catenaReteDb } from "@/lib/credentials/resolve";
import { normalizzaTipo } from "@/lib/credentials/tipi";

export type EdgeCredentialSlot = "ssh" | "smb" | "snmp" | "ad";

export interface EdgeCredentialPreview {
  credential_id: number | null;
  name: string;
  credential_type: string;
  slot: EdgeCredentialSlot | null;
  selected_for_scan: boolean;
  /** Perché la voce non parte verso lo scanner, quando lo si sa (es. SNMP v3). */
  motivo?: string;
}

/** Payload verso edge (contiene secret — solo server-side). */
export interface EdgeCredentialTransfer {
  slot: EdgeCredentialSlot;
  name: string;
  cred_type: "up" | "snmp" | "usk";
  login?: string;
  password?: string;
  private_key?: string;
  passphrase?: string;
  community?: string;
  domain?: string;
  ipam_credential_id?: number;
  sort_order: number;
}

function splitWindowsLogin(raw: string): { login: string; domain: string | null } {
  const s = raw.trim();
  if (s.includes("\\")) {
    const [domain, login] = s.split("\\", 2);
    return { login: (login || s).trim(), domain: domain.trim() || null };
  }
  if (s.includes("@")) {
    const [login, domain] = s.split("@", 2);
    return { login: (login || s).trim(), domain: (domain || "").trim() || null };
  }
  return { login: s, domain: null };
}

/**
 * Perché una voce non può partire verso lo scanner. Lo slot SNMP dello scanner
 * prende solo una community: una SNMP v3 (T12) compare nell'anteprima, non
 * selezionata, invece di sparire o di partire vuota.
 */
function motivoEsclusione(cred: { credential_type: string }): string | null {
  const tipo = normalizzaTipo(String(cred.credential_type || ""));
  if (tipo === "snmp_v3") return "Non inviata allo scanner: SNMP v3 (lo scanner usa solo community)";
  return null;
}

/** L'account di una voce `ad`: si legge come fa il bind LDAP, non come una voce Windows (D7). */
function coppiaAccountAd(credentialId: number): { username: string; password: string } | null {
  const c = credenzialeLdapDb(getDb(), { credential_id: credentialId, encrypted_username: "", encrypted_password: "" });
  return c.ok ? { username: c.username, password: c.password } : null;
}

function buildTransferFromCredential(
  credentialId: number,
  slot: EdgeCredentialSlot,
  sortOrder: number,
): EdgeCredentialTransfer | null {
  const cred = getCredentialById(credentialId);
  if (!cred) return null;

  const type = normalizzaTipo(String(cred.credential_type || ""));
  const baseName = `IPAM · ${cred.name}`.slice(0, 80);

  if (motivoEsclusione(cred)) return null;

  if (slot === "snmp" || type === "snmp") {
    const community = getCredentialCommunityString(credentialId);
    if (!community?.trim()) return null;
    return {
      slot: "snmp",
      name: baseName,
      cred_type: "snmp",
      community: community.trim(),
      ipam_credential_id: credentialId,
      sort_order: sortOrder,
    };
  }

  if (slot === "ssh") {
    const esito = accessoSshCredenziale(credentialId);
    if (!esito.ok) return null;
    const { username, password, privateKey, passphrase } = esito.accesso;
    if (privateKey) {
      return {
        slot: "ssh",
        name: baseName,
        cred_type: "usk",
        login: username,
        private_key: privateKey,
        ...(passphrase ? { passphrase } : {}),
        ipam_credential_id: credentialId,
        sort_order: sortOrder,
      };
    }
    if (!password) return null;
    return {
      slot: "ssh",
      name: baseName,
      cred_type: "up",
      login: username,
      password,
      ipam_credential_id: credentialId,
      sort_order: sortOrder,
    };
  }

  if (slot === "smb" || slot === "ad") {
    const pair = type === "ad" ? coppiaAccountAd(credentialId) : getCredentialLoginPair(credentialId, "windows");
    if (!pair) return null;
    const parsed = splitWindowsLogin(pair.username);
    const realm = getAdRealm()?.realm ?? null;
    return {
      slot,
      name: slot === "ad" ? `${baseName} (AD)`.slice(0, 80) : baseName,
      cred_type: "up",
      login: parsed.login,
      password: pair.password,
      domain: parsed.domain ?? realm ?? undefined,
      ipam_credential_id: credentialId,
      sort_order: sortOrder,
    };
  }

  return null;
}

/**
 * Elenco credenziali subnet (preview UI + payload sync edge). `registra: false`
 * per le verifiche (fotografia).
 *
 * Gli slot si fanno dalla catena della rete del motore, un protocollo alla
 * volta: SSH, poi Windows (SMB, e AD con le stesse voci), poi SNMP (tappa 2
 * credenziali, T17). Prima si mettevano davanti le voci della lista della
 * rete, in ordine di lista, e dopo le catene vecchie: le stesse voci, spostate
 * dalla catena vecchia alla lista dalla conversione della 2d, uscivano in un
 * altro ordine. Dentro ogni slot l'ordine è quello di prima (la lista viene
 * per prima anche nel motore); le catene vecchie e la chiave dell'hub entrano
 * solo finché la 2d non le ha convertite.
 */
export function collectEdgeCredentialsForNetwork(networkId: number, opts: { registra?: boolean } = {}): {
  preview: EdgeCredentialPreview[];
  transfer: EdgeCredentialTransfer[];
} {
  const preview: EdgeCredentialPreview[] = [];
  const transfer: EdgeCredentialTransfer[] = [];
  const seen = new Set<number>();
  let order = 0;

  const pushCred = (credentialId: number, slot: EdgeCredentialSlot) => {
    if (seen.has(credentialId)) return;
    seen.add(credentialId);
    const cred = getCredentialById(credentialId);
    if (!cred) return;

    const spec = buildTransferFromCredential(credentialId, slot, order);
    order += 1;
    const motivo = motivoEsclusione(cred);

    preview.push({
      credential_id: credentialId,
      name: cred.name,
      credential_type: String(cred.credential_type),
      slot,
      selected_for_scan: spec != null,
      ...(motivo ? { motivo } : {}),
    });

    if (spec) transfer.push(spec);
  };

  for (const credId of getOrderedSshLinuxCredentialIds(networkId, opts)) {
    pushCred(credId, "ssh");
  }
  for (const credId of getOrderedDetectCredentialIds(networkId, "windows", opts)) {
    pushCred(credId, "smb");
  }
  // L'account AD dell'integrazione vale per lo scanner (Riccardo, 05/11/2026), non per la lista
  // della rete: lì finirebbe nelle prove in sequenza (D7). Viene dopo le voci Windows della rete.
  for (const integrazione of getAdIntegrations()) {
    if (integrazione.enabled && integrazione.credential_id != null) pushCred(integrazione.credential_id, "smb");
  }
  // Slot AD per assessment cred-bind (stesse cred Windows, payload dedicato edge).
  const smbIds = transfer.filter((t) => t.slot === "smb").map((t) => t.ipam_credential_id);
  for (const credId of smbIds) {
    if (credId == null) continue;
    const adSpec = buildTransferFromCredential(credId, "ad", order);
    order += 1;
    if (adSpec) {
      transfer.push(adSpec);
      const cred = getCredentialById(credId);
      preview.push({
        credential_id: credId,
        name: cred?.name ?? `cred #${credId}`,
        credential_type: "windows",
        slot: "ad",
        selected_for_scan: true,
      });
    }
  }
  for (const credId of catenaReteDb(getDb(), networkId, "snmp", { registra: opts.registra })) {
    pushCred(credId, "snmp");
  }

  // Community SNMP di default subnet (se nessuna cred SNMP valida)
  const hasSnmpTransfer = transfer.some((t) => t.slot === "snmp");
  if (!hasSnmpTransfer) {
    const communities = buildSnmpCommunitiesForNetwork(networkId, null, opts);
    const community = communities.find((c) => c && c !== "public" && c !== "private") ?? communities[0];
    if (community?.trim()) {
      const net = getNetworkById(networkId);
      transfer.push({
        slot: "snmp",
        name: `IPAM · SNMP ${net?.name ?? networkId}`.slice(0, 80),
        cred_type: "snmp",
        community: community.trim(),
        sort_order: order,
      });
      preview.push({
        credential_id: null,
        name: `Community subnet (${community.trim()})`,
        credential_type: "snmp",
        slot: "snmp",
        selected_for_scan: true,
      });
    }
  }

  transfer.sort((a, b) => a.sort_order - b.sort_order);

  const firstSlot = new Set<EdgeCredentialSlot>();
  for (const p of preview) {
    if (!p.slot || !p.selected_for_scan) continue;
    if (firstSlot.has(p.slot)) {
      p.selected_for_scan = false;
    } else {
      firstSlot.add(p.slot);
    }
  }

  return { preview, transfer };
}

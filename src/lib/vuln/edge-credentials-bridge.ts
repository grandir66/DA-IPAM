/**
 * Raccolta credenziali subnet IPAM → payload sicuro per sync su scanner-edge/GVM.
 * Solo server-side: i secret non escono mai verso il client browser.
 */

import {
  getCredentialById,
  getCredentialCommunityString,
  getCredentialLoginPair,
  getNetworkById,
  getNetworkCredentials,
  getNetworkHostCredentialIds,
  getOrderedDetectCredentialIds,
  getOrderedSshLinuxCredentialIds,
  getSshLinuxCredentialPair,
  buildSnmpCommunitiesForNetwork,
} from "@/lib/db";

export type EdgeCredentialSlot = "ssh" | "smb" | "snmp";

export interface EdgeCredentialPreview {
  credential_id: number | null;
  name: string;
  credential_type: string;
  slot: EdgeCredentialSlot | null;
  selected_for_scan: boolean;
}

/** Payload verso edge (contiene secret — solo server-side). */
export interface EdgeCredentialTransfer {
  slot: EdgeCredentialSlot;
  name: string;
  cred_type: "up" | "snmp";
  login?: string;
  password?: string;
  community?: string;
  ipam_credential_id?: number;
  sort_order: number;
}

function slotForType(credentialType: string): EdgeCredentialSlot | null {
  const t = credentialType.toLowerCase();
  if (t === "ssh" || t === "linux") return "ssh";
  if (t === "windows") return "smb";
  if (t === "snmp") return "snmp";
  return null;
}

function buildTransferFromCredential(
  credentialId: number,
  slot: EdgeCredentialSlot,
  sortOrder: number,
): EdgeCredentialTransfer | null {
  const cred = getCredentialById(credentialId);
  if (!cred) return null;

  const type = String(cred.credential_type || "").toLowerCase();
  const baseName = `IPAM · ${cred.name}`.slice(0, 80);

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
    const pair = getSshLinuxCredentialPair(credentialId);
    if (!pair) return null;
    return {
      slot: "ssh",
      name: baseName,
      cred_type: "up",
      login: pair.username,
      password: pair.password,
      ipam_credential_id: credentialId,
      sort_order: sortOrder,
    };
  }

  if (slot === "smb") {
    const pair = getCredentialLoginPair(credentialId, "windows");
    if (!pair) return null;
    return {
      slot: "smb",
      name: baseName,
      cred_type: "up",
      login: pair.username,
      password: pair.password,
      ipam_credential_id: credentialId,
      sort_order: sortOrder,
    };
  }

  return null;
}

/** Elenco credenziali subnet (preview UI + payload sync edge). */
export function collectEdgeCredentialsForNetwork(networkId: number): {
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

    preview.push({
      credential_id: credentialId,
      name: cred.name,
      credential_type: String(cred.credential_type),
      slot,
      selected_for_scan: spec != null,
    });

    if (spec) transfer.push(spec);
  };

  // v2 — lista unificata subnet
  for (const row of getNetworkCredentials(networkId)) {
    const slot = slotForType(row.credential_type);
    if (slot) pushCred(row.credential_id, slot);
  }

  // Legacy per ruolo (ordine tentativi scan IPAM)
  for (const credId of getOrderedSshLinuxCredentialIds(networkId)) {
    pushCred(credId, "ssh");
  }
  for (const credId of getOrderedDetectCredentialIds(networkId, "windows")) {
    pushCred(credId, "smb");
  }
  for (const credId of getNetworkHostCredentialIds(networkId, "snmp")) {
    pushCred(credId, "snmp");
  }

  // Community SNMP di default subnet (se nessuna cred SNMP valida)
  const hasSnmpTransfer = transfer.some((t) => t.slot === "snmp");
  if (!hasSnmpTransfer) {
    const communities = buildSnmpCommunitiesForNetwork(networkId);
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

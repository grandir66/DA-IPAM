/**
 * Human-oriented ACL risk summary: group interesting ACEs into threat buckets.
 */

import type { AclObjectKind, InterestingAce } from "./types";

export type AclRiskSeverity = "critical" | "high" | "medium";

export type AclRiskBucketId =
  | "dcsync"
  | "full_control"
  | "acl_takeover"
  | "password_reset"
  | "group_membership"
  | "adminsdholder"
  | "extended_rights";

export interface AclRiskTarget {
  objectLabel: string;
  objectDn: string;
  objectKind: AclObjectKind;
  rights: string[];
  inherited: boolean;
}

export interface AclRiskEntry {
  trusteeLabel: string;
  trusteeSid: string;
  trusteeSam: string | null;
  targets: AclRiskTarget[];
}

export interface AclRiskBucket {
  id: AclRiskBucketId;
  title: string;
  why: string;
  severity: AclRiskSeverity;
  aceCount: number;
  uniqueTrustees: number;
  uniqueTargets: number;
  entries: AclRiskEntry[];
}

export interface AclRiskSummary {
  buckets: AclRiskBucket[];
  totalInteresting: number;
  uncategorized: number;
}

const BUCKET_META: Record<
  AclRiskBucketId,
  { title: string; why: string; severity: AclRiskSeverity; order: number }
> = {
  dcsync: {
    title: "DCSync / replica directory",
    why: "Chi ha questi diritti può estrarre hash delle password come un Domain Controller.",
    severity: "critical",
    order: 0,
  },
  full_control: {
    title: "Controllo totale su oggetti",
    why: "GenericAll consente di prendere possesso dell’oggetto (reset password, membership, ACL).",
    severity: "critical",
    order: 1,
  },
  acl_takeover: {
    title: "Modifica ACL / owner",
    why: "Può cambiare i permessi o il proprietario e poi autodelegarsi diritti più alti.",
    severity: "high",
    order: 2,
  },
  password_reset: {
    title: "Reset password altrui",
    why: "ForceChangePassword su utenti consente takeover dell’account senza conoscere la password.",
    severity: "high",
    order: 3,
  },
  group_membership: {
    title: "Aggiunta membri a gruppi",
    why: "Può inserire account in gruppi (anche privilegiati) e elevare i propri privilegi.",
    severity: "high",
    order: 4,
  },
  adminsdholder: {
    title: "AdminSDHolder non standard",
    why: "ACE extra qui si propagano agli account protetti (admin) ad ogni ciclo SDProp.",
    severity: "critical",
    order: 5,
  },
  extended_rights: {
    title: "Diritti estesi ampi",
    why: "AllExtendedRights apre molte operazioni sensibili oltre i diritti generici.",
    severity: "medium",
    order: 6,
  },
};

export function shortDnName(dn: string): string {
  const first = dn.split(",")[0] ?? dn;
  return first.replace(/^(CN|OU|DC)=/i, "").trim() || dn;
}

export function shortSid(sid: string): string {
  const parts = sid.split("-");
  if (parts.length < 3) return sid;
  return `…-${parts[parts.length - 1]}`;
}

export function trusteeLabel(ace: InterestingAce): string {
  return ace.trusteeSam?.trim() || shortSid(ace.trusteeSid);
}

/** Assign each ACE to a single primary risk bucket (highest severity first). */
export function primaryBucketId(ace: InterestingAce): AclRiskBucketId | null {
  if (ace.objectKind === "adminsdholder") return "adminsdholder";
  if (ace.rights.some((r) => r.startsWith("DCSync"))) return "dcsync";
  if (ace.rights.includes("GenericAll")) return "full_control";
  if (ace.rights.includes("WriteDacl") || ace.rights.includes("WriteOwner")) {
    return "acl_takeover";
  }
  if (ace.rights.includes("ForceChangePassword")) return "password_reset";
  if (ace.rights.includes("AddMember")) return "group_membership";
  if (ace.rights.includes("AllExtendedRights")) return "extended_rights";
  return null;
}

function rightsLabelIt(right: string): string {
  const map: Record<string, string> = {
    GenericAll: "Controllo totale",
    WriteDacl: "Modifica ACL",
    WriteOwner: "Cambia owner",
    AllExtendedRights: "Diritti estesi",
    "DCSync-GetChanges": "DCSync (Get-Changes)",
    "DCSync-GetChangesAll": "DCSync (Get-Changes-All)",
    ForceChangePassword: "Reset password",
    AddMember: "Aggiungi membri",
  };
  return map[right] ?? right;
}

export function formatRightsIt(rights: string[]): string {
  return rights.map(rightsLabelIt).join(", ");
}

export const OBJECT_KIND_LABEL_IT: Record<AclObjectKind, string> = {
  domain: "Dominio",
  adminsdholder: "AdminSDHolder",
  ou: "OU",
  user: "Utente",
  group: "Gruppo",
  computer: "Computer",
};

/**
 * Build risk buckets from interesting ACEs. Pure — safe for unit tests / UI.
 */
export function summarizeAclRisk(
  aces: InterestingAce[],
  opts?: { maxTrusteesPerBucket?: number; maxTargetsPerTrustee?: number },
): AclRiskSummary {
  const maxTrustees = opts?.maxTrusteesPerBucket ?? 12;
  const maxTargets = opts?.maxTargetsPerTrustee ?? 8;

  type Acc = {
    aceCount: number;
    byTrustee: Map<
      string,
      {
        trusteeSid: string;
        trusteeSam: string | null;
        trusteeLabel: string;
        targets: AclRiskTarget[];
      }
    >;
  };

  const acc = new Map<AclRiskBucketId, Acc>();
  let uncategorized = 0;

  for (const ace of aces) {
    const id = primaryBucketId(ace);
    if (!id) {
      uncategorized += 1;
      continue;
    }
    let bucket = acc.get(id);
    if (!bucket) {
      bucket = { aceCount: 0, byTrustee: new Map() };
      acc.set(id, bucket);
    }
    bucket.aceCount += 1;
    const key = ace.trusteeSid.toUpperCase();
    let entry = bucket.byTrustee.get(key);
    if (!entry) {
      entry = {
        trusteeSid: ace.trusteeSid,
        trusteeSam: ace.trusteeSam,
        trusteeLabel: trusteeLabel(ace),
        targets: [],
      };
      bucket.byTrustee.set(key, entry);
    }
    entry.targets.push({
      objectLabel: shortDnName(ace.objectDn),
      objectDn: ace.objectDn,
      objectKind: ace.objectKind,
      rights: ace.rights,
      inherited: ace.inherited,
    });
  }

  const buckets: AclRiskBucket[] = [];
  for (const [id, data] of acc) {
    const meta = BUCKET_META[id];
    const entries: AclRiskEntry[] = [...data.byTrustee.values()]
      .map((e) => ({
        trusteeLabel: e.trusteeLabel,
        trusteeSid: e.trusteeSid,
        trusteeSam: e.trusteeSam,
        targets: e.targets
          .slice()
          .sort((a, b) => a.objectLabel.localeCompare(b.objectLabel))
          .slice(0, maxTargets),
      }))
      .sort((a, b) => b.targets.length - a.targets.length || a.trusteeLabel.localeCompare(b.trusteeLabel))
      .slice(0, maxTrustees);

    const uniqueTargets = new Set<string>();
    for (const e of data.byTrustee.values()) {
      for (const t of e.targets) uniqueTargets.add(t.objectDn);
    }

    buckets.push({
      id,
      title: meta.title,
      why: meta.why,
      severity: meta.severity,
      aceCount: data.aceCount,
      uniqueTrustees: data.byTrustee.size,
      uniqueTargets: uniqueTargets.size,
      entries,
    });
  }

  buckets.sort((a, b) => BUCKET_META[a.id].order - BUCKET_META[b.id].order);

  return {
    buckets,
    totalInteresting: aces.length,
    uncategorized,
  };
}

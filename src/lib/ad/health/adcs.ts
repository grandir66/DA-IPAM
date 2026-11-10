/**
 * ADCS certificate template heuristics (ESC1 / ESC2) — Phase 6.
 * Inspired by Certipy/BloodHound; Domarc rule IDs only.
 */

import type { Client } from "ldapts";
import { ldapStr, ldapStrArray } from "@/lib/ad/ldap-utils";

/** CT_FLAG_ENROLLEE_SUPPLIES_SUBJECT */
export const CT_ENROLLEE_SUPPLIES_SUBJECT = 0x00000001;
/** CT_FLAG_PEND_ALL_REQUESTS (manager approval) on msPKI-Enrollment-Flag */
export const CT_PEND_ALL_REQUESTS = 0x00000002;

export const EKU_CLIENT_AUTH = "1.3.6.1.5.5.7.3.2";
export const EKU_SMART_CARD_LOGON = "1.3.6.1.4.1.311.20.2.2";
export const EKU_ANY_PURPOSE = "2.5.29.37.0";

export interface AdcsTemplateRow {
  name: string;
  publishedBy?: string[] | null;
  distinguishedName: string;
  enrolleeSuppliesSubject: boolean;
  managerApproval: boolean;
  raSignatures: number;
  ekus: string[];
  esc1: boolean;
  esc2: boolean;
}

export interface AdcsExtras {
  status: "ok" | "unavailable";
  errorMessage?: string;
  templates: AdcsTemplateRow[];
  esc1Names: string[];
  esc2Names: string[];
}

function parseIntAttr(val: unknown): number {
  const s = ldapStr(val);
  if (s == null) return 0;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}

function collectEkus(entry: Record<string, unknown>): string[] {
  const fromExt = ldapStrArray(entry.pKIExtendedKeyUsage);
  const fromApp = ldapStrArray(entry["msPKI-Certificate-Application-Policy"]);
  return [...new Set([...fromExt, ...fromApp].map((s) => s.trim()).filter(Boolean))];
}

/**
 * Pure classifier for unit tests.
 */
export function classifyTemplate(input: {
  name: string;
  distinguishedName: string;
  nameFlags: number;
  enrollmentFlags: number;
  raSignatures: number;
  ekus: string[];
}): AdcsTemplateRow {
  const enrolleeSuppliesSubject =
    (input.nameFlags & CT_ENROLLEE_SUPPLIES_SUBJECT) !== 0;
  const managerApproval = (input.enrollmentFlags & CT_PEND_ALL_REQUESTS) !== 0;
  const ekus = input.ekus;
  const anyPurpose = ekus.length === 0 || ekus.includes(EKU_ANY_PURPOSE);
  const esc2 = anyPurpose && !managerApproval && input.raSignatures === 0;
  const authEku =
    anyPurpose ||
    ekus.includes(EKU_CLIENT_AUTH) ||
    ekus.includes(EKU_SMART_CARD_LOGON);
  const esc1 =
    enrolleeSuppliesSubject &&
    !managerApproval &&
    input.raSignatures === 0 &&
    authEku;

  return {
    name: input.name,
    distinguishedName: input.distinguishedName,
    enrolleeSuppliesSubject,
    managerApproval,
    raSignatures: input.raSignatures,
    ekus,
    esc1,
    esc2,
  };
}

export async function collectAdcsExtras(
  client: Client,
  configurationDn: string | null,
): Promise<AdcsExtras> {
  try {
    if (!configurationDn) throw new Error("Contesto Configuration di AD non disponibile");
    const pkiDn = `CN=Public Key Services,CN=Services,${configurationDn}`;
    const templatesDn = `CN=Certificate Templates,${pkiDn}`;
    const { searchEntries } = await client.search(templatesDn, {
      scope: "one",
      filter: "(objectClass=pKICertificateTemplate)",
      attributes: [
        "cn",
        "displayName",
        "distinguishedName",
        "msPKI-Certificate-Name-Flag",
        "msPKI-Enrollment-Flag",
        "msPKI-RA-Signature",
        "pKIExtendedKeyUsage",
        "msPKI-Certificate-Application-Policy",
      ],
      paged: { pageSize: 200 },
      timeLimit: 60,
    });

    const publication = new Map<string, Set<string>>();
    let publicationComplete = false;
    try {
      const { searchEntries: cas } = await client.search(`CN=Enrollment Services,${pkiDn}`, {
        scope: "one",
        filter: "(objectClass=pKIEnrollmentService)",
        attributes: ["cn", "certificateTemplates"],
        paged: { pageSize: 200 },
        timeLimit: 30,
      });
      publicationComplete = cas.length > 0;
      for (const ca of cas) {
        const name = ldapStr(ca.cn);
        if (!name || !Object.hasOwn(ca, "certificateTemplates")) {
          publicationComplete = false;
          continue;
        }
        for (const template of ldapStrArray(ca.certificateTemplates)) {
          const key = template.toLowerCase();
          const names = publication.get(key) ?? new Set<string>();
          names.add(name);
          publication.set(key, names);
        }
      }
    } catch {
      // La lettura dei template resta disponibile, la pubblicazione è ignota.
    }

    const templates: AdcsTemplateRow[] = [];
    for (const entry of searchEntries) {
      const dn = ldapStr(entry.distinguishedName);
      if (!dn) continue;
      const cn = ldapStr(entry.cn);
      const name = ldapStr(entry.displayName) ?? cn ?? dn;
      const names = cn ? publication.get(cn.toLowerCase()) : undefined;
      const publishedBy = names ? [...names].sort() : cn && publicationComplete ? [] : null;
      const template = classifyTemplate({
        name,
        distinguishedName: dn,
        nameFlags: parseIntAttr(entry["msPKI-Certificate-Name-Flag"]),
        enrollmentFlags: parseIntAttr(entry["msPKI-Enrollment-Flag"]),
        raSignatures: parseIntAttr(entry["msPKI-RA-Signature"]),
        ekus: collectEkus(entry as Record<string, unknown>),
      });
      templates.push({ ...template, publishedBy });
    }

    return {
      status: "ok",
      templates,
      esc1Names: templates.filter((t) => t.esc1 && t.publishedBy?.length !== 0).map((t) => t.name),
      esc2Names: templates.filter((t) => t.esc2 && t.publishedBy?.length !== 0).map((t) => t.name),
    };
  } catch (err) {
    return {
      status: "unavailable",
      errorMessage: err instanceof Error ? err.message : String(err),
      templates: [],
      esc1Names: [],
      esc2Names: [],
    };
  }
}

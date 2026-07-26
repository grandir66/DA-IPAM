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
  const esc2 = ekus.length === 0 || ekus.includes(EKU_ANY_PURPOSE);
  const authEku =
    esc2 ||
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
  baseDn: string,
): Promise<AdcsExtras> {
  try {
    const templatesDn = `CN=Certificate Templates,CN=Public Key Services,CN=Services,CN=Configuration,${baseDn}`;
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

    const templates: AdcsTemplateRow[] = [];
    for (const entry of searchEntries) {
      const dn = ldapStr(entry.distinguishedName);
      if (!dn) continue;
      const name =
        ldapStr(entry.displayName) ?? ldapStr(entry.cn) ?? dn;
      templates.push(
        classifyTemplate({
          name,
          distinguishedName: dn,
          nameFlags: parseIntAttr(entry["msPKI-Certificate-Name-Flag"]),
          enrollmentFlags: parseIntAttr(entry["msPKI-Enrollment-Flag"]),
          raSignatures: parseIntAttr(entry["msPKI-RA-Signature"]),
          ekus: collectEkus(entry as Record<string, unknown>),
        }),
      );
    }

    return {
      status: "ok",
      templates,
      esc1Names: templates.filter((t) => t.esc1).map((t) => t.name),
      esc2Names: templates.filter((t) => t.esc2).map((t) => t.name),
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

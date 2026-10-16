/**
 * BloodHound-style nTSecurityDescriptor collect (Owner+Group+DACL) with caps.
 */

import { Client } from "ldapts";
import { getAdIntegrationById } from "@/lib/db";
import { connectLdap } from "@/lib/ad/ad-client";
import { ldapStr } from "@/lib/ad/ldap-utils";
import { filterInterestingFromAces, rankInterestingAces } from "./interesting-ace";
import { sdFlagsControl } from "./sd-flags-control";
import { parseSecurityDescriptor } from "./security-descriptor";
import { sidToString } from "./sid";
import {
  ACL_INTERESTING_CAP,
  ACL_SD_CAP,
  ACL_TIMEOUT_MS,
  type AclCollectMeta,
  type AclExtras,
  type AclObjectKind,
  type InterestingAce,
  type SidPrincipal,
} from "./types";

function emptyMeta(partial: Partial<AclCollectMeta>): AclCollectMeta {
  return {
    status: "unavailable",
    objectsScanned: 0,
    sdParsed: 0,
    interestingAceCount: 0,
    truncated: false,
    timedOut: false,
    durationMs: 0,
    ...partial,
  };
}

function asBuffer(val: unknown): Buffer | null {
  if (Buffer.isBuffer(val)) return val;
  if (Array.isArray(val) && val.length > 0) return asBuffer(val[0]);
  if (val instanceof Uint8Array) return Buffer.from(val);
  return null;
}

function parseObjectSid(val: unknown): string | null {
  const buf = asBuffer(val);
  if (!buf) return null;
  try {
    return sidToString(buf);
  } catch {
    return null;
  }
}

interface WorkItem {
  dn: string;
  kind: AclObjectKind;
  sam: string | null;
  sid: string | null;
  sd: Buffer | null;
}

async function searchKind(
  client: Client,
  baseDn: string,
  kind: AclObjectKind,
  filter: string,
  scope: "base" | "one" | "sub",
  control: ReturnType<typeof sdFlagsControl>,
): Promise<WorkItem[]> {
  const { searchEntries } = await client.search(
    baseDn,
    {
      scope,
      filter,
      attributes: [
        "distinguishedName",
        "sAMAccountName",
        "objectSid",
        "nTSecurityDescriptor",
      ],
      explicitBufferAttributes: ["nTSecurityDescriptor", "objectSid"],
      paged: { pageSize: 300 },
      timeLimit: 60,
    },
    control,
  );

  const items: WorkItem[] = [];
  for (const entry of searchEntries) {
    const dnRaw = (entry as { dn?: unknown }).dn;
    const dn =
      (typeof dnRaw === "string" && dnRaw.length > 0 ? dnRaw : null) ??
      ldapStr(entry.distinguishedName);
    if (!dn) continue;
    items.push({
      dn,
      kind,
      sam: ldapStr(entry.sAMAccountName),
      sid: parseObjectSid(entry.objectSid),
      sd: asBuffer(entry.nTSecurityDescriptor),
    });
  }
  return items;
}

/**
 * Pure post-process: build interesting ACE list from work items (testable).
 */
export function processAclItems(
  items: WorkItem[],
  opts?: { domainSid?: string | null; interestingCap?: number; sdCap?: number },
): {
  interestingAces: InterestingAce[];
  domainSid: string | null;
  sdParsed: number;
  truncated: boolean;
  totalInteresting: number;
} {
  const sdCap = opts?.sdCap ?? ACL_SD_CAP;
  const interestingCap = opts?.interestingCap ?? ACL_INTERESTING_CAP;
  let domainSid = opts?.domainSid ?? null;
  const sidMap = new Map<string, SidPrincipal>();

  for (const it of items) {
    if (!it.sid) continue;
    sidMap.set(it.sid.toUpperCase(), {
      sid: it.sid,
      sam: it.sam,
      dn: it.dn,
      kind: it.kind,
    });
    if (it.kind === "domain" && !domainSid) domainSid = it.sid;
  }

  const interesting: InterestingAce[] = [];
  let sdParsed = 0;
  let truncated = items.length > sdCap;
  const slice = items.slice(0, sdCap);

  for (const it of slice) {
    if (!it.sd) continue;
    try {
      const parsed = parseSecurityDescriptor(it.sd);
      sdParsed += 1;
      const kept = filterInterestingFromAces({
        aces: parsed.aces,
        objectDn: it.dn,
        objectKind: it.kind,
        domainSid,
        sidMap,
      });
      for (const ace of kept) interesting.push(ace);
    } catch {
      // skip bad SD
    }
  }

  const ranked = rankInterestingAces(interesting);
  const totalInteresting = ranked.length;
  if (totalInteresting > interestingCap) truncated = true;
  return {
    interestingAces: ranked.slice(0, interestingCap),
    domainSid,
    sdParsed,
    truncated,
    totalInteresting,
  };
}

export async function collectAclExtras(integrationId: number): Promise<AclExtras> {
  const started = Date.now();
  const integration = getAdIntegrationById(integrationId);
  if (!integration) {
    return {
      meta: emptyMeta({
        status: "unavailable",
        errorMessage: "AD integration not found",
        durationMs: Date.now() - started,
      }),
      interestingAces: [],
      domainSid: null,
    };
  }

  let client: Client | null = null;
  const deadline = started + ACL_TIMEOUT_MS;
  const control = sdFlagsControl();

  try {
    client = await connectLdap(integration);
    const baseDn = integration.base_dn;
    const items: WorkItem[] = [];
    let timedOut = false;

    const push = (batch: WorkItem[]) => {
      for (const it of batch) {
        if (items.length >= ACL_SD_CAP) return;
        items.push(it);
      }
    };

    const steps: Array<() => Promise<void>> = [
      async () => {
        push(await searchKind(client!, baseDn, "domain", "(objectClass=*)", "base", control));
      },
      async () => {
        const ashDn = `CN=AdminSDHolder,CN=System,${baseDn}`;
        try {
          push(
            await searchKind(
              client!,
              ashDn,
              "adminsdholder",
              "(objectClass=*)",
              "base",
              control,
            ),
          );
        } catch {
          // AdminSDHolder path may vary — try System search
          try {
            const sys = `CN=System,${baseDn}`;
            const batch = await searchKind(
              client!,
              sys,
              "adminsdholder",
              "(cn=AdminSDHolder)",
              "one",
              control,
            );
            push(batch.map((b) => ({ ...b, kind: "adminsdholder" as const })));
          } catch {
            // skip
          }
        }
      },
      async () => {
        push(
          await searchKind(
            client!,
            baseDn,
            "ou",
            "(objectCategory=organizationalUnit)",
            "sub",
            control,
          ),
        );
      },
      async () => {
        push(
          await searchKind(
            client!,
            baseDn,
            "group",
            "(objectCategory=group)",
            "sub",
            control,
          ),
        );
      },
      // Users/computers last — often huge; skip if budget nearly spent.
      async () => {
        if (Date.now() > deadline - 20_000) {
          timedOut = true;
          return;
        }
        push(
          await searchKind(
            client!,
            baseDn,
            "user",
            "(&(objectClass=user)(objectCategory=person)(!(objectClass=computer)))",
            "sub",
            control,
          ),
        );
      },
      async () => {
        if (Date.now() > deadline - 15_000) {
          timedOut = true;
          return;
        }
        push(
          await searchKind(
            client!,
            baseDn,
            "computer",
            "(objectCategory=computer)",
            "sub",
            control,
          ),
        );
      },
    ];

    for (let i = 0; i < steps.length; i++) {
      if (Date.now() > deadline) {
        timedOut = true;
        break;
      }
      if (items.length >= ACL_SD_CAP) break;
      try {
        await steps[i]!();
      } catch (err) {
        // Domain base failure with nothing collected → unavailable
        if (items.length === 0 && i === 0) throw err;
      }
    }

    if (items.length === 0) {
      return {
        meta: emptyMeta({
          status: "unavailable",
          errorMessage: "No security descriptors returned (ACL unreadable)",
          timedOut,
          durationMs: Date.now() - started,
        }),
        interestingAces: [],
        domainSid: null,
      };
    }

    const processed = processAclItems(items, {
      interestingCap: ACL_INTERESTING_CAP,
      sdCap: ACL_SD_CAP,
    });

    const truncated =
      processed.truncated || timedOut || items.length >= ACL_SD_CAP;
    const status: AclCollectMeta["status"] = truncated || timedOut ? "partial" : "ok";

    return {
      meta: {
        status,
        objectsScanned: items.length,
        sdParsed: processed.sdParsed,
        interestingAceCount: processed.totalInteresting,
        truncated,
        timedOut,
        durationMs: Date.now() - started,
      },
      interestingAces: processed.interestingAces,
      domainSid: processed.domainSid,
    };
  } catch (err) {
    return {
      meta: emptyMeta({
        status: "unavailable",
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      }),
      interestingAces: [],
      domainSid: null,
    };
  } finally {
    try {
      await client?.unbind();
    } catch {
      // ignore
    }
  }
}

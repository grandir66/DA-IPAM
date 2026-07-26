/**
 * Nested group membership expansion + privilege matrix (LDAP member / primaryGroupID).
 */

import {
  matchPrivilegeDef,
  PRIVILEGED_GROUPS,
  type PrivilegeGroupDef,
  type PrivilegeGroupKey,
} from "./privileged-catalog";
import type { AdGroupRow, AdUserRow, PrivilegeMatrix, PrivilegeMembershipKind } from "./types";

const MAX_NEST_DEPTH = 5;
const MATRIX_USER_CAP = 500;

export interface MembershipHit {
  user: AdUserRow;
  kind: PrivilegeMembershipKind;
  /** Intermediate group sAMAccountNames from privileged group → user (empty if direct/primary). */
  path: string[];
  depth: number;
}

export interface PrivilegeExpansion {
  def: PrivilegeGroupDef;
  group: AdGroupRow | null;
  /** Distinct enabled users with any path. */
  enabledUsers: AdUserRow[];
  hits: MembershipHit[];
}

function groupByDn(groups: AdGroupRow[]): Map<string, AdGroupRow> {
  const m = new Map<string, AdGroupRow>();
  for (const g of groups) m.set(g.distinguishedName.toLowerCase(), g);
  return m;
}

function userByDn(users: AdUserRow[]): Map<string, AdUserRow> {
  const m = new Map<string, AdUserRow>();
  for (const u of users) m.set(u.distinguishedName.toLowerCase(), u);
  return m;
}

function findGroupForDef(groups: AdGroupRow[], def: PrivilegeGroupDef): AdGroupRow | null {
  for (const g of groups) {
    if (matchPrivilegeDef(g.samAccountName, g.distinguishedName)?.key === def.key) {
      return g;
    }
  }
  return null;
}

/**
 * Expand one privileged group: direct members, nested groups ≤ MAX_NEST_DEPTH,
 * plus users with matching primaryGroupID RID.
 */
export function expandPrivilegeGroup(
  def: PrivilegeGroupDef,
  groups: AdGroupRow[],
  users: AdUserRow[],
): PrivilegeExpansion {
  const group = findGroupForDef(groups, def);
  const groupsMap = groupByDn(groups);
  const usersMap = userByDn(users);
  const hitsByUser = new Map<string, MembershipHit>();

  const record = (hit: MembershipHit) => {
    const key = hit.user.distinguishedName.toLowerCase();
    const prev = hitsByUser.get(key);
    if (!prev) {
      hitsByUser.set(key, hit);
      return;
    }
    // Prefer stronger evidence: primary > direct > nested; then shallower depth.
    const rank = (k: PrivilegeMembershipKind) =>
      k === "primary" ? 0 : k === "direct" ? 1 : 2;
    if (rank(hit.kind) < rank(prev.kind) || (hit.kind === prev.kind && hit.depth < prev.depth)) {
      hitsByUser.set(key, hit);
    }
  };

  if (group) {
    type Q = { dn: string; depth: number; path: string[]; viaNested: boolean };
    const queue: Q[] = group.memberDns.map((dn) => ({
      dn,
      depth: 0,
      path: [],
      viaNested: false,
    }));
    const seenGroups = new Set<string>([group.distinguishedName.toLowerCase()]);

    while (queue.length > 0) {
      const item = queue.shift()!;
      const key = item.dn.toLowerCase();
      const user = usersMap.get(key);
      if (user) {
        record({
          user,
          kind: item.viaNested ? "nested" : "direct",
          path: item.path,
          depth: item.depth,
        });
        continue;
      }

      const nested = groupsMap.get(key);
      if (!nested) continue;
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
      if (item.depth >= MAX_NEST_DEPTH) continue;
      const nextPath = [...item.path, nested.samAccountName];
      for (const child of nested.memberDns) {
        queue.push({
          dn: child,
          depth: item.depth + 1,
          path: nextPath,
          viaNested: true,
        });
      }
    }
  }

  if (def.rid != null) {
    for (const u of users) {
      if (u.primaryGroupId !== def.rid) continue;
      record({ user: u, kind: "primary", path: [], depth: 0 });
    }
  }

  const hits = [...hitsByUser.values()];
  const enabledUsers = hits.filter((h) => h.user.enabled).map((h) => h.user);
  return { def, group, enabledUsers, hits };
}

export function expandAllPrivileges(
  groups: AdGroupRow[],
  users: AdUserRow[],
): Map<PrivilegeGroupKey, PrivilegeExpansion> {
  const out = new Map<PrivilegeGroupKey, PrivilegeExpansion>();
  for (const def of PRIVILEGED_GROUPS) {
    out.set(def.key, expandPrivilegeGroup(def, groups, users));
  }
  return out;
}

/** Users with nested (not direct/primary) path into Domain Admins. */
export function nestedIntoDomainAdmins(expansions: Map<PrivilegeGroupKey, PrivilegeExpansion>): MembershipHit[] {
  const exp = expansions.get("domain-admins");
  if (!exp) return [];
  return exp.hits.filter((h) => h.kind === "nested" && h.user.enabled);
}

/** Distinct enabled users with a path into any countsAsPrivilege group. */
export function privilegedUserSet(expansions: Map<PrivilegeGroupKey, PrivilegeExpansion>): AdUserRow[] {
  const byDn = new Map<string, AdUserRow>();
  for (const def of PRIVILEGED_GROUPS) {
    if (!def.countsAsPrivilege) continue;
    const exp = expansions.get(def.key);
    if (!exp) continue;
    for (const u of exp.enabledUsers) {
      byDn.set(u.distinguishedName.toLowerCase(), u);
    }
  }
  return [...byDn.values()];
}

export function buildPrivilegeMatrix(
  groups: AdGroupRow[],
  users: AdUserRow[],
  now: Date = new Date(),
): PrivilegeMatrix {
  const expansions = expandAllPrivileges(groups, users);
  const columnDefs = PRIVILEGED_GROUPS.filter((d) => d.matrixColumn);

  const userMap = new Map<
    string,
    {
      sam: string;
      dn: string;
      enabled: boolean;
      cells: Record<string, PrivilegeMembershipKind | null>;
      paths: Record<string, string[]>;
    }
  >();

  for (const def of columnDefs) {
    const exp = expansions.get(def.key);
    if (!exp) continue;
    for (const hit of exp.hits) {
      const key = hit.user.distinguishedName.toLowerCase();
      let row = userMap.get(key);
      if (!row) {
        row = {
          sam: hit.user.samAccountName,
          dn: hit.user.distinguishedName,
          enabled: hit.user.enabled,
          cells: Object.fromEntries(columnDefs.map((c) => [c.key, null])),
          paths: {},
        };
        userMap.set(key, row);
      }
      row.cells[def.key] = hit.kind;
      if (hit.path.length > 0) row.paths[def.key] = hit.path;
    }
  }

  const matrixUsers = [...userMap.values()]
    .sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.sam.localeCompare(b.sam);
    })
    .slice(0, MATRIX_USER_CAP);

  const matrixGroups = columnDefs.map((def) => {
    const exp = expansions.get(def.key);
    return {
      key: def.key,
      displayName: def.displayName,
      memberCount: exp?.enabledUsers.length ?? 0,
      found: exp?.group != null,
    };
  });

  return {
    groups: matrixGroups,
    users: matrixUsers.map((u) => ({
      sam: u.sam,
      dn: u.dn,
      enabled: u.enabled,
      cells: u.cells,
      ...(Object.keys(u.paths).length > 0 ? { paths: u.paths } : {}),
    })),
    generatedAt: now.toISOString(),
    truncated: userMap.size > MATRIX_USER_CAP,
  };
}

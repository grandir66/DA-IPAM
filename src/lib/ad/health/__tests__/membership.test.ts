import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrivilegeMatrix, expandPrivilegeGroup, nestedIntoDomainAdmins, expandAllPrivileges } from "../membership";
import { PRIVILEGED_GROUPS } from "../privileged-catalog";
import type { AdGroupRow, AdUserRow } from "../types";

function user(
  partial: Partial<AdUserRow> & Pick<AdUserRow, "samAccountName" | "distinguishedName">,
): AdUserRow {
  return {
    enabled: true,
    lastLogonAt: null,
    passwordLastSetAt: null,
    uac: 0,
    servicePrincipalNames: [],
    memberOfDns: [],
    primaryGroupId: null,
    adminCount: null,
    description: null,
    sidHistory: [],
    allowedToDelegateTo: [],
    ...partial,
  };
}

function group(
  partial: Partial<AdGroupRow> & Pick<AdGroupRow, "samAccountName" | "distinguishedName">,
): AdGroupRow {
  return { memberDns: [], ...partial };
}

test("expand Domain Admins: direct + nested + primary RID 512", () => {
  const da = group({
    samAccountName: "Domain Admins",
    distinguishedName: "CN=Domain Admins,CN=Users,DC=lab,DC=local",
    memberDns: [
      "CN=alice,CN=Users,DC=lab,DC=local",
      "CN=Helpdesk,CN=Users,DC=lab,DC=local",
    ],
  });
  const helpdesk = group({
    samAccountName: "Helpdesk",
    distinguishedName: "CN=Helpdesk,CN=Users,DC=lab,DC=local",
    memberDns: ["CN=bob,CN=Users,DC=lab,DC=local"],
  });
  const users = [
    user({ samAccountName: "alice", distinguishedName: "CN=alice,CN=Users,DC=lab,DC=local" }),
    user({ samAccountName: "bob", distinguishedName: "CN=bob,CN=Users,DC=lab,DC=local" }),
    user({
      samAccountName: "primaryda",
      distinguishedName: "CN=primaryda,CN=Users,DC=lab,DC=local",
      primaryGroupId: 512,
    }),
  ];
  const def = PRIVILEGED_GROUPS.find((d) => d.key === "domain-admins")!;
  const exp = expandPrivilegeGroup(def, [da, helpdesk], users);
  assert.equal(exp.enabledUsers.length, 3);
  const kinds = Object.fromEntries(
    exp.hits.map((h) => [h.user.samAccountName, h.kind]),
  );
  assert.equal(kinds.alice, "direct");
  assert.equal(kinds.bob, "nested");
  assert.equal(kinds.primaryda, "primary");
  const nested = nestedIntoDomainAdmins(expandAllPrivileges([da, helpdesk], users));
  assert.equal(nested.length, 1);
  assert.equal(nested[0]!.user.samAccountName, "bob");
  assert.deepEqual(nested[0]!.path, ["Helpdesk"]);
});

test("buildPrivilegeMatrix columns and cells", () => {
  const da = group({
    samAccountName: "Domain Admins",
    distinguishedName: "CN=Domain Admins,CN=Users,DC=lab,DC=local",
    memberDns: ["CN=alice,CN=Users,DC=lab,DC=local"],
  });
  const dns = group({
    samAccountName: "DnsAdmins",
    distinguishedName: "CN=DnsAdmins,CN=Users,DC=lab,DC=local",
    memberDns: ["CN=alice,CN=Users,DC=lab,DC=local"],
  });
  const users = [
    user({ samAccountName: "alice", distinguishedName: "CN=alice,CN=Users,DC=lab,DC=local" }),
  ];
  const matrix = buildPrivilegeMatrix([da, dns], users, new Date("2026-07-25T00:00:00.000Z"));
  assert.ok(matrix.groups.some((g) => g.key === "domain-admins" && g.memberCount === 1));
  assert.ok(matrix.groups.some((g) => g.key === "dns-admins" && g.memberCount === 1));
  assert.equal(matrix.users.length, 1);
  assert.equal(matrix.users[0]!.cells["domain-admins"], "direct");
  assert.equal(matrix.users[0]!.cells["dns-admins"], "direct");
  assert.equal(matrix.truncated, false);
});

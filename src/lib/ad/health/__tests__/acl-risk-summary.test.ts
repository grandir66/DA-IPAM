import { test } from "node:test";
import assert from "node:assert/strict";
import { primaryBucketId, summarizeAclRisk } from "../acl/risk-summary";
import type { InterestingAce } from "../acl/types";

function ace(
  partial: Partial<InterestingAce> &
    Pick<InterestingAce, "objectDn" | "trusteeSid" | "rights">,
): InterestingAce {
  return {
    objectKind: "user",
    trusteeSam: null,
    aceType: "allowed",
    inherited: false,
    ...partial,
  };
}

test("primaryBucketId prioritizes AdminSDHolder then DCSync then GenericAll", () => {
  assert.equal(
    primaryBucketId(
      ace({
        objectDn: "CN=AdminSDHolder,CN=System,DC=lab",
        objectKind: "adminsdholder",
        trusteeSid: "S-1-5-21-1-2-3-1000",
        rights: ["GenericAll"],
      }),
    ),
    "adminsdholder",
  );
  assert.equal(
    primaryBucketId(
      ace({
        objectDn: "DC=lab",
        objectKind: "domain",
        trusteeSid: "S-1-5-21-1-2-3-1000",
        rights: ["DCSync-GetChanges", "DCSync-GetChangesAll"],
      }),
    ),
    "dcsync",
  );
  assert.equal(
    primaryBucketId(
      ace({
        objectDn: "CN=alice,CN=Users,DC=lab",
        trusteeSid: "S-1-5-21-1-2-3-1000",
        rights: ["ForceChangePassword"],
      }),
    ),
    "password_reset",
  );
});

test("summarizeAclRisk groups by trustee and ranks buckets", () => {
  const aces: InterestingAce[] = [
    ace({
      objectDn: "DC=lab,DC=local",
      objectKind: "domain",
      trusteeSid: "S-1-5-21-1-2-3-5555",
      trusteeSam: "svc-backup",
      rights: ["DCSync-GetChanges", "DCSync-GetChangesAll"],
    }),
    ace({
      objectDn: "CN=alice,CN=Users,DC=lab,DC=local",
      trusteeSid: "S-1-5-21-1-2-3-5555",
      trusteeSam: "svc-backup",
      rights: ["GenericAll"],
    }),
    ace({
      objectDn: "CN=bob,CN=Users,DC=lab,DC=local",
      trusteeSid: "S-1-5-21-1-2-3-7777",
      trusteeSam: "helpdesk",
      rights: ["ForceChangePassword"],
    }),
  ];
  const s = summarizeAclRisk(aces);
  assert.equal(s.totalInteresting, 3);
  assert.equal(s.buckets[0]?.id, "dcsync");
  const full = s.buckets.find((b) => b.id === "full_control");
  assert.ok(full);
  assert.equal(full!.uniqueTrustees, 1);
  assert.equal(full!.entries[0]!.trusteeLabel, "svc-backup");
  const pwd = s.buckets.find((b) => b.id === "password_reset");
  assert.ok(pwd);
  assert.equal(pwd!.aceCount, 1);
});

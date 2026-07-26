import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeSdFlagsValue, sdFlagsControl } from "../acl/sd-flags-control";
import {
  buildAccessAllowedAce,
  buildAccessAllowedObjectAce,
  buildSecurityDescriptor,
  guidFromMsBytes,
  msBytesFromGuid,
  parseSecurityDescriptor,
} from "../acl/security-descriptor";
import { sidToString, stringToSid } from "../acl/sid";
import {
  GUID_DS_REPL_GET_CHANGES,
  GUID_DS_REPL_GET_CHANGES_ALL,
  MASK_GENERIC_ALL,
  classifyAceRights,
  filterInterestingFromAces,
  dcsyncPrincipals,
} from "../acl/interesting-ace";
import { processAclItems } from "../acl/acl-collect";

test("sid round-trip Domain Admins style", () => {
  const sid = "S-1-5-21-1-2-3-512";
  assert.equal(sidToString(stringToSid(sid)), sid);
});

test("SD_FLAGS BER value for flags=7", () => {
  assert.deepEqual(
    [...encodeSdFlagsValue(7)],
    [0x30, 0x03, 0x02, 0x01, 0x07],
  );
  const ctrl = sdFlagsControl(7);
  assert.equal(ctrl.type, "1.2.840.113556.1.4.801");
  assert.equal(ctrl.critical, true);
});

test("GUID microsoft byte order round-trip", () => {
  const g = GUID_DS_REPL_GET_CHANGES;
  assert.equal(guidFromMsBytes(msBytesFromGuid(g)), g);
});

test("parse SD with DCSync object ACEs + unexpected trustee", () => {
  const domainSid = "S-1-5-21-1-2-3-4";
  const daSid = "S-1-5-21-1-2-3-512";
  const evilSid = "S-1-5-21-1-2-3-1111";
  const maskControl = 0x00000100;
  const sd = buildSecurityDescriptor({
    ownerSid: daSid,
    aces: [
      buildAccessAllowedObjectAce({
        mask: maskControl,
        sid: daSid,
        objectTypeGuid: GUID_DS_REPL_GET_CHANGES,
      }),
      buildAccessAllowedObjectAce({
        mask: maskControl,
        sid: daSid,
        objectTypeGuid: GUID_DS_REPL_GET_CHANGES_ALL,
      }),
      buildAccessAllowedObjectAce({
        mask: maskControl,
        sid: evilSid,
        objectTypeGuid: GUID_DS_REPL_GET_CHANGES,
      }),
      buildAccessAllowedObjectAce({
        mask: maskControl,
        sid: evilSid,
        objectTypeGuid: GUID_DS_REPL_GET_CHANGES_ALL,
      }),
      buildAccessAllowedAce(MASK_GENERIC_ALL, evilSid),
    ],
  });
  const parsed = parseSecurityDescriptor(sd);
  assert.equal(parsed.ownerSid, daSid);
  assert.ok(parsed.aces.length >= 4);

  const interesting = filterInterestingFromAces({
    aces: parsed.aces,
    objectDn: "DC=lab,DC=local",
    objectKind: "domain",
    domainSid,
    sidMap: new Map([
      [
        evilSid.toUpperCase(),
        { sid: evilSid, sam: "evil", dn: "CN=evil,DC=lab", kind: "user" },
      ],
    ]),
  });
  // DA filtered out; evil kept
  assert.ok(interesting.every((a) => a.trusteeSid === evilSid));
  const dcsync = dcsyncPrincipals(interesting);
  assert.equal(dcsync.length, 1);
  assert.equal(dcsync[0]!.trusteeSam, "evil");
});

test("processAclItems respects interesting cap and parses SD", () => {
  const evilSid = "S-1-5-21-9-9-9-2000";
  const sd = buildSecurityDescriptor({
    ownerSid: "S-1-5-18",
    aces: [buildAccessAllowedAce(MASK_GENERIC_ALL, evilSid)],
  });
  const result = processAclItems(
    [
      {
        dn: "CN=u,DC=lab",
        kind: "user",
        sam: "u",
        sid: evilSid,
        sd,
      },
    ],
    { interestingCap: 10 },
  );
  assert.equal(result.sdParsed, 1);
  assert.ok(result.interestingAces.length >= 1);
  assert.ok(result.interestingAces[0]!.rights.includes("GenericAll"));
});

test("classifyAceRights GenericAll", () => {
  const rights = classifyAceRights({
    aceType: 0,
    aceFlags: 0,
    mask: MASK_GENERIC_ALL,
    sid: "S-1-5-21-1-2-3-1111",
    objectTypeGuid: null,
    inheritedObjectTypeGuid: null,
  });
  assert.deepEqual(rights, ["GenericAll"]);
});

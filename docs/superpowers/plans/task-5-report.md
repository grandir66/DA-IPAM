# Task 5 Report — LDAP extras + lastLogonTimestamp sync

**Status:** DONE · **Branch:** `feat/ad-health-native` · **SHA:** `43ce8d5`

## Delivered

- `src/lib/ad/ldap-utils.ts` — pure helpers (`ldapTimestampToIso`, `ldapStr`, `ldapStrArray`, `parseUac`, `isAccountEnabled`, DC RID)
- `src/lib/ad/ad-client.ts` — export `connectLdap`; users sync attrs + prefer `lastLogonTimestamp` over `lastLogon`
- `src/lib/ad/health/ldap-extras.ts` — `collectLdapExtras(integrationId)` (UAC/SPN/DC/trusts/krbtgt/guest/groups; Recycle Bin → `null` if fragile)
- `src/lib/ad/health/__tests__/ldap-utils.test.ts` — FILETIME + helper unit tests

## Tests

- ldap-utils 5/5; suite health 31/31

## Next

Task 6 — Engine + DomainScore finding.

# AD Health Phase 3 — Privilege matrix

**ENGINE_VERSION:** `0.3.0`  
**Branch:** `feat/ad-health-native`

## Delivered

| Area | Detail |
|---|---|
| Catalog | `privileged-catalog.ts` — DA/EA/Schema/Administrators/Operators/GPO/DnsAdmins/PU |
| Graph | `membership.ts` — nested ≤5 + `primaryGroupID` |
| Matrix | Persisted in `stats_json.privilegeMatrix`; returned by GET/POST healthcheck |
| Rules (+6) | Nested DA, Operators, DnsAdmins, GPO Creators, Empty PU, Large privileged set |
| UI | Health tab → Matrice privilegi (D/N/P cells, enabled filter) |
| Tests | 61/61 health suite |

## Backlog (LDAP ACL — Fase 4)

- Parse `nTSecurityDescriptor` for DCSync / AdminSDHolder ACE (requires binary SD decoder)
- SYSVOL / GPO cpassword (needs SMB, not LDAP-only)

# AD Health Phase 4 — ACL collect

**ENGINE_VERSION:** `0.4.0`  
**Branch:** `feat/ad-health-native`

## Delivered

| Area | Detail |
|---|---|
| Parser | `acl/security-descriptor.ts` + SID + SD_FLAGS control |
| Collect | BloodHound-like scopes, cap 15k / 120s, interesting ACE only |
| Rules (+4) | DCSync, AdminSDHolder, DangerousAcl, AclCollectPartial → **36** total |
| UI | Health → blocco ACL |
| Tests | **72/72** |

ACL collect is best-effort: failure → `unavailable` + `DA-A-AclCollectPartial`, run stays `ok`.

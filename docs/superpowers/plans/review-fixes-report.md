# AD Health — review fixes report

Worktree: `.worktrees/DA-IPAM-ad-health` (main checkout untouched).

1. **LDAP extras**: `collectLdapExtras` failure finishes the run as `error` (no empty-extras / false-ok path).
2. **KrbtgtAge**: `krbtgtPasswordLastSetAt == null` → no match (same as Recycle Bin).
3. **Domain Admins**: resolve includes `primaryGroupID=512`; ldap-extras collects `primaryGroupID` on users.
4. **Trust inventory**: exclude `trustAttributes & 0x20` (WITHIN_FOREST); empty after filter → no match.
5. **Stuck running**: `reclaimStaleRunningRuns` (>10m → error) before insert/conflict.

Tests: KrbtgtAge null; trust within-forest; `isStaleRunning` / reclaim; primaryGroupID=512. All 40 health unit tests pass.

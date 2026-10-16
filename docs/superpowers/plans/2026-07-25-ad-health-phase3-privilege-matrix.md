# AD Health Fase 3 — Matrice privilegi + membership nested (LDAP)

> Worktree only: `/Users/riccardo/Progetti/Domarc/.worktrees/DA-IPAM-ad-health`  
> Do NOT modify main checkout `DA-IPAM` on `dev`.

**Goal:** Massimizzare la visibilità dei privilegi via LDAP: espansione nested dei gruppi amministrativi, rule su gruppi popolati/annidati, e **matrice UI utenti × gruppi elevati**.

**Architecture:** Durante `runAdHealthcheck`, costruire un grafo membership (member + primaryGroupID) e produrre:
1. `PrivilegeMatrix` persistita (JSON su run o tabella dedicata)
2. Nuove rule `DA-P-*` / `DA-A-*` basate su quel grafo
3. Tab UI **Matrice** sotto Active Directory → Health

**Fuori scope Fase 3:** parsing completo `nTSecurityDescriptor` / DCSync ACE (Fase 4 — richiede decoder ACL). Documentare come backlog.

## Cosa si può acquisire via LDAP (ricerca)

| Dato | Attributi / tecnica | Uso Domarc |
|---|---|---|
| Membership diretta/nested | `member`, `memberOf`, `primaryGroupID` | Matrice + rule nested |
| Gruppi protetti | RID noti + CN Builtin | Catalogo privilegi |
| adminCount / AdminSDHolder remnant | `adminCount` | già + orphan |
| Deleghe | `msDS-AllowedToDelegateTo`, UAC bits, RBCD | già Fase 2 |
| SPN / roast | `servicePrincipalName`, UAC | già |
| Policy dominio | `minPwdLength`, lockout, `ms-DS-MachineAccountQuota` | già |
| Trusts | `trustedDomain` | già |
| ACL / DCSync rights | `nTSecurityDescriptor` (binary SDDL) | **Fase 4** |
| GPO / SYSVOL cpassword | LDAP + SMB SYSVOL | non solo LDAP |
| Sessioni / local admin | RPC/SMB non LDAP | fuori |

## Catalogo gruppi elevati (colonne matrice)

Well-known + common high-value:

- Domain Admins, Enterprise Admins, Schema Admins
- Administrators (Builtin)
- Account Operators, Backup Operators, Server Operators, Print Operators
- Group Policy Creator Owners
- DnsAdmins
- Domain Controllers (informativo)
- Protected Users (gap = non membership)

## Nuove rule

| ID | Points | Match |
|---|---|---|
| `DA-P-NestedIntoDomainAdmins` | 20 | ≥1 user/group non-DA che è nested member di Domain Admins (depth≥1 via gruppo intermedio) |
| `DA-P-OperatorsPopulated` | 25 | Account/Backup/Server/Print Operators con ≥1 member enabled |
| `DA-P-DnsAdminsPopulated` | 20 | DnsAdmins con ≥1 member (user/group) |
| `DA-P-EmptyProtectedUsers` | 10 | Protected Users vuoto mentre esistono Domain Admins enabled |
| `DA-P-GpoCreatorsPopulated` | 15 | Group Policy Creator Owners con membri oltre default attesi |
| `DA-A-LargePrivilegedSet` | 15 | Totale utenti distinct con path a qualsiasi gruppo privilegiato (escl. Protected Users / DC) > 15 |

## PrivilegeMatrix shape

```ts
interface PrivilegeMatrix {
  groups: Array<{ key: string; displayName: string; memberCount: number }>;
  users: Array<{
    sam: string;
    dn: string;
    enabled: boolean;
    cells: Record<string, "direct" | "nested" | "primary" | null>;
    // optional path for nested: paths[groupKey] = ["G1","G2"]
    paths?: Record<string, string[]>;
  }>;
  generatedAt: string;
}
```

Persist: colonna `privilege_matrix_json` su `ad_health_runs` (ALTER ADD).

API: includere in GET/POST healthcheck response come `privilegeMatrix`.

UI: tab/section Matrice — tabella scrollabile, badge direct/nested/primary, filtro solo enabled / solo con ≥1 privilegio.

## Tasks

### A — Membership graph + privileged catalog
### B — Matrix builder + persist + API
### C — New rules + tests
### D — UI Matrice
### E — ENGINE_VERSION 0.3.0, deploy note

Bump ENGINE_VERSION to `0.3.0`.

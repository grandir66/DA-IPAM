# AD Health Fase 4 — ACL collect stile BloodHound (analisi selettiva)

> Data: 2026-07-26 · Stato: **in review** · Branch: `feat/ad-health-native`  
> Worktree: `/Users/riccardo/Progetti/Domarc/.worktrees/DA-IPAM-ad-health`  
> Prerequisito: ENGINE 0.3.0 (privilege matrix) già su hub.

## 1. Problema e obiettivo

Le acquisizioni LDAP attuali coprono membership, UAC, deleghe, trusts e policy, ma **non** i security descriptor. Senza `nTSecurityDescriptor` mancano segnali critici: **DCSync**, abuso AdminSDHolder, GenericAll/WriteDacl su oggetti sensibili.

**Obiettivo:** acquisire ACL in stile BloodHound (domain + AdminSDHolder + OU + users + groups + computers) via LDAP read-only, **persistendo solo ACE interesting**, ed esporre nuove rule `DA-*` + blocco UI.

**Non-goal:**
- Salvare DACL complete in DB
- Parser SACL / auditing
- ADCS / GPO / SYSVOL / SMB
- Grafo BloodHound completo o Neo4j
- Dipendenze native Windows / Impacket Python

## 2. Decisioni

| # | Decisione | Scelta |
|---|---|---|
| D1 | Superficie oggetti | BloodHound-like: domain, AdminSDHolder, OU, user, group, computer |
| D2 | Strategia | Collect ampio + **filtro interesting ACE** (approccio 2) |
| D3 | LDAP control | `LDAP_SERVER_SD_FLAGS_OID` `1.2.840.113556.1.4.801`, flags **7** (Owner\|Group\|DACL), no SACL |
| D4 | Parser | TypeScript puro in-repo (`acl/security-descriptor.ts`), fixture-tested — no pacchetto GPL |
| D5 | Fallimento collect ACL | Best-effort: run health resta `ok`; finding `DA-A-AclCollectPartial` / skip rule ACL se `unavailable` |
| D6 | ENGINE | `0.4.0` |
| D7 | Persistenza | `stats_json.acl` = meta + `interestingAces[]` (cap sample) |
| D8 | Limiti | max **15 000** SD; timeout ACL **120s**; pageSize 200–500 |
| D9 | Rule ID | `DA-P-DCSyncRights`, `DA-A-AdminSDHolderAce`, `DA-P-DangerousAcl`, `DA-A-AclCollectPartial` |
| D10 | Home | Solo DA-IPAM; export hub invariato (`domarc-ad-health`) |

## 3. Architettura moduli

```
src/lib/ad/health/acl/
  sd-flags-control.ts      # BER encode flags=7 + ldapts Control
  security-descriptor.ts   # parse self-relative SD → owner + DACL ACEs
  sid.ts                   # SID binary ↔ string S-1-5-...
  interesting-ace.ts       # classify + filter
  acl-collect.ts           # LDAP paged searches + sid map
  well-known-sids.ts       # expected DCSync / AdminSDHolder trustees
```

Wiring:
1. `collectLdapExtras` (invariato per attributi esistenti)
2. `collectAclExtras(integrationId)` → `AclExtras`
3. `evaluateContext` riceve `acl` su `RuleContext`
4. Phase4 rules in `rules/phase4.ts`
5. UI Health: sezione ACL sotto matrice privilegi

## 4. Collect LDAP

### 4.1 Control

OID `1.2.840.113556.1.4.801`, critical, value BER:

`SEQUENCE { INTEGER flags }` → bytes `30 03 02 01 07` per flags=7.

Usare `ldapts` `Control` (terzo argomento di `client.search`).

### 4.2 Query set

| Scope | Filter | Attrs |
|---|---|---|
| domain base | `(objectClass=*)` scope base | `nTSecurityDescriptor`, `objectSid`, `distinguishedName` |
| AdminSDHolder | `(distinguishedName=CN=AdminSDHolder,CN=System,<base>)` o search System | idem |
| OU | `(objectCategory=organizationalUnit)` | + `name` |
| user | person user not computer | + `sAMAccountName`, `objectSid` |
| group | `(objectCategory=group)` | + `sAMAccountName`, `objectSid` |
| computer | `(objectCategory=computer)` | + `sAMAccountName`, `objectSid` |

Tutte: `explicitBufferAttributes: ['nTSecurityDescriptor']` (e `objectSid` se necessario come Buffer).

### 4.3 SID map

Durante collect: `Map<sidString, { sam?, dn, kind }>`. Trustee ACE risolti per findings/UI; se sconosciuto → lasciare SID raw.

### 4.4 Limiti e meta

```ts
interface AclCollectMeta {
  status: "ok" | "partial" | "unavailable";
  objectsScanned: number;
  sdParsed: number;
  interestingAceCount: number;
  truncated: boolean;
  timedOut: boolean;
  errorMessage?: string;
  durationMs: number;
}
```

## 5. Interesting ACE

### 5.1 Diritti / GUID

| Signal | Mask / ObjectType GUID |
|---|---|
| GenericAll | `0x10000000` |
| WriteDacl | `0x00040000` |
| WriteOwner | `0x00080000` |
| AllExtendedRights | `0x00000100` (ADS_RIGHT_DS_CONTROL_ACCESS senza object type, o generico) |
| DS-Replication-Get-Changes | `1131f6aa-9c07-11d1-f79f-00c04fc2dcd2` |
| DS-Replication-Get-Changes-All | `1131f6ad-9c07-11d1-f79f-00c04fc2dcd2` |
| ForceChangePassword | `00299570-246d-11d0-a768-00aa006e0529` |
| AddMember / Self-Membership | `bf9679c0-0de6-11d0-a285-00aa003049e2` (member) — opzionale se mask WriteProperty |

Solo ACE **ACCESS_ALLOWED** / **ACCESS_ALLOWED_OBJECT** (deny ignorati in Fase 4).

### 5.2 Expected trustees (non reportare come finding)

Su **domain** per DCSync / GenericAll: Domain Admins, Enterprise Admins, Administrators, Domain Controllers, Enterprise Domain Controllers, SYSTEM, e SID well-known equivalenti (RID 512/519/544/516/498/… + `S-1-5-18`).

Su **AdminSDHolder**: baseline tipica DA/EA/Administrators/SYSTEM; ogni altro allow ACE → interesting.

### 5.3 Shape persistita

```ts
interface InterestingAce {
  objectDn: string;
  objectKind: "domain" | "adminsdholder" | "ou" | "user" | "group" | "computer";
  trusteeSid: string;
  trusteeSam: string | null;
  rights: string[];           // e.g. ["DCSync-GetChanges","DCSync-GetChangesAll"]
  aceType: "allowed" | "allowed_object";
  inherited: boolean;
}
```

Cap persistenza: max **500** ACE interesting in `stats_json` (oltre → meta.truncated + count totale).

## 6. Rule pack

| ID | Axis | Points | Match |
|---|---|---|---|
| `DA-P-DCSyncRights` | privileged | 40 | Trustee non-expected con **entrambi** Get-Changes + Get-Changes-All sul domain, **oppure** GenericAll sul domain |
| `DA-A-AdminSDHolderAce` | anomaly | 35 | ≥1 interesting ACE su AdminSDHolder |
| `DA-P-DangerousAcl` | privileged | 20 | ≥1 interesting ACE su user/group/computer/OU (sample DN) |
| `DA-A-AclCollectPartial` | anomaly | 5 | `status === "partial"` o `truncated` o `timedOut` |

Se `status === "unavailable"`: nessuna delle rule DCSync/AdminSDHolder/DangerousAcl (niente “dominio pulito” senza evidenza ACL); emettere `DA-A-AclCollectPartial` con description “ACL unreadable / unavailable”.

## 7. UI

Nella tab Health, sotto Matrice privilegi:

- Badge stato collect ACL (`ok` / `partial` / `unavailable`)
- Contatori: SD scanned, interesting ACE, DCSync principals
- Tabella compatta top interesting ACE (object, trustee, rights) — max 50 righe

Nessun nuovo tab di primo livello.

## 8. Error handling

| Caso | Comportamento |
|---|---|
| Control rifiutato / attr assente | `unavailable`, log in stats |
| Timeout mid-page | `partial`, keep ACE già filtrati |
| Cap oggetti | `partial` + truncated |
| SD parse error su singolo oggetto | skip oggetto, continua |
| Fallimento sync/extras pre-ACL | invariato (run error come oggi) |

## 9. Testing

- Unit: BER control bytes; SID encode/decode; parse fixture SD con Object ACE DCSync; interesting filter expected vs unexpected.
- Rule: context con `acl.interestingAces` sintetici.
- Nessun test live contro DC in CI.

## 10. Rollout

1. Implementare nel worktree `feat/ad-health-native`
2. Test suite health
3. Deploy hub `192.168.4.8` (merge locale `dev` + build + restart) su richiesta
4. Non mergeare `origin/dev` finché non richiesto

## 11. Backlog esplicito (fuori Fase 4)

- Get-Changes-In-Filtered-Set come segnale soft
- Owner anomalo come rule dedicata
- Deep ACL on-demand (approccio 3) se domini >15k oggetti
- ACE deny / conditional ACE

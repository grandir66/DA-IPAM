# AD Health Fase 5 — LDAP pack + WinRM probes

> Stato: **approvato (procedi)** · ENGINE **0.5.0** · Branch `feat/ad-health-native`

## Obiettivo

Avvicinare PingCastle con (a) acquisizioni LDAP ancora mancanti e (b) probe WinRM/WMI sul DC quando `winrm_credential_id` è configurato.

## Decisioni

| # | Scelta |
|---|---|
| D1 | 5a LDAP + 5b WinRM nello stesso ENGINE 0.5.0 |
| D2 | WinRM best-effort: assente → skip; fallisce → `DA-A-WinrmProbeUnavailable` |
| D3 | Riuso `runWinrmCommand` (stesso canale DHCP) |
| D4 | No RiskId PingCastle; solo `DA-*` |

## Collect LDAP (5a)

- Computer: `pwdLastSet`, `msDS-isRODC` (o UAC PARTIAL_SECRETS_ACCOUNT)
- Users: UAC `ENCRYPTED_TEXT_PWD_ALLOWED` (già via uac map)
- GPO: `groupPolicyContainer` (displayName, gPCFileSysPath, flags)
- Sites/Subnets: Configuration NC
- gMSA count: `msDS-GroupManagedServiceAccount`
- Trusts: già `trustAttributes` → rule SID filtering

## Collect WinRM (5b)

- Hotfix: ultima installazione + presence check KB critici noti
- SYSVOL: search `cpassword` in Policies XML

## Rule nuove

| ID | Asse | Points |
|---|---|---|
| `DA-S-ReversiblePwd` | stale | 30 |
| `DA-S-DcPwdAge` | stale | 20 |
| `DA-T-SidFilteringOff` | trust | 25 |
| `DA-A-NoSitesSubnets` | anomaly | 10 |
| `DA-A-GpoOrphanPath` | anomaly | 10 |
| `DA-A-WinrmProbeUnavailable` | anomaly | 5 |
| `DA-A-DcPatchStale` | anomaly | 20 |
| `DA-A-SysvolCpassword` | anomaly | 40 |

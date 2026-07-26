# AD Health Fase 6 — WinRM hardening DC + ADCS/ESC

> Stato: **approvato (scelta C)** · ENGINE **0.6.0** · Branch `feat/ad-health-native`

## Obiettivo

Con credenziali admin + WinRM: acquisire hardening DC (registry/servizi) e template ADCS (ESC1/ESC2), più segnali LDAP PSO / shadow credentials.

## Collect

### WinRM (estensione probe esistente)
- `ldapServerIntegrity`, `ldapEnforceChannelBinding`
- SMB `RequireSecuritySignature` / `EnableSecuritySignature`
- `LmCompatibilityLevel`, WDigest `UseLogonCredential`
- Spooler service state

### LDAP
- Certificate templates in Configuration NC → ESC1/ESC2 heuristics
- Fine-grained PSO count (`msDS-PasswordSettings`)
- Users with `msDS-KeyCredentialLink` (shadow credentials)

## Rule nuove
`DA-A-LdapSigningOff`, `DA-A-LdapChannelBindingOff`, `DA-A-SmbSigningOff`, `DA-A-NtlmV1Allowed`, `DA-A-WdigestEnabled`, `DA-A-SpoolerOnDc`, `DA-A-AdcsEsc1`, `DA-A-AdcsEsc2`, `DA-A-ShadowCredentials`, `DA-A-NoPso` (soft)

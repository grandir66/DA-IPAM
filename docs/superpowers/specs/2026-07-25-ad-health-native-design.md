# AD Health nativo — puntatore

> Spec canonica (v3): runtime MVP = **DA-IPAM** (creds + acquire LDAP).
> Edge solo Fase 2 e solo se ha slot AD. Framing prodotto = assessment → hub.

→ [`DA-Vul-can/docs/superpowers/specs/2026-07-25-ad-health-edge-design.md`](../../../../DA-Vul-can/docs/superpowers/specs/2026-07-25-ad-health-edge-design.md)

(Il nome file `ad-health-edge` è storico; il contenuto v3 mette l’MVP su DA-IPAM.)

## Ruoli

| Componente | MVP |
|---|---|
| **DA-IPAM** | Credenziali, `ad_sync`/LDAP, rule engine, UI Run, export |
| **DA-Vul-can** | Ingest `domarc-ad-health` |
| **Scanner-Edge** | Non richiesto; opzionale dopo se `ad_configured` |

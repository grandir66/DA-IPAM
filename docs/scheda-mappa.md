---
badge: Linea principale
tono: ok
famiglia: 01-nucleo
ordine: 10
stato: cantiere
prossimo: confermare le pendenze di ../docs/pendenze-20260630.md: refactor F4 (FK host_id) e Patch Management CVE-driven
---
IPAM e inventario **multi-tenant** per le appliance cliente, e hub di nove
moduli security/network (edge, patch, LibreNMS, Graylog, Wazuh, MeshCentral,
NIS2…). Next.js App Router, un database SQLite per tenant più un hub.

nota: nessun framework di migrazioni — gli schemi si evolvono con `ALTER TABLE` idempotenti inline. Il push su `main` chiede sempre conferma esplicita.

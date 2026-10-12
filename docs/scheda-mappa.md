---
badge: Linea principale
tono: ok
famiglia: 01-nucleo
ordine: 10
stato: cantiere
prossimo: scegliere il primo blocco del piano dell'analisi di sistema del 2026-10-12 (CONTEXT §8): proposto filtri e viste
applicazione: ipam
---
IPAM e inventario per le appliance cliente (un'installazione = un cliente:
decisione di ottobre), e hub di nove moduli security/network (edge, patch,
LibreNMS, Graylog, Wazuh, MeshCentral, NIS2…). Next.js App Router, SQLite.

nota: nessun framework di migrazioni — gli schemi si evolvono con `ALTER TABLE` idempotenti inline. Il push su `main` chiede sempre conferma esplicita.

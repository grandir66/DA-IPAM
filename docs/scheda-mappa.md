---
badge: Linea principale
tono: ok
famiglia: 01-nucleo
ordine: 10
stato: cantiere
prossimo: "approvare le proposte d'interfaccia delle tappe 3-5 (docs/proposte/2026-10-21-tappe-3-5-interfaccia.md), poi scriverle; il primo avvio dell'immagine deve chiamare prepara-netbird.sh"
applicazione: ipam
---
IPAM e inventario per le appliance cliente (un'installazione = un cliente:
decisione di ottobre), e hub di nove moduli security/network (edge, patch,
LibreNMS, Graylog, Wazuh, MeshCentral, NIS2…). Next.js App Router, SQLite.

nota: nessun framework di migrazioni — gli schemi si evolvono con `ALTER TABLE` idempotenti inline. Il push su `main` chiede sempre conferma esplicita.

Trappola corrente: le righe MAC dei router vengono solo dalla bridge host (non dall'ARP) e i router si leggono con un job `arp_poll` senza rete, perché l'avvio dello scheduler spegne la scansione veloce sulle reti da /22 in su (ADR 0010).

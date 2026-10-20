---
badge: Linea principale
tono: ok
famiglia: 01-nucleo
ordine: 10
stato: cantiere
prossimo: "guardare sull'hub dashboard e Alert ridisegnate, poi blocco 1 dell'analisi (CONTEXT §8); pulizia host e verifica in due passaggi restano spente"
applicazione: ipam
---
IPAM e inventario per le appliance cliente (un'installazione = un cliente:
decisione di ottobre), e hub di nove moduli security/network (edge, patch,
LibreNMS, Graylog, Wazuh, MeshCentral, NIS2…). Next.js App Router, SQLite.

nota: nessun framework di migrazioni — gli schemi si evolvono con `ALTER TABLE` idempotenti inline. Il push su `main` chiede sempre conferma esplicita.

Trappola corrente: le righe MAC dei router vengono solo dalla bridge host (non dall'ARP) e i router si leggono con un job `arp_poll` senza rete, perché l'avvio dello scheduler spegne la scansione veloce sulle reti da /22 in su (ADR 0010).

---
badge: Linea principale
tono: ok
famiglia: 01-nucleo
ordine: 10
stato: cantiere
prossimo: "verifica in due passaggi pronta e spenta per tutti (ADR 0023): l'admin la chiede utente per utente; dashboard e Alert ridisegnate da guardare sull'hub coi grafici dell'indexer; job della pulizia host spento (accenderlo lo decide Riccardo); poi blocco 1 dell'analisi (CONTEXT §8): ordinamenti, filtri sulla pagina corrente, ricerche di AD; poi gli aperti della mappa topologica T3 (ADR 0020-0021)"
applicazione: ipam
---
IPAM e inventario per le appliance cliente (un'installazione = un cliente:
decisione di ottobre), e hub di nove moduli security/network (edge, patch,
LibreNMS, Graylog, Wazuh, MeshCentral, NIS2…). Next.js App Router, SQLite.

nota: nessun framework di migrazioni — gli schemi si evolvono con `ALTER TABLE` idempotenti inline. Il push su `main` chiede sempre conferma esplicita.

Trappola corrente: le righe MAC dei router vengono solo dalla bridge host (non dall'ARP) e i router si leggono con un job `arp_poll` senza rete, perché l'avvio dello scheduler spegne la scansione veloce sulle reti da /22 in su (ADR 0010).

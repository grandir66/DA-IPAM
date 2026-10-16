---
badge: Linea principale
tono: ok
famiglia: 01-nucleo
ordine: 10
stato: cantiere
prossimo: blocco 1 dell'analisi (CONTEXT §8): ordinamenti, filtri sulla sola pagina corrente, ricerche di Active Directory; mappa topologia T3 (mappa per cavo, ADR 0020) su dev dalla v0.3.308 e accesa il 16/10 su hub e cliente A; aperti: lldpd sui nodi 3-4 dell'hub, uscite MSTP di router 3 e router di riserva, unioni a mano (ADR 0021) dalla v0.3.311, il NAS dell'hub unito il 16/10; tappa 2 delle credenziali chiusa (v0.3.310, pulizia applicata)
applicazione: ipam
---
IPAM e inventario per le appliance cliente (un'installazione = un cliente:
decisione di ottobre), e hub di nove moduli security/network (edge, patch,
LibreNMS, Graylog, Wazuh, MeshCentral, NIS2…). Next.js App Router, SQLite.

nota: nessun framework di migrazioni — gli schemi si evolvono con `ALTER TABLE` idempotenti inline. Il push su `main` chiede sempre conferma esplicita.

Trappola corrente: le righe MAC dei router vengono solo dalla bridge host (non dall'ARP) e i router si leggono con un job `arp_poll` senza rete, perché l'avvio dello scheduler spegne la scansione veloce sulle reti da /22 in su (ADR 0010).

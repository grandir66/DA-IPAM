# Collector modulari: QNAP QSS

Approvato da Riccardo il 21/10/2026, controllo completo. Moduli TypeScript invocabili dalla CLI e da DA-IPAM, nessun database richiesto. Prima famiglia: switch QNAP QSS, non NAS QTS.

## Contratto
JSON schema_version 1, collector/version, target, collected_at, duration_ms, stato globale e sezioni identity, interfaces, vlans, forwarding, neighbors, spanning_tree, aggregation, poe, sensors, network (IPv4/ARP). Ogni sezione espone stato ok/partial/unsupported/error/skipped, dati tipizzati, fonti e avvisi con codici stabili. Null significa sconosciuto, array vuoti autorevoli solo a raccolta conclusa. Counter64 in stringa decimale, velocità in bit/s, tempo in secondi, VLAN e ifIndex numerici. Nessuna credenziale nel JSON.

## Architettura
Core senza Next/DB: schema Zod, registry, transport iniettabili, parser puri e collector qnap-switch. SNMP sessioni tramite protocols/snmp-sessione; SSH tramite ssh-transport esistente, console interattiva con timeout e paginazione. CLI accetta un file locale 0600 fuori dal repo, stdout solo JSON, exit 0 completo/2 parziale/1 errore/64 input. Adapter restituisce snapshot e mapping DeviceInfo senza scrivere.

## Sicurezza e limiti
Solo SNMP GET/GETNEXT/GETBULK e allowlist di comandi show: nessun SET, configure, clear, export configurazioni o reboot. Richieste e output limitati, timeout effettivi; sezione non supportata distinta da guasto. Niente raw output persistito di default. Fixture anonimizzate; IP e credenziali del banco solo fuori git. Nessun push/deploy: dev raggiunge appliance reali. API riservata come capability futura, non si inventano endpoint.

## Verifica
Fixture dei formati reali, timeout console, paginazione, dati parziali, Counter64, associazione bridge-port/ifIndex, maschere VLAN MSB, nessun segreto nel risultato, adapter senza DB. Lettura apparato autorizzato, confronto copertura e limiti; lint/typecheck/test mirati e controlli richiesti dal repo.

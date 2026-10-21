# Collector Comware — esecuzione in linea

Richiesto da Riccardo il 21/10/2026; stesso contratto/CLI del QNAP e ProCurve, controllo completo, nessun push/deploy. Riferimento ADR 0024 e manuale docs/modules/acquisition.md.

- [x] Identificazione: Comware 7 su IRF FlexFabric 5700; display in exec, campioni read-only acquisiti.
- [x] Trasporto exec per comando: allowlist display, una connessione per comando come il client Comware esistente, timeout/output limitati e batch interrotto su errore di trasporto; nessun fallback di credenziali.
- [x] Parser e collector: interfacce bridge/routed, nomi GE/XGE/FGE/BAGG, VLAN tagged/untagged, LLDP multiplo per porta, MAC con VLAN, LAG con selezione, STP per istanza, CPU/memoria per slot, sensori/ventole/PSU, dispositivi IRF ed ENTITY. Zod e registry hp-comware; nessun dato aggregato con max o somma impliciti.
- [x] Test su fixture anonime e trasporti finti, lettura reale con CLI, lint/typecheck/build; documentazione/checklist/commit locali.

Casi limite: output exec lungo e canale da chiudere su timeout; errore interrompe batch; 40G e patch complete; chassis LLDP non MAC e più neighbor-index; PoE globalmente disabilitato; Slot1 CPU/memoria non rappresenta l'intero IRF; SNMP/CLI ifName normalizzati senza derivare ifIndex dal nome.

Collaudo: 63 prove verdi, lint/typecheck/build verdi. Snapshot reale parziale per SNMP ifTable/ifXTable/ENTITY entro 15 s; aumento blocchi 10→50 non risolve. Resto delle sezioni letto; completamento SNMP esplicitamente aperto in TASKS/CONTEXT. Nessun push/deploy.

# Collector HP ProCurve / ArubaOS-Switch

Esecuzione in linea, richiesta da Riccardo il 21/10/2026 come seguito del collector QNAP; controllo completo, niente push/deploy.
Spec di base: ../specs/2026-10-21-collector-modulari-qnap-design.md e ADR 0024.

## Contratto e vincoli
Aggiungere collector hp-procurve all'input e allo snapshot senza cambiare le sezioni JSON 1.0. Stesso adapter e CLI, zero DB e automatismi. Solo comandi show in allowlist e SNMP in lettura. Operator non si promuove a manager. Credenziali e campioni reali solo nel vault. Distinguere ArubaOS-Switch/ProCurve da Comware e ArubaOS-CX.

## Task
- [x] 1. Campioni e parser: identità Aruba 2540, porte, VLAN, LAG, STP, LLDP, PoE; creare procurve-parsers.ts e __tests__/procurve.test.ts. Fixture anonime, porte disabilitate e velocità negoziata, intervalli e VLAN senza membership non inventata, milliwatt→watt.
- [x] 2. Profilo console e collector: estendere allowlist/prompt/pager di transports.ts conservando default QNAP; creare hp-procurve.ts, estendere schema.ts/index.ts. collectDevice mantiene firma, adapter senza DB. Test permessi, prompt ridisegnato con ANSI, banner press-key, errori parziali, famiglia errata e regressioni QNAP.
- [ ] 3. Collaudo e consegna: CLI sul banco autorizzato, output 0600 nel vault; test mirati, lint/typecheck/build; manuale, CHANGELOG, CONTEXT e checklist. Commit locali selettivi senza bump o pubblicazione in questa tappa.

## Casi limite
CLI con prompt > di operator; comandi invalidi senza percentuale; Counter64 preservati; ifIndex SNMP non dedotto dal numero della porta; nessuna VLAN untagged dedotta dal solo show vlans; rifiuto credenziali non ritentato automaticamente.

Estensione additiva del contratto 1.0: part_number/boot_rom opzionali in identity; sezioni resources (CPU/memoria) ed environment (stato ventole, budget PoE) opzionali. I JSON QNAP precedenti restano validi; nessun valore RPM inventato.

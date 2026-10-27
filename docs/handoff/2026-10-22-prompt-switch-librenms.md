# Prompt — difetti degli switch e LibreNMS (giro dopo v0.9.879)

Da incollare in una sessione nuova di Claude Code aperta su DA-IPAM.

---

Lavoriamo su DA-IPAM, ramo `dev` (un push su `dev` è un rilascio: `npm run version:release` prima del push). Leggi `CONTEXT.md`, poi in `TASKS.md` la sezione «2026-10-22 — difetti degli switch segnalati sulla sede 70151». Lì trovi le cause già trovate e le decisioni di Riccardo. Livello **leggero**: prove a fine tappa, cancello (`npx tsc --noEmit`, lint, `npm test` con `DA_INVENT_DATA_DIR` temporanea, letti dal codice di uscita) e una resa ≥1280 per l'interfaccia. Le interfacce nuove si propongono prima con una tavola grafica (non ASCII) e si aspetta l'ok. Spunta TASKS.md appena un punto è fatto.

Già fatto in v0.9.879 (non rifare): la walk SNMP riprova a blocchi più piccoli dopo un *tooBig*; il profilo HP si corregge dal sysDescr.

Da fare, in quest'ordine:

1. **Proposta di aggiunta switch/router: SSH principale + SNMP** (Riccardo 22/10: «somma le due acquisizioni; SSH principale se c'è ed è meglio»). Oggi `src/lib/devices/proposta-apparato.ts` (`protocolloPer`, `snmp = eSnmp(protocol) ? null : …`) con SNMP principale non propone mai l'SSH. Per switch e router con una credenziale SSH valida: `protocol` SSH e la credenziale SNMP accanto (binding). Gli apparati esistenti non si cambiano da soli.
2. **LibreNMS, aggiunta automatica estesa** (Riccardo 22/10: «a tutti gli oggetti SNMP verificati»). Oggi i candidati sono solo i vicini LLDP (`candidatiDaiVicini` in `src/lib/integrations/librenms-fonte.ts`, 5 per giro nel job `librenms_sync`). Candidati = tutti gli oggetti con SNMP verificato (binding riuscito), non ancora in LibreNMS, non rifiutati nelle ultime 24 h. Serve un'esclusione per oggetto «Non aggiungere a LibreNMS» (colonna o tabella nuova: migrazione col segno `_v21`, misurata su una copia), e l'esito visibile sulla pagina del modulo e sulla scheda. Regola che resta: senza SNMP non si aggiunge (`senza_snmp`, v0.9.878).
3. **LibreNMS, aggiunta in blocco dalla Discovery** (`src/app/(dashboard)/discovery/`): selezione multipla → «Aggiungi a LibreNMS», stessa rotta di una sola aggiunta, esito riga per riga (aggiunto / rifiutato col motivo). Prima la tavola.
4. **Matrice VLAN** (`src/components/scheda/matrice-vlan.tsx`): colonne e intestazione fisse, altezza limitata. Oggi la barra orizzontale sta in fondo a una tabella di ~2500 px, quindi le colonne sembrano tagliate. Resa a 1280 e 1920 con 24 VLAN e 50 porte.
5. **MikroTik CORE (sede 70151, 6 switch solo SNMP): 0 VLAN.** RouterOS non dà le VLAN del bridge via SNMP. La lettura SSH c'è già (sul router della stessa sede dà 26 VLAN di bridge): con il punto 1 basta dare a questi switch la credenziale SSH. Verificare che la lettura `switch_vlan` o la lettura MikroTik li copra e che la matrice li mostri.

Verifica sul dato vero: appliance 70151 = VM 104 sul Proxmox PX01 (`ssh root@172.20.40.191`, poi `qm guest exec 104 --pass-stdin 1 -- bash` con uno script letto da stdin). Il DB è `/opt/da-ipam/data/tenants/DEFAULT.db`, in sola lettura. Canale `dev` dal 22/10. L'appliance non ha un timer di aggiornamento: «Aggiorna ora» dall'interfaccia. Sono letture: ogni scrittura sull'appliance o sugli apparati del cliente chiede conferma a Riccardo. Mai credenziali a schermo o nel repo (repo pubblico: niente IP, MAC o nomi di clienti nei file).

A fine giro: CHANGELOG (il perché), TASKS, CONTEXT solo se cambia qualcosa, e un report a Riccardo in italiano semplice: fatto, come è verificato, aperto.

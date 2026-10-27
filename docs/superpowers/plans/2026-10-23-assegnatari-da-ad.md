# Piano — Assegnatari NIS2 da AD e utente prevalente dei PC

**Livello: leggero** (interfaccia + dati dell'app, niente dati di clienti scritti da fuori). Approvato da Riccardo
il 2026-10-23: strada, tavola grafica e soglia. Esecuzione in una sessione nuova.

- Tavola approvata: https://claude.ai/artifact/64gZcjsoZQmrcoXJkV6eFf (oggetti numerati 1-18, citati sotto come ①…)
- Idea e decisioni: `TASKS.md`, sezione «2026-10-23 — Assegnatari NIS2 da AD…»
- Stati: `[ ]` da fare · `[~]` in corso · `[x]` fatto (con la verifica accanto) · `[!]` bloccato · `[-]` annullato

## Decisioni (non riaprire)

- Solo **proposta con conferma**: nessun assegnatario si scrive da solo; un'assegnazione fatta a mano non si tocca mai.
- Soglia: si propone l'utente con **più della metà** degli accessi di persone al PC negli ultimi **30 giorni**.
- Solo AD locale (nessun cliente solo su Entra). Wazuh è una fonte dove è installato.
- Server, apparati di rete e PC segnati «condiviso» non ricevono proposte.

## Misura sul dato vero (hub .8, Wazuh del tenant 70791, 23/10, sola lettura)

Eventi 4624 in 30 giorni: 707.216 (regola 60106 quasi tutti). Tipi: rete (3) 696.837, alla tastiera (2) 1.427,
sblocco con credenziali in cache (11) 229, desktop remoto (10) 63.

- **Accessi alla tastiera/desktop remoto, dall'agente sul PC**: 11 PC → 10 proposte, 1 condiviso (8 utenti, 43%).
- **Accessi di rete visti da 15 agenti (server e DC)** per `workstationName`: 38 postazioni → 30 proposte,
  3 condivise (7, 22 e 23 utenti: server o terminali), 5 senza persone. **È la fonte più larga**: copre i PC
  senza agente e senza WinRM.
- Trappole viste: una postazione con 406.643 accessi di rete di un solo account (quasi certamente
  un'applicazione, non una persona); 9 delle 30 proposte di rete poggiano su meno di 5 accessi.
  Da qui due regole in più (punto 4): conta solo chi è una **persona in AD** (abilitata, nome e cognome),
  e sotto i **5 accessi** non si propone («pochi dati»). Riccardo può toglierle: sono parametri in Opzioni.

## Cosa c'è già (origin/dev `646fe741`)

`ad_users` (nome visualizzato, mail, reparto, ruolo, telefono, ultimo accesso) e `ad_computers.host_id`
(lo scrive `linkAdComputerToHost` nella sync AD e `relinkAdComputersForNetwork` dopo una scansione);
`wazuh_agent.host_id`; `lib/integrations/wazuh-indexer-api.ts` (client dell'indexer, `wazuh-alerts-stats.ts`
aggrega già `targetUserName`/`workstationName`/`ipAddress`); WinRM in `lib/devices/device-info.ts`
(`last_logged_on_user`, `logged_on_users` in `last_device_info_json`); GLPI in
`lib/inventory-agent/parse-glpi-inventory.ts` (`last_logged_user`); `asset_assignees` (nome, mail, telefono,
nota) e `inventory_assets.asset_assignee_id`; pagine `inventory/assignees/page.tsx` e `inventory/[id]/page.tsx`.

## Passi

1. [x] **Schema** (`db-tenant-schema.ts` + ALTER idempotenti, `db-tenant.ts`/`db.ts` allineati):
   - `asset_assignees`: `ad_integration_id`, `ad_object_guid` (UNIQUE con l'integrazione), `nome`, `cognome`,
     `reparto`, `ruolo`, `cellulare`, `origine` (`manuale`|`ad`), `ad_abilitato`, `ad_disattivato_il`;
   - `ad_users`: `given_name`, `surname`, `mobile`, `company`, `manager_dn`, `employee_id`, `office`;
   - tabella nuova `host_accessi_utente` (host_id, account normalizzato minuscolo senza dominio, fonte
     `wazuh_tastiera`|`wazuh_rete`|`winrm`|`glpi`, giorno, conteggio, ultimo) UNIQUE(host_id, account, fonte, giorno),
     pulizia a 90 giorni nello stesso job;
   - `inventory_assets.proposta_assegnatario_off` («PC condiviso, non proporre» ⑬).
   Fatto quando: prova che apre un DB vuoto e uno di prima e trova colonne e tabella.
2. [x] **AD** (`lib/ad/ad-client.ts`): leggere `givenName`, `sn`, `mobile`, `company`, `manager`, `employeeID`,
   `physicalDeliveryOfficeName`; dopo la sync, aggiornare gli assegnatari legati (dati e `ad_abilitato`;
   `ad_disattivato_il` la prima volta che risulta disattivato).
3. [x] **Raccolta degli accessi** — job nuovo `accessi_utenti_pc` nel catalogo (`lib/cron/jobs.ts`),
   **nasce spento** con interruttore in Opzioni, ogni ora:
   - Wazuh, accessi tipo 2/10/11 per `agent.name` → host via `wazuh_agent.host_id`;
   - Wazuh, accessi tipo 3 per `workstationName` (e `ipAddress`) → host per nome (hosts/`ad_computers`) o IP;
   - aggregazioni `size: 0` dal cursore dell'ultima ora, come nella misura (script in coda a questo piano);
   - WinRM e GLPI: una riga quando arriva l'inventario (in `device-info.ts` e nel parser GLPI, senza job).
   Fatto quando: prova con una risposta finta dell'indexer della forma VERA (bucket come nella misura).
4. [x] **Calcolo della proposta** — funzione pura `lib/assegnatari/proposta.ts`, tutta provata:
   esclude account di sistema (`DWM-`, `UMFD-`, `…$`, ANONYMOUS), amministrativi (gruppi privilegiati già noti a
   `lib/ad/health`, più il riconoscimento dal nome) e chi non è una persona abilitata in AD; finestra 30 gg;
   preferisce gli accessi alla tastiera se ce ne sono almeno 5, altrimenti quelli di rete; minimo 5 accessi;
   primo > 50% → proposta; altrimenti condiviso; categoria Server/rete o `proposta_assegnatario_off` → niente.
   Esiti: `proposta` | `condiviso` | `pochi_dati` | `nessuna_fonte` | `esclusa`. Le soglie (50%, 5, 30 gg)
   sono parametri in Opzioni.
5. [x] **API** (ognuna `withTenantFromSession`, `requireAuth` in lettura e `requireAdmin` in scrittura, Zod):
   - `GET /api/asset-assignees/import-ad` — anteprima con esito per utente (nuovo, già presente con il dato che
     cambia, da controllare: manca cognome o mail / omonimo; esclusi col motivo), paginata;
   - `POST /api/asset-assignees/import-ad` — importa i selezionati in una transazione, legame per guid, doppioni
     per guid poi per mail; **non tocca gli asset**;
   - `GET /api/inventory/[id]/assegnatario-proposto` — esito, persona, conteggi per fonte, tabella degli accessi;
   - `POST …/assegnatario-proposto` con `accetta` | `condiviso` (scrive solo dopo il clic).
6. [x] **Interfaccia**, come la tavola:
   - `inventory/assignees/page.tsx`: pulsante ① accanto a «Nuovo assegnatario», avviso degli usciti ②,
     filtro origine ③, colonne nuove ④;
   - pagina nuova `inventory/assignees/import-ad`: filtri ⑤, contatori ⑥, tabella con spunte ⑦,
     «PC dove si collega» ⑧, esito ⑨, esclusi in un pannello ⑩, riepilogo e «Importa N utenti» ⑪;
   - `inventory/[id]/page.tsx`, riquadro Assegnatario: proposta ⑫ con i tre pulsanti ⑬, tabella degli accessi ⑭,
     casi ⑮ (assegnato a mano, si collega un altro: avviso grigio), ⑯ condiviso, ⑰ nessuna fonte con link a WinRM,
     ⑱ assegnatario disattivato in AD.
   Badge con segno (✓ ▲ ● ✕), testo ≥ 13 px, `fetchJson` + `LoadError`, `parseDbDate`, `FUSO_UTENTI`.
7. [x] **Cancello**: `npm run lint && npx tsc --noEmit && npm test && npm run build` (esito dal codice di uscita).
8. [x] **Rilascio sul dev**: `npm run version:release`, push su `dev` (arriva anche all'appliance del cliente A:
   il job è spento, le pagine sono solo lettura finché nessuno importa). Sull'hub .8: accendere il job,
   importare da AD, guardare a 1440 le tre pagine coi dati veri e confrontare i numeri con la misura
   (attesi ~10 proposte da tastiera, ~30 postazioni di rete prima dei filtri sulle persone).
9. [x] **Documenti**: CHANGELOG (il perché), CONTEXT §6 una riga con le trappole (fonte di rete larga ma con
   account di applicazione; job spento di serie), TASKS spuntato, `docs/scheda-mappa.md` se cambia il prossimo passo.

## Script della misura

Lo script usato il 23/10 (sola lettura, stampa solo conteggi) è ricostruibile dalle due query del punto 3:
aggregazione per `agent.name` sui tipi 2/10/11 e per `workstationName` sul tipo 3, con `terms` su
`targetUserName`. Si lancia sull'hub con `cd /opt/da-invent && set -a && . ./.env.local && set +a && npx tsx <file>`
e `withTenant("70791", …)`: i tre tenant dell'hub puntano allo stesso Wazuh.

## Consuntivo (23/10, eseguito nella sessione nuova)

- **Fatto**: passi 1-9; v0.9.892-894 sull'hub .8; giro acceso per 70791; verifica a 1440 coi dati veri (elenco,
  importazione, schede PC-MIARI, PC-APADULA, PC-Soragni). Dettaglio e numeri in `TASKS.md`.
- **Scostamenti**: il giro è un timer di `server.ts` con levetta in Opzioni, non un tipo di `scheduled_jobs` (CHECK);
  WinRM si legge dal giro, GLPI all'ingresso; l'host dell'asset si prende anche dall'apparato (32 asset su 34).
- **Mancante**: «Accetta» col clic sull'hub (utente di prova in sola lettura); WinRM a 0 righe su 70791 da capire.
- **Consigli**: legare all'host i 3 agenti Wazuh e le 18 postazioni senza host; valutare il ritmo del giro dopo una
  settimana (le finestre orarie costano 2 query all'indexer per istanza).

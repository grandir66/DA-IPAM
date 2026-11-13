# DATIA MONITORING — la pagina del cliente sui dati di Zabbix, e l'inserimento degli oggetti da DA-IPAM

> Piano del 13/11/2026 (Riccardo). Stato: **in attesa di approvazione**. Storia e misure: `TASKS.md`,
> sezione «2026-11-13 — DATIA MONITORING». Tocca due repo: DA-IPAM (questo) e DA-Zabbix
> (`/Users/riccardo/Progetti/DA-Zabbix`, ramo `revisione/20260830`, live `192.168.4.15`).

## Cosa si vuole

1. Il cliente vede lo stato dei suoi apparati dalla vista cliente di DA-IPAM, senza entrare in Zabbix.
   Sei famiglie: apparati di rete, firewall, Windows, Linux, Proxmox, storage e NAS (più i certificati dei siti).
2. L'amministratore mette un oggetto in monitoraggio dalla scheda di DA-IPAM. Per Windows e Linux
   riceve lo script dell'agente. **L'installazione è sempre manuale** (decisione del 13/11).

## Decisioni già prese (13/11)

- Asse della pagina: le famiglie, non i «servizi». I servizi restano un'idea per dopo.
- Il riassunto per famiglia lo calcola DA-Zabbix; DA-IPAM lo mostra soltanto.
- Il cliente vede i problemi da «Media» in su; «preso in carico» diventa «Domarc ci sta lavorando».
- «Non so» è uno stato a sé, visibile al cliente, con l'ultimo valore noto.
- Niente installazione di agenti via WinRM o Chocolatey.

## Decisioni da prendere (proposta fra parentesi)

- D1. La chiave che scrive: una chiave **separata** da quella di lettura (`zs1.…`), emessa da DA-Link
  come quella di lettura, legata a un solo codice cliente, che può solo creare oggetti (mai cancellare
  né modificare), con un tetto di oggetti al giorno. (Proposta: sì.)
- D2. UPS e schede di gestione (iLO, iDRAC): settima famiglia «Alimentazione e hardware». (Proposta: sì.)
  Access point dentro «Apparati di rete»; stampanti, telefoni e IoT fuori dalla pagina.
- D3. Certificati dei siti: un riquadro a parte nella pagina. (Proposta: sì.)
- D4. Storico a 30 giorni: dai problemi chiusi di Zabbix, non da un campionamento di DA-IPAM. (Proposta: sì.)

## Tappe

Ogni tappa si chiude da sola e si può rilasciare senza la successiva. Tutto nasce spento.

### Tappa A — DA-Zabbix: rotta di lettura per famiglia (zona gialla)

- [ ] A1. `zbximport/famiglie.py` (nuovo): tipologia → famiglia; per famiglia l'elenco delle misure
  ammesse, scritte come regole sulle chiavi dei modelli veri (vfs.fs, net.if, service, volumi Synology
  e QNAP, nodi e macchine Proxmox, VPN e alta affidabilità Stormshield). Puro, con prove su dati della
  forma vera presi dalla misura del 13/11 (DTS e Domarc).
- [ ] A2. `leggi_famiglie` in `zbximport/lettura_clienti.py`: usa `SoloLettura` e il token del cliente
  come le altre letture; per ogni oggetto dà stato, misure della sua famiglia, `vecchio`, `dati_affidabili`.
  Un oggetto con misure configurate e nessun dato si dice («configurato, senza dati»): è il caso dei
  2 Proxmox di DTS e del Windows con MSSQL di Domarc.
- [ ] A3. Rotta `GET /api/lettura/v1/famiglie` in `web/app.py`, aggiunta a `_APERTE_ESATTE`, prova con
  `pytest.mark.auth_reale`. Stessa cache e stessa testa (`codcli`, `eta_s`, `vecchio`) delle altre quattro.
- [ ] A4. Rotta `GET /api/lettura/v1/storico`: problemi chiusi degli ultimi 30 giorni, per famiglia e per giorno.
- [ ] A5. Aggiornare `docs/2026-10-16-api-lettura-per-cliente-design.md` (§3) e `CHANGELOG.md`.
- Verifica: prove mirate; poi sul live la rotta chiamata dal di fuori con la chiave di lettura di DTS.

### Tappa B — DA-IPAM: la pagina DATIA MONITORING (zona verde)

- [ ] B1. `src/lib/zabbix-lettura/api.ts`: schemi di `famiglie` e `storico`; `client.ts` e `servizio.ts`:
  lettura con la cache e l'attesa crescente che ci sono già.
- [ ] B2. `src/lib/cliente/monitoring.ts` (nuovo, puro): frase della fascia, stato della famiglia
  (il peggiore fra i suoi oggetti), soglia «Media», frasi dei problemi in italiano da cliente
  (sul modello di `src/lib/cliente/frasi-avvisi.ts`), regola del «non so».
- [ ] B3. Rotta `GET /api/cliente/monitoring` con `withTenantFromSession`, in sola lettura.
- [ ] B4. Pagina `/cliente/monitoring` e voce di menu, visibili solo con integrazione acquistata,
  configurata e accesa (`pannelloNelMenu`). Gli oggetti della tavola del 13/11: fascia, famiglie,
  problemi aperti, scheda della famiglia a colonne separate, ultimi 30 giorni. Stati per forma e luminanza.
- [ ] B5. Riquadro «Monitoring» nella casa del cliente (`RIQUADRI_CASA`): la fascia e le famiglie in piccolo.
- Verifica: prove mirate sui file puri; una schermata a 1920 sull'hub col tenant di Domarc.

### Tappa C — inserimento degli oggetti (zona rossa: è una chiave che scrive)

- [ ] C1. DA-Zabbix: chiave di scrittura (D1), emissione e revoca da DA-Link sul modello di
  `/api/dalink/chiave-lettura`. Prova vista fallire: chiave di lettura rifiutata, chiave di un altro
  cliente rifiutata, tetto giornaliero rispettato.
- [ ] C2. DA-Zabbix: `POST /api/scrittura/v1/oggetto`. Riceve indirizzo, nome, tipo, sistema, se c'è
  SNMP; passa da `mapping.py` (la regola che c'è già) e risponde con una di tre cose: inserito,
  serve l'agente (con lo script di `comando_linux` o `comando_windows`), fuori perimetro (col motivo).
  Modo `prova` a vuoto, come le rotte di DA-Link. Mai cancellazioni.
- [ ] C3. DA-IPAM: configurazione della chiave di scrittura accanto a quella di lettura
  (`src/lib/zabbix-lettura/config.ts`, cifrata a riposo, mai mostrata).
- [ ] C4. DA-IPAM: sulla scheda dell'oggetto, accanto ad «Abbina», «Metti in monitoraggio»; finestra con
  l'esito, e per Windows e Linux lo script con «Copia» e «Scarica». Stato «in attesa dell'agente»
  finché l'oggetto non compare nella lettura, poi abbinamento da solo.
- [ ] C5. DA-IPAM: pagina per inserirne molti insieme (solo amministratore), prima a vuoto con l'elenco
  di cosa succederebbe a ogni oggetto, poi la conferma.
- Verifica: sul live, su DTS e Domarc (Riccardo, 13/11: «abbiamo tutti i diritti per farlo»): prima a
  vuoto, poi un oggetto vero per tipo (uno SNMP, un Windows, un Linux).

## Livello di controllo

Leggero per A e B (prove mirate, una schermata). Completo per C (chiave che scrive nel Zabbix centrale):
prova vista fallire, prova a vuoto, snapshot della VM 107 su DA-PX-01 prima del rilascio di C1-C2.

## Rilasci

- DA-Zabbix: `bash scripts/deploy.sh --applica` verso `192.168.4.15` a fine tappa A e a fine C2.
- DA-IPAM: `dev` a ogni tappa; `main` solo con il sì di Riccardo, dopo il cancello completo.

## Rischi

- Le regole sulle chiavi (A1) dipendono dai modelli: un modello nuovo non riconosciuto non deve
  sparire, deve comparire come «misure non classificate».
- Un cliente che vede troppo chiama: la soglia «Media» e la frase sulla presa in carico vanno provate
  sui problemi veri di Domarc prima di mostrarle a un cliente.
- I backup di Proxmox, le repliche dei NAS e la licenza del firewall non sono in Zabbix: restano fuori
  finché non c'è una fonte (Proxreporter per i backup).

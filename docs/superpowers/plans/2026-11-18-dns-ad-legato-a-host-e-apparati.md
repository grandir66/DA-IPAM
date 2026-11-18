# DNS di Active Directory legato alle modifiche di host e apparati — piano di esecuzione

> Si esegue in linea, un passo alla volta. Le caselle tengono il conto.

**Obiettivo:** quando in DA-IPAM si cambia nome o IP di un host o di un apparato, lo si elimina o lo si sposta di subnet, DA-IPAM dice com'è messo nel DNS di Active Directory e propone la correzione; nelle tabelle di subnet e apparati un segno dice se il nome nel DNS c'è, manca o è diverso.
**Architettura:** niente strada nuova verso il DC. Si riusa quella delle correzioni (`src/lib/ad/dns/`: anteprima, gettone, convalida, registro, annulla). Di nuovo ci sono solo: una lettura «com'è messo questo IP nel DNS», due richieste di correzione legate a un IP (ricostruite sul server dall'id, come `nuova.ts`), e i punti dell'interfaccia che le mostrano.
**Spec:** nessuna a parte. Richiesta di Riccardo in `TASKS.md`, sezione «2026-11-17 — Idea: DNS di Active Directory», riga del 18/11. Piani precedenti: `2026-11-17-dns-active-directory-sola-lettura.md`, `2026-11-17-dns-active-directory-correzioni.md`.
**Livello di controllo:** leggero per lettura e interfaccia; **completo** per il passo T2 (nasce un modo nuovo di chiedere una scrittura sul DC del cliente: prove viste fallire).
**Stato:** proposto, in attesa dell'approvazione di Riccardo · **Ultimo aggiornamento:** 2026-11-18

## Richiesta di Riccardo (18/11/2026)

«sarebbe bello integrarlo con le modifiche delle voci di subnet e apparati».

## Vincoli globali

- **Mai niente da solo.** Salvare, eliminare o spostare un host non scrive mai sul DC: fa comparire un avviso con un pulsante. La scrittura parte solo dall'anteprima confermata, come oggi.
- **Una strada sola verso il DC**: `eseguiCorrezioni`. Nessuna rotta nuova che scrive; le richieste nuove sono id (`host:…`) che `correzioniScelte` ricostruisce sul server e fa passare da `convalidaPasso`.
- **Salvare un host non deve rallentare né fallire per colpa del DNS**: lo stato DNS si chiede dopo, con una chiamata a parte; se non risponde, l'host è salvato lo stesso e l'avviso non compare.
- **Solo dall'archivio.** Lo stato DNS di un host si legge dai record già in archivio (`ad_dns_record`), non dal DC: nessuna chiamata WinRM o LDAP per mostrare un segno. Accanto si scrive quando è stato letto.
- **Spente restano spente.** Dove le correzioni non sono accese (`dns_scrittura = 0`) si vede lo stato e basta, senza pulsanti. Dove non c'è un'integrazione AD col DNS letto, non si vede niente.
- **Chi vede cosa**: lo stato lo vede chi può leggere (`requireAuth`); l'avviso con il pulsante solo l'amministratore.
- **Daltonismo**: i tre stati del segno si distinguono per forma (✓ · ∅ · ≠), non per colore.
- I controller di dominio restano intoccabili, come oggi.

## Scelte che propongo (Riccardo le cambia se non vanno)

1. **Quale nome vale**: quello che DA-IPAM usa già nel confronto delle anomalie (`hosts.hostname`). Il nome scritto a mano sull'host non entra in questa versione.
2. **Eliminazione o spostamento di più host insieme**: un solo avviso riassuntivo («7 degli host eliminati hanno ancora voci nel DNS») con il collegamento alla scheda «DNS» già filtrata, non una finestra per host.
3. **Voci segnate «è voluto»**: non generano avvisi né segni di errore.
4. **Cambio di IP**: si propone «aggiungi il nome sul nuovo IP, togli il vecchio» come una correzione sola; se il vecchio IP è ora di un altro host, il «togli» non si propone.
5. **Dove compare il segno**: tabella degli host nella pagina di una subnet e scheda dell'host; per gli apparati, nella scheda dell'apparato (non nell'elenco, in questa versione).

## Casi da non dimenticare

1. L'host è eliminato: l'IP non c'è più in DA-IPAM, ma l'avviso deve sapere quali record aveva. Lo stato si prende **prima** dell'eliminazione, nella finestra di conferma. Passo T3.
2. Due integrazioni AD nello stesso cliente: si guarda quella la cui zona contiene il nome o il cui reverse copre l'IP; se sono due, si mostrano tutte e due. Passo T1.
3. L'archivio del DNS è vecchio (ultima lettura fallita): il segno si mostra con l'ora della lettura, e l'anteprima rilegge comunque dal DC prima di scrivere. Passo T1.
4. L'host cambia IP e il vecchio IP è già di un altro host: non si propone di togliere niente dal vecchio. Passo T2.
5. Il nome nuovo non è un nome DNS («sala riunioni»): nessuna proposta, e l'avviso dice perché. Passo T2.

## I passi

| ID | Stato | Passo | Agente | Dipende da | Fatto quando | Verifica |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | [ ] | Stato DNS di un IP e di una subnet | in linea | — | per un IP: record, anomalie, stato (c'è · manca · diverso), ora della lettura; per una subnet: lo stato di tutti gli IP in una chiamata | prove del modulo |
| T2 | [ ] | Richieste di correzione legate a un host | in linea | T1 | `host:allinea:<ip>` e `host:togli:<ip>` ricostruite sul server, convalidate, con i casi 4 e 5 | prove viste fallire, anche fino al DC finto |
| T3 | [ ] | Scheda dell'host: riquadro «DNS» e avvisi dopo salva ed elimina | in linea | T2 | il riquadro mostra lo stato; dopo un cambio di nome o IP e nella conferma di eliminazione compare «Aggiorna il DNS…» | una schermata a 1920 |
| T4 | [ ] | Scheda dell'apparato: stesso riquadro e stessi avvisi | in linea | T3 | cambiando nome o indirizzo dell'apparato compare lo stesso avviso | `tsc`, lint |
| T5 | [ ] | Segno nella tabella degli host di una subnet; avviso riassuntivo per eliminazioni e spostamenti di gruppo | in linea | T1 | colonna col segno, e un avviso solo per le azioni su più host | una schermata a 1920 |
| T6 | [ ] | Prova su 192.168.4.8 con un host di prova, documenti, rilascio su dev | in linea | T3-T5 | host di prova rinominato, spostato di IP ed eliminato, col DNS aggiornato dall'avviso e tornato com'era | elenco qui sotto |

T4 e T5 non hanno file in comune e non dipendono l'uno dall'altro.

---

### [ ] T1 — Stato DNS di un IP e di una subnet

File: `src/lib/ad/dns/per-host.ts` (nuovo, funzioni pure sopra `vistaDnsAd`), `src/app/api/hosts/[id]/dns/route.ts` (GET, `requireAuth`), `src/app/api/networks/[id]/dns/route.ts` (GET, mappa `ip → stato`).
`statoDnsDi(ip, nome)` → `{ stato: "ok" | "manca" | "diverso" | "nessun_dns", record, anomalie (con le correzioni già calcolate), lettoIl, correzioniAccese, integrazione }`. Per la subnet una sola passata sulla vista, non una per host (regola N+1).

### [ ] T2 — Richieste di correzione legate a un host

File: `src/lib/ad/dns/per-host.ts`, `src/lib/ad/dns/vista.ts` (`correzioniScelte` riconosce il prefisso `host:`), prove in `__tests__/per-host.test.ts` e in `esecuzione.test.ts`.
- `host:allinea:<ip>`: porta il DNS al nome che DA-IPAM ha per quell'IP. Riusa le proposte esistenti (`nome_diverso`, `host_senza_nome`, `a_senza_ptr`); se l'host ha un IP precedente con il suo stesso nome nel DNS, aggiunge i «togli» del vecchio (caso 4).
- `host:togli:<ip>`: toglie i record A e PTR di quell'IP (reverse prima, come da trappola del 18/11). Serve dopo un'eliminazione.
Come per `nuova.ts`: dal browser arriva solo l'id, i passi si rifanno sul server dai dati di adesso.

### [ ] T3 — Scheda dell'host

File: componente nuovo `src/components/shared/dns-di-host.tsx` (riquadro e avviso, riusa `ConfermaCorrezioni`), aggancio nella scheda dell'host e nella sua finestra di eliminazione. Dopo `PUT /api/hosts/[id]` riuscito con nome o IP cambiati si richiede lo stato e, se non è «ok», compare l'avviso. Nella conferma di eliminazione lo stato si chiede prima (caso 1) e, a eliminazione fatta, l'avviso offre «Togli le voci dal DNS…».

### [ ] T4 — Scheda dell'apparato

File: scheda dell'apparato (aggancio dello stesso componente; l'IP è `devices.host`). Nessun codice nuovo sul server.

### [ ] T5 — Tabella della subnet e azioni di gruppo

File: `src/app/(dashboard)/networks/[id]/network-detail-client.tsx` (colonna col segno, dati da `GET /api/networks/[id]/dns`), avviso riassuntivo dopo `hosts/bulk` e `hosts/bulk-update` con collegamento alla scheda «DNS» filtrata.

### [ ] T6 — Prova, documenti, rilascio

Su 192.168.4.8 (correzioni accese su Domarc), con un host di prova fuori dagli IP in uso:
- [ ] rinomina → avviso → anteprima → applicato; `dig` verso il DC dà il nome nuovo
- [ ] cambio di IP → il nome segue, il vecchio reverse sparisce
- [ ] eliminazione → «Togli le voci dal DNS…» → il DNS torna al numero di record di partenza
- [ ] ogni scrittura ha la sua riga nel registro
Poi `CHANGELOG.md`, `CONTEXT.md`, `TASKS.md`, rilascio su `dev`. `main` resta di Riccardo.

## Consuntivo

(a fine piano)

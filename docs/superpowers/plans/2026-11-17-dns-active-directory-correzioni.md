# DNS di Active Directory, passo 2: correzioni dal DA-IPAM — piano di esecuzione

> Si esegue in linea, un passo alla volta, con una revisione del ramo alla fine. Le caselle tengono il conto.

**Obiettivo:** dalla scheda «DNS» di Active Directory si correggono i record degli host (A, CNAME, PTR) sul DC, una o più voci insieme, sempre dopo una conferma che mostra il prima e il dopo.
**Architettura:** ogni correzione è un elenco ordinato di passi elementari, solo due: «aggiungi questo record» e «togli questo record esatto». I passi diventano comandi DNS di Windows lanciati via WinRM sul DC. Prima di scrivere si rilegge dal DC il record che si sta per toccare; se non è più quello mostrato, ci si ferma. Ogni scrittura lascia il record di prima in un registro, da cui si può annullare.
**Spec:** nessuna a parte. Decisioni di Riccardo in `TASKS.md`, sezione «2026-11-17 — Idea: DNS di Active Directory». Passo 1 chiuso: `2026-11-17-dns-active-directory-sola-lettura.md`.
**Livello di controllo:** completo (zona rossa: si scrive su un apparato del cliente).
**Stato:** bozza · **Ultimo aggiornamento:** 2026-11-17

## Decisioni di Riccardo (17/11/2026)

- Si scrive **via WinRM, con richiesta di conferma**.
- **Utenza**: «per Domarc usiamo quella memorizzata, per la configurazione generale prevediamone una dedicata».
- **Le voci statiche si correggono**, con conferma.
- **Correzioni della prima versione**: creare il reverse mancante, togliere i record di troppo, cambiare nome o IP, creare il nome mancante.
- **Conferma anche su più voci insieme**, su un elenco col prima e il dopo di ciascuna.
- Solo i record degli host: mai record di dominio.

## Vincoli globali

- **Spento di serie.** La scrittura si accende integrazione per integrazione (`ad_integrations.dns_scrittura`, 0 di serie). Spenta, la scheda resta com'è oggi e le rotte di scrittura rispondono 403.
- **Utenza.** `ad_integrations.dns_credential_id`: una voce Windows dedicata (gruppi `DnsAdmins` e `Remote Management Users`). Se manca, si scrive con la voce WinRM del DC **solo** se `dns_usa_winrm_dc = 1`, messo a mano da un amministratore: è il caso di Domarc. Né l'una né l'altro: niente scrittura, e la scheda dice cosa manca. Mai l'account LDAP come ripiego.
- **Due sole operazioni sul DC**: `Add-DnsServerResourceRecord` e `Remove-DnsServerResourceRecord` con `-RecordData` esatto e `-Force`. Un cambio è «aggiungi il nuovo, poi togli il vecchio»: se il secondo fallisce resta un doppione, mai un buco.
- **Mai fuori dai record degli host**: rifiutati i tipi diversi da A, CNAME, PTR; i nomi `@`, quelli che cominciano con `_` o contengono `._`; le zone `_msdcs*`, `RootDNSServers`, `..TrustAnchors`; ogni zona che non è nell'archivio di quell'integrazione. AAAA si legge ma non si corregge in questa versione.
- **Mai i record dei server di dominio**: rifiutato ogni passo il cui nome o IP è quello di un DC (il `dc_host` dell'integrazione e i computer di AD che sono controller di dominio).
- **Niente testo libero nei comandi.** Nomi, zone e IP passano da una convalida stretta (etichette DNS `[a-z0-9-]`, IPv4 a quattro ottetti, zona presa dall'archivio) e finiscono nel comando come letterali PowerShell fra apici singoli. Un valore che non passa la convalida fa rifiutare il passo, non lo si «pulisce».
- **Rilettura prima di scrivere**: per ogni passo «togli» e per ogni «aggiungi» si interroga il DC (`Get-DnsServerResourceRecord`) subito prima; se il record da togliere non c'è più o è diverso, o quello da aggiungere esiste già, il passo si ferma con «è cambiato, rileggi».
- **Registro prima dell'azione**: la riga con chi, quando, il record di prima per intero (tipo, dato, TTL, statico o data del rinnovo) e il passo si scrive in `ad_dns_modifiche` e nel file `audit/dns-ad-AAAA-MM-GG.jsonl` **prima** del comando. Se il registro non si scrive, il comando non parte.
- **Conferma legata all'anteprima**: l'anteprima dà un gettone che vale 5 minuti e copre esattamente quei passi; «applica» senza gettone, con un gettone scaduto o con passi diversi è rifiutato. Al massimo 50 correzioni per conferma.
- **Solo l'amministratore** (`requireAdmin`) e solo dentro `withTenantFromSession`.
- **Niente nomi di host, IP o password nei log del servizio**; nel registro delle modifiche nomi e IP ci stanno, è il suo scopo.
- **Tre esiti per ogni comando remoto**: riuscito, rifiutato dal DC, non so (rete, tempo scaduto). «Non so» non è «riuscito»: si rilegge il record e si scrive quello che si trova.
- Nessun automatismo: nessuna correzione parte da un job, mai.

## Casi da non dimenticare

1. Il record è cambiato fra l'anteprima e la conferma (un PC ha rinnovato il suo): il passo si ferma. Passo S3.
2. Un nome con un apice o un punto e virgola dentro: rifiutato dalla convalida, il comando non si compone. Passo S2.
3. Il comando parte ma la risposta non arriva: si rilegge e si registra lo stato vero. Passo S3.
4. Di dieci correzioni confermate, la quarta fallisce: le prime tre restano fatte e registrate, la quarta è segnata fallita, le altre sei si fanno lo stesso (sono indipendenti). Passo S3.
5. Si annulla una correzione il cui record era dinamico: torna come statico, e la finestra lo dice prima. Passo S3.

## I passi

| ID | Stato | Passo | Agente | Dipende da | Fatto quando | Verifica |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | [ ] | Correzioni proposte per ogni anomalia | in linea | — | ogni tipo di anomalia ha le sue proposte, o «nessuna» motivata | prove del modulo, viste fallire |
| S2 | [ ] | Comandi DNS di Windows e convalida | in linea | — | i due comandi e la rilettura si compongono solo da valori convalidati | prove con valori ostili, viste fallire |
| S3 | [ ] | Esecuzione, registro, annulla | in linea | S1, S2 | un piano confermato si esegue passo per passo con rilettura, registro e tre esiti | prove con un DC finto, viste fallire |
| S4 | [ ] | Rotte e impostazioni dell'integrazione | in linea | S3 | anteprima, applica, annulla, registro; interruttore e utenza | prove delle rotte; `tsc` e lint |
| S5 | [ ] | Interfaccia nella scheda «DNS» | in linea | S4 | comandi, selezione, finestra di conferma, registro | schermata a 1920 e a larghezza da portatile |
| S6 | [ ] | Prova sul dato vero (Domarc, 70791) | in linea, con Riccardo | S5 | record di prova creato, cambiato e tolto dal DA-IPAM e visto dal di fuori | elenco qui sotto |
| S7 | [ ] | Revisione del ramo, documenti, rilascio su dev | revisore (1 subagent) + in linea | S6 | rilievi chiusi, `CHANGELOG`/`CONTEXT`/scheda-mappa, consuntivo | cancello completo |

S1 e S2 non hanno file in comune e potrebbero andare in parallelo; sono piccoli, li faccio di seguito.

---

### [ ] S1 — Correzioni proposte per ogni anomalia

**File:** crea `src/lib/ad/dns/correzioni.ts`, `src/lib/ad/dns/__tests__/correzioni.test.ts`.

```ts
export interface PassoDns { azione: "aggiungi" | "togli"; zona: string; nome: string; tipo: "A" | "CNAME" | "PTR"; dato: string }
export interface Correzione {
  id: string;            // stabile: `${chiaveAnomalia}#${variante}`
  chiaveAnomalia: string;
  titolo: string;        // «Crea il reverse verso pc-01.esempio.local»
  passi: PassoDns[];     // nell'ordine di esecuzione: prima gli «aggiungi», poi i «togli»
  toglieDati: boolean;   // true se almeno un passo è «togli»
}
export function correzioniPer(anomalia: AnomaliaDns, contesto: { zone: ZonaDns[]; voci: VoceDns[]; host: HostPerDns[]; dominio: string }): Correzione[];
```

**Proposte per tipo:**

| Anomalia | Correzioni proposte |
| --- | --- |
| Nome senza reverse | crea il PTR verso il nome (una proposta per nome, se sono più d'uno) |
| Reverse senza nome | togli il PTR |
| Reverse con un altro nome | cambia il PTR nel nome dell'A (aggiungi il nuovo, togli il vecchio) |
| Stesso IP, più reverse | togli un PTR (una proposta per ciascuno) |
| Stesso IP, più nomi | togli un A (una proposta per ciascuno); il PTR che puntava a quello tolto segue |
| Stesso nome, più IP | togli un A (una proposta per IP) |
| Alias verso un nome che non esiste | togli il CNAME |
| Nome diverso da DA-IPAM | rinomina: aggiungi A e PTR col nome di DA-IPAM, togli quelli vecchi |
| Host spento da tempo | togli A e PTR |
| IP che DA-IPAM non conosce | togli A e PTR |
| Host acceso senza nome in DNS | crea A nella zona del dominio, e il PTR se la zona reverse esiste |
| Manca la zona reverse | nessuna: creare una zona è un'altra cosa, resta segnalata |

**Verifica:** `node --import tsx --test src/lib/ad/dns/__tests__/correzioni.test.ts`: un caso per riga della tabella; ordine dei passi nei cambi; nessuna proposta per i record di un DC. Ogni prova vista fallire una volta togliendo la regola che prova.

### [ ] S2 — Comandi DNS di Windows e convalida

**File:** crea `src/lib/ad/dns/comandi.ts`, `src/lib/ad/dns/__tests__/comandi.test.ts`.

```ts
export type EsitoConvalida = { ok: true } | { ok: false; motivo: string };
export function convalidaPasso(p: PassoDns, ammesse: { zone: ReadonlySet<string>; nomiDc: ReadonlySet<string>; ipDc: ReadonlySet<string> }): EsitoConvalida;
export function comandoLeggi(zona: string, nome: string, tipo: PassoDns["tipo"]): string;   // Get-DnsServerResourceRecord … | ConvertTo-Json con i campi appiattiti
export function comandoPasso(p: PassoDns): string;                                           // Add-… oppure Remove-… -RecordData … -Force
export interface RecordSulDc { tipo: PassoDns["tipo"]; dato: string; ttl: number; statica: boolean; rinnovataIl: string | null }
export function leggiRisposta(json: string): RecordSulDc[];                                  // un oggetto solo, un array, vuoto, testo non JSON
```

I comandi escono in JSON con le proprietà appiattite lato PowerShell (`Select-Object` con proprietà calcolate): `ConvertTo-Json` serializza gli indirizzi come oggetti annidati, trappola già vista sul DHCP.

**Verifica:** `node --import tsx --test src/lib/ad/dns/__tests__/comandi.test.ts`: nome con apice, con `;`, con `$(`, con spazio, con `..`; zona non in archivio; nome o IP di un DC; tipo SRV; `@` e `_ldap._tcp`: tutti rifiutati. I comandi buoni confrontati carattere per carattere. `leggiRisposta` con le quattro forme. Ogni rifiuto visto passare una volta togliendo il controllo.

### [ ] S3 — Esecuzione, registro, annulla

**File:** crea `src/lib/ad/dns/esecuzione.ts`, `src/lib/ad/dns/registro.ts`, `src/lib/ad/dns/accesso.ts`, prove in `__tests__/esecuzione.test.ts`; modifica `src/lib/db-tenant-schema.ts` e `src/lib/db-tenant.ts`.

**Schema** (colonne con `ALTER` guardato da `pragma_table_info`; indici su ogni chiave esterna):

```sql
ALTER TABLE ad_integrations ADD COLUMN dns_scrittura INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ad_integrations ADD COLUMN dns_usa_winrm_dc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ad_integrations ADD COLUMN dns_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ad_integrations_dns_cred ON ad_integrations(dns_credential_id);

CREATE TABLE IF NOT EXISTS ad_dns_modifiche (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES ad_integrations(id) ON DELETE CASCADE,
  gruppo TEXT NOT NULL,            -- una conferma = un gruppo
  correzione TEXT NOT NULL,        -- id e titolo della correzione
  azione TEXT NOT NULL CHECK(azione IN ('aggiungi','togli')),
  zona TEXT NOT NULL, nome TEXT NOT NULL, tipo TEXT NOT NULL, dato TEXT NOT NULL,
  prima TEXT,                      -- JSON del record com'era sul DC (per «togli»); NULL per «aggiungi»
  esito TEXT NOT NULL CHECK(esito IN ('in_corso','riuscito','rifiutato','cambiato','non_so')),
  messaggio TEXT,
  annulla_di INTEGER REFERENCES ad_dns_modifiche(id) ON DELETE SET NULL,
  da TEXT NOT NULL, il TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ad_dns_modifiche_integrazione ON ad_dns_modifiche(integration_id, il);
CREATE INDEX IF NOT EXISTS idx_ad_dns_modifiche_annulla ON ad_dns_modifiche(annulla_di);
```

`ad_dns_modifiche` entra in `transfer/table-registry.ts`. Trigger che rifiutano `DELETE` e, a esito scritto, `UPDATE` delle righe: il registro non si riscrive.

**Interfacce:**

```ts
export type AccessoDns = { ok: true; fonte: "dedicata" | "winrm_dc"; nome: string; username: string; password: string; port: number } | { ok: false; motivo: string };
export function accessoDnsDi(integrazione: AdIntegration): AccessoDns;
export interface EsitoPasso { passo: PassoDns; esito: "riuscito" | "rifiutato" | "cambiato" | "non_so"; messaggio: string | null; modificaId: number }
export async function eseguiCorrezioni(integrazione: AdIntegration, correzioni: Correzione[], da: string, esegui?: typeof runWinrmCommand): Promise<{ gruppo: string; esiti: EsitoPasso[] }>;
export async function annullaModifica(integrazione: AdIntegration, modificaId: number, da: string, esegui?: typeof runWinrmCommand): Promise<EsitoPasso>;
```

Per ogni passo, nell'ordine: convalida → rilettura dal DC → riga `in_corso` nel registro e nel file JSONL → comando → rilettura → esito definitivo. Una correzione si ferma al suo primo passo non riuscito; le altre correzioni del gruppo proseguono. A fine gruppo, `syncAdDns` rilegge tutto il DNS.

**Verifica:** `esecuzione.test.ts` con un `runWinrmCommand` finto che tiene un piccolo DNS in memoria: correzione riuscita; record cambiato prima della scrittura; comando che lancia `BRIDGE_TIMEOUT` e record poi presente (esito «riuscito» dalla rilettura) o assente («non so»); registro non scrivibile → nessun comando partito; annulla di un «togli» che ricrea il record; scrittura spenta → rifiuto senza toccare il DC. Ogni prova vista fallire.

### [ ] S4 — Rotte e impostazioni dell'integrazione

**File:** crea `src/app/api/ad/[id]/dns/correzioni/route.ts` (POST anteprima), `…/correzioni/applica/route.ts` (POST), `…/modifiche/route.ts` (GET registro paginato), `…/modifiche/[modificaId]/annulla/route.ts` (POST); modifica `src/app/api/ad/[id]/route.ts` (i tre campi nuovi in PUT, con Zod) e `src/lib/ad/dns/vista.ts` (porta `scrittura: { accesa, fonte, motivo }` e, per ogni anomalia, le correzioni proposte).

Il gettone dell'anteprima è un HMAC di integrazione, utente, scadenza e passi, con la chiave di sessione del servizio: niente stato in memoria.

**Verifica:** prove delle rotte (403 a scrittura spenta e per chi non è amministratore, 400 a gettone scaduto o passi diversi); `npx tsc --noEmit -p .` e lint sui file toccati.

### [ ] S5 — Interfaccia nella scheda «DNS»

**File:** modifica `src/app/(dashboard)/active-directory/scheda-dns.tsx` e il modulo di modifica dell'integrazione in `page.tsx`; crea `conferma-correzioni.tsx`, `registro-dns.tsx`.

**Oggetti, da approvare prima di scriverli:**
1. **Riga di stato**: accanto a «sola lettura» compare «correzioni accese, con l'utenza …» oppure perché sono spente.
2. **Nell'elenco delle anomalie**: una casella per riga e, per riga, il comando «Correggi…». Se le correzioni possibili sono più d'una (quale nome togliere), si sceglie lì. Le anomalie senza correzione non hanno casella.
3. **Barra della selezione**: «N voci scelte · Correggi…».
4. **Finestra di conferma**: una riga per record toccato, con «prima» e «dopo» affiancati; i record che vengono tolti hanno un segno e un'etichetta propri, non solo un colore; in fondo il conteggio («3 record creati, 2 tolti») e il pulsante «Applica sul DC». Chiude da sola dopo 5 minuti.
5. **Esito**: per ogni passo riuscito, rifiutato, cambiato o «non so», col messaggio del DC.
6. **Registro delle modifiche**: pannello a comparsa con chi, quando, cosa, esito e «Annulla» sulle modifiche riuscite.
7. **Nell'integrazione**: interruttore «Correzioni del DNS», scelta della voce dedicata, e la casella «usa la voce WinRM del DC» con l'avviso che è un amministratore.

**Verifica:** schermata a 1920 e a 1366 della scheda, della finestra di conferma e del registro, in locale con un DC finto.

### [ ] S6 — Prova sul dato vero (Domarc, 70791, da 192.168.4.8)

Con Riccardo presente. Nel resoconto: ora, utenza usata, record toccati.

1. Copia di sicurezza prima di cominciare: l'archivio `ad_dns_record` del momento esportato in un file datato, più `Export-DnsServerZone` delle zone toccate sul DC (un file nella cartella del DNS del DC). **Niente snapshot della VM del DC**: riportare indietro un controller di dominio da snapshot rompe la replica di AD.
2. Prova a vuoto: anteprima di tutti i reverse mancanti; si leggono i nomi, non il totale.
3. Record di prova, con un nome che non esiste (`da-ipam-prova`): creato con A e PTR, cambiato di IP, tolto. Dopo ogni passo si chiede il nome al DNS da un'altra macchina (`nslookup` da 192.168.4.8), non al DA-IPAM.
4. Un annulla sul record di prova.
5. Una correzione vera, scelta da Riccardo fra i reverse mancanti.
6. Si rilancia `scripts/misura-dns-ad.ts 70791`: le anomalie corrette non ci sono più, le altre sono le stesse.

### [ ] S7 — Revisione, documenti, rilascio

Una revisione del ramo con il subagent `reviewer` (uno solo, sola lettura, stima 15 minuti): parte al sì di Riccardo. Poi `CHANGELOG.md`, `CONTEXT.md`, `docs/scheda-mappa.md`, un ADR sulla scrittura verso il DC (`docs/adr/`), consuntivo qui sotto, `scripts/controlla.sh` una volta, rilascio su `dev`. La promozione su `main` resta di Riccardo: le appliance dei clienti la ricevono spenta.

## Fuori da questo piano

- Creare o togliere zone; record AAAA; record di dominio; DNS non integrato in AD.
- Correzioni automatiche o pianificate.
- Riallineare il DHCP.

## Registro

## Consuntivo
### Fatto
### Mancante
### Scostamenti dal piano
### Consigli di sviluppo

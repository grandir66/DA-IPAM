# Tappa C1 — DA-IPAM, rete e privacy (NetBird / DA-Link)

> **Per gli agenti:** piano dettagliato della tappa C1 del
> [programma](2026-10-14-netbird-dalink-programma.md). Si esegue task per task, prova
> prima (vista fallire), poi il codice, poi la prova verde. Caselle `- [ ]` da spuntare.

**Obiettivo:** l'istanza DA-IPAM manda a DA-Link il segnale di vita con i due livelli di
privacy decisi sull'istanza, mostra in una pagina «Cosa esce da questa istanza» tutto ciò
che esce verso Domarc, si prepara a entrare in NetBird con la chiave d'ingresso e chiude
l'interfaccia `wt0` alle sole porte previste.

**Fonti:** spec `docs/superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md`
§2 (decisioni 7, 13, 22, 26), §4.3 (R5), §5.2, §5.3, §7.2, §11 (rischi 1, 9, 10), §12
«DA-IPAM», §14. Contratto vero di **DA-Link** (`~/Progetti/Domarc/DA-Link`; cosa fa e stato
in `MAPPA-PROGETTI.html`, logica in `CONTEXT.md`): `dalink/api/app.py`, `dalink/segnale.py`,
`dalink/token_istanze.py`, `dalink/comando.py`, piano della tappa A Task 8 e Task 10.

**Livello di controllo:** completo. Zone rosse: segnale e token, firewall, installatore.
Cancello prima di ogni commit: `npm run lint` (0 errori), `npx tsc --noEmit`, `npm test`,
letti dal codice di uscita, log nello scratchpad della sessione. Partenza su `origin/dev`
`4f0bd37`: 2136 prove, 0 fallite.

**Ramo:** `netbird-c1` da `origin/dev`, worktree `.claude/worktrees/netbird-c1`. Push solo
di `netbird-c1`. Mai `dev` né `main`: `dev` arriva a un cliente ogni 15 minuti.

---

## Il contratto con DA-Link (letto nel codice il 15/10)

- **Configurazione dell'istanza:** il comando d'installazione emesso da DA-Link scrive
  `/etc/dalink/oggetto.env` (umask 077) con `DALINK_URL`, `DALINK_IMPRONTA`
  (`sha256//<base64>`, forma di curl), `DALINK_CODCLI`, `DALINK_NODO` (`<codcli>-ipam`),
  `DALINK_TOKEN` (`dlk_…`). Poi fa da sé `netbird up --setup-key-file …` e `shred` della chiave.
- **Segnale:** `POST <DALINK_URL>/api/v1/segnale`, `Authorization: Bearer dlk_…`, corpo JSON
  `codcli` (testo), `nodo`, `livello` (`solo_stato` | `stato_inventario` | assente),
  `versione`, `moduli` ({testo: bool}), `salute` ({testo: testo}), `ultimo_errore` (≤500 o
  null), `porte_netbird` ([int], ≤64), `inventario` ({`dispositivi`, `reti`,
  `ultima_scansione` ≤32, `esito_scansione` ≤64} o null).
- **Risposta 200:** `{"ricevuto_il": "AAAA-MM-GG HH:MM:SS"}` più
  `inventario_cancellato_il` solo a «solo stato». Errori: 401 token, 403 `codcli`/`nodo`
  diversi dal token, 422 corpo malformato.
- **Certificato:** auto-firmato fino alla CA della tappa B, verificato **per impronta SPKI**.
- **Nessuna risposta porta istruzioni**: l'istanza legge dalla risposta solo le due date, e
  solo per mostrarle.

## Scelte prese qui (prudenti) — confermate da Riccardo il 2026-10-15

> **Decisioni di Riccardo (15/10, «C1 come consigli»).** Le scelte 1-16 valgono come scritte.
> In particolare:
> - **punto 4**: il livello lo cambiano gli amministratori dell'istanza **compreso l'utente
>   tecnico `domarc`** (Domarc lo imposta all'installazione o in assistenza), sempre col nome
>   nel registro, che non si cancella;
> - **la pagina «Cosa esce»** è approvata com'è disegnata qui sotto;
> - **punto 15**: la tappa **C1b** (rimozione dell'agente Python, decisione 26) si fa **dopo il
>   pilota e prima di estendere ad altri clienti**;
> - **pilota in tre gradini**: VM nuova sul laboratorio DA-PX-05 (`192.168.40.5`) → VM nuova
>   sul Proxmox di casa PX-NAS (`192.168.99.1`) → DTS. Solo dopo, gli altri clienti
>   («prima di fare casini altrove»).


1. **La configurazione è il file `/etc/dalink/oggetto.env`**, non una variabile in
   `.env.local`. File assente = funzione assente: nessun timer chiama, nessuna rete. Il
   percorso si sposta solo con `DALINK_OGGETTO_ENV` (prove e sviluppo). Il file si rilegge a
   ogni giro: chi lo crea dopo l'installazione non deve riavviare DA-IPAM.
2. **File con permessi larghi = configurazione rifiutata.** Se `oggetto.env` è leggibile da
   gruppo o altri, il token non si usa e la pagina lo dice (DA-Link lo scrive 600).
3. **Il livello vive in una tabella dell'hub propria** (`dalink_livello_registro`), non in
   `settings`: la rotta generica `PUT /api/settings` scrive qualunque chiave senza registro, e
   il livello deve cambiare solo dalla pagina, con chi e quando. La tabella **è** il registro
   di audit locale (righe mai cancellate). Sta fuori dall'esportazione dei dati: la scelta è
   dell'istanza, non del cliente da trasferire.
4. **Chi sceglie**: i ruoli `admin` e `superadmin` dell'istanza (`requireAdmin`). L'utenza di
   servizio `domarc` è un `superadmin` locale: può cambiare il livello, e il registro lo dice
   col suo nome.
5. **Cadenza del segnale: ogni 5 minuti**, primo invio 60 secondi dopo l'avvio, mai due giri
   insieme. Dopo un cambio di livello parte subito un invio, così la conferma arriva in
   pochi secondi. In pagina c'è anche «Invia adesso».
6. **Cosa sono i numeri dell'inventario**: `dispositivi` = righe di `hosts`, `reti` = righe
   di `networks`, ultima scansione ed esito = l'ultima riga di `scan_history` (ora UTC come
   la scrive SQLite, esito = `status`). Da fissare col CRM (spec §15).
7. **`salute` porta solo verdetti** (`ok` | `degraded` | `fail`), mai il testo di dettaglio
   delle sonde, che può contenere indirizzi e nomi della rete del cliente. In più tre voci
   dell'istanza: `firewall_wt0`, `interfaccia_wt0`, `cliente` (vedi sotto).
8. **`ultimo_errore` lo scrive solo DA-IPAM**, con parole sue: l'esito del segnale
   precedente (es. «segnale precedente: DA-Link non raggiungibile»), mai testo libero
   preso dai moduli.
9. **Porte su `wt0` dette dal sistema vivo**: si legge la tabella `inet dalink` con
   `nft -j list table inet dalink`. Se manca, si contano le porte **in ascolto** raggiungibili
   da `wt0` (indirizzo jolly o indirizzo di `wt0`, da `/proc/net/tcp*`): è il caso peggiore e
   per R5 sbaglia per eccesso, mai per difetto. `salute.firewall_wt0` dice quale fonte vale
   (`attivo` | `assente` | `non_so`).
10. **Il firewall restringe soltanto.** Tabella nftables propria `inet dalink`, catena
    sull'`input` che lascia passare tutto ciò che non arriva da `wt0`, e su `wt0` accetta le
    connessioni già aperte e le porte 22, 443 (più 6443 con l'edge), poi scarta. In nftables
    un `accept` di una catena non scavalca le altre: questa tabella non apre niente che UFW o
    NetBird chiudono, e sopravvive a `ufw --force reset` di Deploy-Appliance. Le porte sono
    nel codice, non in configurazione: una porta Wazuh non si può aggiungere da un file.
11. **Sorgenti facoltative**: `DALINK_FW_SORGENTI` (indirizzi o reti dentro `100.64.0.0/10`)
    restringe tutte le porte a quelle sorgenti (centrali e `admins`). Se manca, vale la
    policy NetBird come barriera (rischio 10) e `salute.firewall_wt0` lo dice
    (`attivo_sorgenti_aperte`). Una lista per tutte le porte, non una per porta.
12. **L'ingresso in NetBird lo fa il comando di DA-Link.** L'installatore di DA-IPAM prepara
    la macchina prima (client NetBird dal repository firmato, Tailscale con
    `--netfilter-mode=off`, firewall e suo servizio d'avvio) e verifica dopo. Per gli
    installatori che non incollano il comando (G1), accetta la chiave **solo da stdin**
    (`--chiave-da-stdin`), la scrive in un file 600, la passa a `netbird up --setup-key-file` e la
    distrugge: mai in un argomento.
13. **Proxy Zabbix nella pagina**: DA-IPAM non lo gestisce. Si dice «presente» se esiste
    `/etc/zabbix/zabbix_proxy.conf`, altrimenti «non rilevato su questa macchina».
14. **Niente `version:release` nel ramo**: la versione si alza quando il ramo arriva su
    `dev`, per non scontrarsi con le release di `dev` nel frattempo.
15. **L'agente Python remoto (decisione 26) non si toglie in questa tappa.** La decisione
    dice «nella tappa C1», il programma e la richiesta di questa sessione no. Toglierlo tocca
    `src/lib/executor/index.ts` (l'esecutore dei lavori), le pagine `/agents` e
    `tenants/[id]/agent`, la tabella `tenant_agents`, `agent/` e la CI: è un taglio a sé.
    Proposta: tappa **C1b**, piccola, prima del pilota.
16. **`/setup`**: il livello si chiede (§5.3, §12), facoltativo e senza valore preselezionato.
    Se non si risponde non si scrive niente: vale «nessuna scelta» = solo stato. La rotta
    accetta `livello_uscita` per Deploy-Appliance (G1).

## Interfaccia proposta (pagina «Cosa esce da questa istanza»)

Da scrivania, riferimento 1920 px. Voce **«Cosa esce»** nel menu «Sistema» (
solo per gli amministratori), indirizzo `/settings/cosa-esce`.

```
Cosa esce da questa istanza verso Domarc
──────────────────────────────────────────────────────────────────────────────
DA-Link — segnale di vita                                       [Invia adesso]
  Collegamento  [✓ Configurato] nodo 99999-ipam · cliente 99999 · da-link…:8443
  Ultimo invio  [✓ Ricevuto] 15/10 10:05 (ora italiana) · prossimo fra ~5 min
  
  Livello       ( ) Solo stato
                    versione, moduli accesi, salute dei moduli, ultimo errore,
                    porte aperte su NetBird, il livello scelto
                ( ) Stato + numeri dell'inventario
                    in più: dispositivi, reti, ultima scansione ed esito.
                    Mai l'inventario riga per riga.
                [Salva]
  Stato scelta  [… In attesa di conferma] abbassato il 15/10 10:04 da Mario Rossi
                oppure [✓ Confermato] DA-Link ha cancellato i numeri il 15/10 10:05

  Cosa contiene il prossimo segnale (letto adesso)
  ┌──────────────────────┬────────────────────────────────────────────────┐
  │ Versione             │ 0.3.281                                        │
  │ Moduli accesi        │ Edge, Wazuh                                    │
  │ Salute               │ edge: ok · wazuh: degraded · firewall wt0: …   │
  │ Porte su NetBird     │ 22, 443 (dal firewall)                         │
  │ Numeri inventario    │ non escono (solo stato)                        │
  └──────────────────────┴────────────────────────────────────────────────┘

Altri flussi verso Domarc (sono il servizio chiesto: si fermano spegnendo il modulo)
  Scanner-Edge → da-vulcan   [✓ Acceso] risultati delle scansioni di vulnerabilità
  Proxy Zabbix → DA-ZABBIX   [? Non rilevato su questa macchina]

Registro delle scelte (ultime 20)
  Quando · Chi · Livello
```

- Badge come in DA-Link: verde tenue con bordo pieno (✓), ambra tenue con bordo
  **tratteggiato** (… in attesa), **rosso pieno** solo per un errore (✕), bianco con bordo
  grigio (? non so / spento). Testo ≥13 px.
- Nessuna fascia in cima; senza configurazione la sezione dice in una riga «Non configurato:
  questa istanza non manda niente a DA-Link» e il livello si può comunque scegliere.
- Il token non compare mai: si dice solo «token presente».

---

## Task 1 — Configurazione dell'istanza

**File:** crea `src/lib/dalink/config.ts`, prova `src/lib/dalink/__tests__/config.test.ts`.

**Interfaccia:**
```ts
export type ConfigDalink =
  | { stato: "assente" }
  | { stato: "non_valida"; motivo: string }
  | { stato: "pronta"; url: URL; impronta: string /* "sha256/<b64>" */; codcli: string; nodo: string; token: string };
export function percorsoOggettoEnv(): string; // DALINK_OGGETTO_ENV o /etc/dalink/oggetto.env
export function leggiConfigDalink(percorso?: string): ConfigDalink;
export function normalizzaImpronta(v: string): string | null; // sha256//x e sha256/x → sha256/x
```

- [x] Prove (file temporanei in `os.tmpdir()`): `file assente → assente`; `file valido 600 →
  pronta, impronta normalizzata a sha256/`; `permessi 644 → non_valida, motivo «permessi»`;
  `token senza dlk_ → non_valida, il motivo non contiene il token`; `URL http:// →
  non_valida`; `codcli con spazio davanti → pronta con codcli senza spazio`; `codcli non
  numerico → non_valida`; `nodo diverso da <codcli>-ipam → non_valida`; `righe di commento e
  vuote ignorate, virgolette tolte`; `chiave sconosciuta ignorata`.
- [x] `node --import tsx --test src/lib/dalink/__tests__/config.test.ts` → FALLISCE (modulo
  assente).
- [x] Codice. Stessa prova → verde.

## Task 2 — Livello e stato del segnale nell'hub

**File:** modifica `src/lib/db-hub-schema.ts` (due tabelle), `src/lib/transfer/table-registry.ts`
(`EXCLUDED_HUB_TABLES`); crea `src/lib/dalink/stato.ts`; prova
`src/lib/dalink/__tests__/stato.test.ts` (hub isolato, `support/hub-isolato` per primo).

```sql
CREATE TABLE IF NOT EXISTS dalink_livello_registro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  livello TEXT NOT NULL CHECK(livello IN ('solo_stato','stato_inventario')),
  scelto_da TEXT NOT NULL,
  scelto_il TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS dalink_segnale_stato (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  tentato_il TEXT, esito TEXT, dettaglio TEXT, livello_inviato TEXT,
  ricevuto_il TEXT, inventario_cancellato_il TEXT, ok_il TEXT
);
```

```ts
export type Livello = "solo_stato" | "stato_inventario";
export function livelloAttuale(): { livello: Livello; scelto_il: string; scelto_da: string } | null;
export function impostaLivello(livello: Livello, chi: string): void;   // sempre una riga nuova
export function registroLivello(limite?: number): RigaRegistro[];        // dalla più recente
export function statoSegnale(): StatoSegnale | null;
export function salvaEsitoSegnale(e: EsitoSalvato): void;
export function statoConferma(): { stato: "nessuna_richiesta" } | { stato: "in_attesa"; dal: string } | { stato: "confermata"; cancellato_il: string; risposta_il: string };
```

- [x] Prove: `senza righe livelloAttuale è null`; `impostaLivello aggiunge una riga e non
  sovrascrive`; `livello non ammesso → errore e nessuna riga`; `il registro è dal più
  recente`; `abbassato dopo l'ultimo ok → in_attesa`; `ok a solo_stato tentato dopo
  l'abbassamento con inventario_cancellato_il → confermata`; `ok a solo_stato tentato PRIMA
  dell'abbassamento → resta in_attesa`; `mai stato a stato_inventario → nessuna_richiesta`.
  La prova del registro tabelle (`transfer/__tests__/registry.test.ts`) deve restare verde.
- [x] Viste fallire → codice → verdi (anche `registry.test.ts`).

## Task 3 — Il costruttore del segnale

**File:** crea `src/lib/dalink/segnale.ts`; prova `src/lib/dalink/__tests__/segnale.test.ts`.

```ts
export interface FattiIstanza { versione: string; moduli: Record<string, boolean>; salute: Record<string, string>;
  ultimoErrore: string | null; porte: number[] }
export interface Inventario { dispositivi: number; reti: number; ultima_scansione: string | null; esito_scansione: string | null }
export interface CorpoSegnale { codcli: string; nodo: string; livello: Livello | null; versione: string;
  moduli: Record<string, boolean>; salute: Record<string, string>; ultimo_errore: string | null;
  porte_netbird: number[]; inventario: Inventario | null }
export function costruisciSegnale(cfg: { codcli: string; nodo: string }, livello: Livello | null,
  fatti: FattiIstanza, leggiInventario: () => Inventario | null): CorpoSegnale;
```

- [x] Prove: **`solo_stato`: `leggiInventario` non viene mai chiamata e `inventario` è
  null** (spec §14); **livello non dichiarato: come solo stato** (`livello: null`, niente
  inventario); `stato_inventario`: chiamata una volta, numeri nel corpo; le chiavi del corpo
  sono **esattamente** quelle del contratto (nessuna `token`); `codcli` è testo; porte
  senza doppioni, ordinate, fra 1 e 65535, al massimo 64; `ultimo_errore` tagliato a 500;
  `ultima_scansione` a 32 ed `esito_scansione` a 64 caratteri.
- [x] Viste fallire → codice → verdi.

## Task 4 — Il firewall su `wt0`

**File:** crea `scripts/dalink/firewall-wt0.sh`, `deploy/dalink-firewall.service`; prova
`src/lib/dalink/__tests__/firewall-wt0.test.ts` (lancia lo script con `bash`, configurazione
in un file temporaneo indicato da `DALINK_FW_CONF`).

Comportamento: `--stampa` (predefinito: prova a vuoto) scrive il ruleset; `--applica` lo
carica con `nft -f` (atomico: crea, cancella, ricrea la tabella) e rilegge la tabella per
dire che c'è; `--togli` toglie la tabella. Configurazione `/etc/dalink/firewall.env`:
`DALINK_FW_EDGE=si|no` (obbligatoria: senza, esce ≠0), `DALINK_FW_SORGENTI` facoltativa.

- [x] Prove: `edge no → porte 22 e 443, niente 6443`; `edge si → anche 6443`; **nessuna
  porta Wazuh (1514, 1515, 55000, 9200, 5601, 443 a parte) in nessun caso, anche con
  variabili d'ambiente che provano ad aggiungerle**; `sorgenti valide → ip saddr {…} su ogni
  accept di porta`; `sorgente fuori da 100.64.0.0/10 → esce ≠0 e non stampa ruleset`;
  `DALINK_FW_EDGE assente → esce ≠0`; `la catena termina con drop su wt0 e lascia passare il
  resto (iifname != "wt0" accept)`.
- [x] Viste fallire → script → verdi.
- [x] **Prova vera, una volta, su Linux** (VM `presidio`, solo in spazi di rete usa e getta
  `ip netns`, cancellati alla fine; niente sulla rete della macchina):
  `scripts/dalink/prova-firewall-netns.sh` crea due spazi collegati da una coppia veth (lato
  istanza chiamato `wt0`), carica il ruleset con sorgenti = un indirizzo, e prova: da
  sorgente ammessa la 443 risponde; da un altro indirizzo NetBird no; la 1514 non risponde
  mai. Si salva anche l'uscita vera di `nft -j list table inet dalink` come dato di prova
  del Task 5 (`src/lib/dalink/__tests__/dati/nft-dalink.json`).

## Task 5 — Le porte su `wt0`, dal sistema vivo

**File:** crea `src/lib/dalink/porte-wt0.ts`; prova `src/lib/dalink/__tests__/porte-wt0.test.ts`
con i dati veri di `nft` (Task 4) e un `/proc/net/tcp` nella forma del kernel.

```ts
export type FontePorte = "firewall" | "ascolto" | "non_so";
export function porteDaNftJson(json: string): { porte: number[]; sorgentiRistrette: boolean } | null;
export function porteInAscolto(tcp4: string, tcp6: string, indirizziWt0: string[]): number[];
export async function leggiPorteWt0(dip?: DipendenzePorte): Promise<{ fonte: FontePorte; porte: number[]; sorgentiRistrette: boolean }>;
```

- [x] Prove: `json vero → [22, 443] (o [22, 443, 6443])`; `json di una tabella senza regole
  wt0 → null`; `json malformato → null`, mai eccezione; `ascolto: 0.0.0.0 e :: contano,
  127.0.0.1 no, l'indirizzo di wt0 sì, un altro indirizzo LAN no, solo stato 0A (LISTEN)`;
  `nft che fallisce → fonte ascolto`; `/proc assente → non_so con lista vuota`.
- [x] Viste fallire → codice → verdi.

## Task 6 — Il trasporto con l'impronta

**File:** crea `src/lib/dalink/trasporto.ts`; prova `src/lib/dalink/__tests__/trasporto.test.ts`
con un server TLS vero su 127.0.0.1 e certificato generato in memoria (come
`integrations/__tests__/unifi-api.test.ts`).

```ts
export type ErroreTrasporto = "rete" | "cert" | "tempo" | "risposta";
export interface RispostaDalink { status: number; body: string }
export async function postSegnale(url: URL, impronta: string, token: string, corpo: string,
  opz?: { timeoutMs?: number }): Promise<RispostaDalink>; // rifiuta con ErroreDalink(tipo)
```

Un solo socket: TLS senza CA, impronta SPKI verificata **prima** di scrivere un byte, poi la
richiesta HTTP sullo stesso socket (`createConnection`). Niente connessione separata come in
`scanner-edge-client.ts`: lì il token passa su un secondo socket non verificato.

- [x] Prove: `impronta giusta → 200 e il server ha visto Bearer e corpo`; **`impronta
  sbagliata → errore cert e il server non ha ricevuto nessuna richiesta`**; `porta chiusa →
  rete`; `risposta oltre 64 KB → risposta (interrotta)`; `server muto → tempo`.
- [x] Viste fallire → codice → verdi.

## Task 7 — Un giro d'invio

**File:** crea `src/lib/dalink/invio.ts`, `src/lib/dalink/fatti.ts`; prova
`src/lib/dalink/__tests__/invio.test.ts` (hub isolato, dipendenze iniettate: config, fatti,
trasporto).

```ts
export async function giroSegnale(dip?: Partial<DipendenzeGiro>): Promise<EsitoGiro>;
// EsitoGiro: { esito: "non_configurato" | "configurazione_non_valida" | "ok" | "rifiutato" | "errore"; dettaglio: string }
export function leggiRisposta(body: string): { ricevuto_il: string | null; inventario_cancellato_il: string | null };
export function inventarioDaDb(db: Database): Inventario;  // in fatti.ts
```

- [x] Prove: **`config assente → il trasporto non viene chiamato e niente si scrive`**;
  `config non valida → non chiamato, esito salvato col motivo`; `ok → stato salvato con
  ricevuto_il`; **`risposta con chiavi in più (livello, url, token, comandi) → il livello e il
  file di configurazione restano identici`** (spec §14: «nessuna risposta di DA-Link cambia il
  livello»); `date della risposta in forma non attesa → scartate`; `401/403/422 → rifiutato,
  dettaglio in parole nostre`; `errore cert → errore, dettaglio «certificato di DA-Link
  diverso dall'impronta»`; `il giro dopo un errore mette l'esito precedente in
  ultimo_errore`; `codcli senza cliente in questa istanza → moduli vuoti, salute.cliente =
  non_trovato, inventario null anche a stato_inventario`; `inventarioDaDb su schema tenant
  vero in memoria → conteggi giusti e ultima scansione`.
- [x] Viste fallire → codice → verdi.

## Task 8 — Il timer

**File:** crea `src/lib/dalink/segnale-job.ts`; modifica `server.ts` (`initCron`, import
dinamico come gli altri notificatori: il modulo importa `db-tenant` solo staticamente).
Prova `src/lib/dalink/__tests__/segnale-job.test.ts`.

```ts
export function avviaSegnaleDalink(opz?: { primoMs?: number; ogniMs?: number; giro?: () => Promise<EsitoGiro> }): () => void;
export async function inviaAdesso(): Promise<EsitoGiro>; // un giro alla volta: se ce n'è uno in corso lo aspetta
```

- [x] Prove: `due chiamate insieme → un solo giro`; `lo stop ferma i timer`; il giro senza
  configurazione non chiama la rete (già nel Task 7).
- [x] Viste fallire → codice → verdi.

## Task 9 — Le rotte

**File:** crea `src/app/api/dalink/cosa-esce/route.ts` (GET), `src/app/api/dalink/livello/route.ts`
(PUT), `src/app/api/dalink/segnale/route.ts` (POST), `src/lib/dalink/quadro.ts`; prova
`src/lib/dalink/__tests__/quadro.test.ts`.

- Tutte con `requireAdmin()` come prima istruzione; corpo del PUT con Zod
  (`{ livello: "solo_stato" | "stato_inventario" }`); dopo il PUT parte un invio
  (`inviaAdesso`, senza aspettarlo).
- `quadroCosaEsce()`: configurazione (senza token), livello, registro, stato del segnale,
  conferma, **anteprima** del prossimo corpo costruita con lo stesso `costruisciSegnale`, altri
  flussi (edge acceso dal registro moduli, proxy Zabbix dal file).
- [x] Prove: `il quadro serializzato non contiene il token`; `senza configurazione il quadro
  dice non configurato e l'anteprima c'è lo stesso`; `l'anteprima a solo stato non ha
  inventario`. La prova delle guardie (`permessi/__tests__/rotte-censite.test.ts`) resta
  verde senza nuove eccezioni.
- [x] Viste fallire → codice → verdi.

## Task 10 — La pagina «Cosa esce»

**File:** crea `src/app/(dashboard)/settings/cosa-esce/page.tsx` e
`src/components/settings/cosa-esce.tsx`; modifica `src/components/shared/sidebar.tsx` (voce
«Cosa esce» sotto «Sistema», solo admin e superadmin).

- [x] Componente client con `fetchJson` + `LoadError`; date con `parseDbDate` e ora italiana;
  badge con doppio segnale; testo ≥13 px (`text-sm` o più, niente `text-xs` per i contenuti).
- [x] Verifica resa **una volta** a 1920 px in locale con dati finti: `DALINK_OGGETTO_ENV` su
  un file nello scratchpad, un DA-Link finto (server TLS locale col contratto vero) e hub
  di prova in `DA_INVENT_DATA_DIR` temporanea. Si guardano: configurato e ricevuto; livello
  abbassato «in attesa» e poi «confermato»; senza configurazione.

## Task 11 — `/setup`

**File:** modifica `src/lib/validators.ts` (`SetupSchema`: `livello_uscita` facoltativo),
`src/app/api/setup/route.ts` (se c'è, una riga nel registro con `scelto_da = "setup: <utente>"`),
`src/app/setup/page.tsx` (due scelte, nessuna preselezionata); prova in
`src/app/api/setup/__tests__/setup-livello.test.ts`.

- [x] Prove: `senza livello lo schema passa e non c'è livello`; `livello non ammesso → 400`;
  `la pagina non preseleziona (nessun checked/defaultValue sul livello)`.

## Task 12 — L'installatore

**File:** crea `scripts/dalink/prepara-netbird.sh`; modifica `scripts/install.sh` (opzione
`--netbird` che lo richiama dopo l'installazione); prova
`src/lib/dalink/__tests__/prepara-netbird.test.ts` con comandi finti nel `PATH` (`apt-get`,
`netbird`, `tailscale`, `nft`, `systemctl`, `shred`, `id`) che registrano i propri argomenti.

`prepara-netbird.sh [--applica] --edge si|no [--sorgenti "…"] [--chiave-da-stdin]`:
1. prova a vuoto di default: dice cosa farebbe;
2. client NetBird dal repository firmato `pkgs.netbird.io` se `netbird` manca;
3. Tailscale presente → `tailscale set --netfilter-mode=off` (rischio 1);
4. `/etc/dalink/firewall.env` (600) se manca; servizio `dalink-firewall` installato, abilitato e
   avviato; firewall applicato e riletto;
5. con `--chiave-da-stdin`: legge **una riga da stdin**, la scrive in `/etc/dalink/netbird.key`
   (600), `netbird up --management-url https://netbird.domarc.it --setup-key-file … --hostname
   <DALINK_NODO da oggetto.env>`, `shred -u`; senza `oggetto.env` si ferma prima;
6. verifica finale: `wt0` presente, tabella caricata, `oggetto.env` 600.

- [x] Prove: **`la chiave non compare in nessun argomento dei comandi né nell'uscita`**; `il
  file della chiave non esiste più alla fine`; `prova a vuoto → nessun comando che scrive`;
  `senza --edge → esce ≠0`; `tailscale presente → netfilter-mode=off prima di netbird up`;
  `senza oggetto.env e con la chiave → si ferma e non chiama netbird up`.
- [x] Viste fallire → script → verdi.

## Task 13 — Chiusura

- [x] Cancello completo + `npm run build`; rilettura del diff (`git diff origin/dev`), niente
  `console.log`, nessun segreto, niente nomi di clienti o IP veri (repo pubblico).
- [x] `CHANGELOG.md` (Non rilasciato) e `CONTEXT.md` §6 nel ramo. Il programma delle tappe non
  si tocca (lo aggiorna Riccardo).
- [x] Push di `netbird-c1`.

## Per portarlo su `dev` e al pilota (dopo la tappa)

1. Revisione del ramo e conferma delle scelte qui sopra.
2. Merge su `dev` + `npm run version:release`: arriva al cliente A in 15 minuti, **spento**
   (nessun `oggetto.env`): nessuna chiamata, nessun firewall, solo la pagina in più.
3. Tappa G1 (Deploy-Appliance): `ufw allow in on wt0` per le stesse porte se UFW è acceso,
   `prepara-netbird.sh --applica --edge …`, livello al `/setup` via `livello_uscita`.
4. Pilota (fase 2, con conferma a ogni passo): `prepara-netbird.sh --applica` sull'istanza
   DTS, poi il comando emesso da DA-Link, poi la verifica dal di fuori (segnale arrivato in
   DA-Link, porte Wazuh chiuse da `wt0`).

## Esito dell'esecuzione (15/10)

- Task 1-12 eseguiti, ogni prova vista fallire prima (le prove chiave anche per mutazione:
  token su socket non verificato, risposta di DA-Link che alza il livello, chiave
  d'ingresso come argomento, inventario letto a «solo stato»).
- Firewall provato sul vero una volta su Linux (VM `presidio`, nftables 1.0.9, spazi di
  rete usa e getta poi cancellati): 9 casi su 9. I dati di prova di `nft -j` vengono da lì.
- Pagina resa a 1920 px con un DA-Link finto (TLS vero, contratto vero): configurato e
  ricevuto, abbassato con DA-Link giù («in attesa di conferma»), poi confermato, poi senza
  configurazione. Difetto trovato a schermo e corretto con una prova: la salute mandava
  «in errore» per moduli spenti.
- Prova estranea instabile vista una volta: `db-parity/parita-gruppo0.test.ts`
  («getRecentStatusChanges: stesse transizioni»), orari a cavallo di un secondo; da sola
  passa tre volte su tre. Preesistente, non toccata.
- Contraddizioni spec ↔ contratto vero: nessuna sul segnale. Una di forma: DA-Link scrive
  l'impronta come curl (`sha256//…`), DA-IPAM la calcola con una barra: si accettano le due.
  Una da segnalare a DA-Link: il segnale porta `porte_netbird` vuoto quando l'istanza non sa
  leggerle (`salute.firewall_wt0 = non_so`); la verifica R5 di DA-Link dovrebbe leggere
  quella voce prima di dire «nessuna porta Wazuh».

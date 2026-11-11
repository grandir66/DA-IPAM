# Vista cliente — piano di esecuzione

> Si esegue in linea (una sessione che esegue i task in ordine) oppure con la skill
> `subagent-driven-development`. Le caselle `- [ ]` tengono il conto.

**Obiettivo:** dare a una persona del cliente un'area di sola lettura, semplice, con i dati che le servono (reti, apparati, cose da sistemare, dominio e accessi, log di sicurezza), senza comandi né configurazione.

**Architettura:** un'area a parte dentro DA-IPAM, sotto `/cliente`, con il suo layout (niente menu laterale) e pagine server che leggono il database con funzioni di sola lettura in `src/lib/cliente/`. I moduli sono un registro di schede: ogni scheda dichiara quando compare, il suo riquadro in casa e le voci che porta in «Cosa richiede attenzione». Un ruolo nuovo, `cliente`, è chiuso dentro quell'area.

**Spec:** nessun file a parte. Le decisioni di Riccardo dell'11/11/2026 stanno in `TASKS.md`, sezione «2026-11-11 — Vista per operatori non amministratori»; le sei tavole grafiche approvate o proposte stanno nella conversazione di quel giorno e sono descritte qui task per task.

**Livello di controllo:** leggero (proposto, da confermare da Riccardo). Il Task 1 tocca l'accesso, che è zona rossa: lì la prova si vede fallire prima.

**Stato:** bozza · **Ultimo aggiornamento:** 2026-11-11

## Vincoli globali

- Sola lettura stretta: nell'area nessun pulsante che scrive, nessuna rotta di scrittura, nessun «visto», nessuna nota.
- Solo scrivania: si ragiona e si guarda a 1920 px. Niente telefono.
- Un cliente solo: niente cambio cliente, niente nomi interni (hub, appliance, sonda, evidenze, confidenza, credenziali, scansioni).
- Parole semplici: «Log di sicurezza» (mai «SIEM» o «Wazuh» nei titoli; la fonte si scrive piccola sotto il titolo), «Da sistemare», «Dominio e accessi», «Cosa richiede attenzione».
- Un modulo spento non si vede: mai «non configurato» né link alle impostazioni.
- La scheda si lega alla **categoria** del modulo (`ModuleCategory` in `src/lib/modules/registry.ts`: `siem`, `va`, …), non al prodotto.
- Riccardo è daltonico: ogni stato si distingue per forma (icona) e luminosità, mai solo per tinta. Griglia degli indirizzi: pieno = acceso, grigio = spento, vuoto = libero.
- Marchio Domarc: palette e carattere dalla skill `design-domarc`.
- Le pagine esistenti dell'amministratore non si toccano, salvo il pulsante «Vista cliente» in Dashboard (Task 2).
- Ogni lettura passa dal database del cliente della sessione (`getServerTenantCode`, `getTenantDb`, `withTenant`): mai `DEFAULT.db` per sbaglio.
- Ramo `dev`. Mai `main`. Rilascio con `npm run version:release -- --staged-only` da un worktree di `origin/dev`; mai `git add -A`.

## Casi da non dimenticare

1. Un utente `cliente` che scrive a mano `/settings` o chiama `POST /api/hosts`: deve tornare a `/cliente` o ricevere 403 (Task 1).
2. Cliente senza nessun modulo opzionale attivo: la casa mostra solo Reti e Apparati, senza buchi né errori (Task 2).
3. Switch senza lettura SNMP: nessun pannello porte e nessuna riga «Collegato a», senza messaggi d'errore (Task 3 e 4).
4. Health AD mai eseguita o con un solo giro: niente «un mese fa», niente punteggio inventato (Task 5).
5. Avviso o vulnerabilità senza frase semplice in tabella: si mostra il titolo originale, mai una riga vuota (Task 6 e 7).

---

### [ ] Task 1 — Ruolo `cliente` e recinto

**Perché un ruolo nuovo e non «Solo lettura»:** `viewer` esiste già ed è usato (utenze di prova sull'hub, `prova-claude`): chiuderlo dentro `/cliente` toglierebbe a quelle utenze l'interfaccia che usano oggi. Scostamento dalla proposta iniziale, da confermare a Riccardo.

**File**
- crea `src/lib/cliente/recinto.ts` e `src/lib/cliente/__tests__/recinto.test.ts`
- modifica `src/lib/users/permissions.ts` (`UserRole`, `USER_ROLES`), `src/types/index.ts` riga 12 (unione dei ruoli), `src/lib/auth.config.ts` (callback `authorized`, riga 138), `src/components/shared/user-menu.tsx` riga 89 (etichetta «Cliente»), il modulo di creazione utente dove si sceglie il ruolo.

**Interfacce (prodotte)**
```ts
// src/lib/cliente/recinto.ts — pura, senza Next
export type EsitoRecinto = "passa" | "vai_a_cliente" | "vietato";
/** Per il ruolo `cliente`: pagine sotto /cliente passano; /api/auth/* e il logout passano;
 *  ogni altra pagina → "vai_a_cliente"; ogni altra rotta /api → "vietato". Gli altri ruoli: sempre "passa". */
export function recinto(ruolo: string | undefined, percorso: string): EsitoRecinto;
```

**Cosa fare**
- Scrivere prima la prova con le combinazioni: `cliente` su `/cliente`, `/cliente/reti`, `/`, `/settings`, `/api/hosts`, `/api/auth/session`, `/login`; `viewer` e `admin` sugli stessi percorsi. Vederla fallire, poi scrivere `recinto`.
- In `authorized` di `auth.config.ts`: dopo il controllo di sessione, `recinto(ruolo, nextUrl.pathname)`; `vai_a_cliente` → `Response.redirect(new URL("/cliente", nextUrl))`; `vietato` → risposta 403 JSON `{ error: "Non consentito" }`.
- `permissions.ts`: `cliente` non gestisce utenti (come `viewer`); un `admin` può creare utenti `cliente` nei suoi clienti; un utente `cliente` deve avere esattamente un cliente (rifiuto 400 «Un utente cliente appartiene a un solo cliente»). Aggiungere i casi a `__tests__/permissions.test.ts` senza cambiare quelli esistenti.
- Dopo l'accesso un utente `cliente` atterra su `/cliente` (lo fa già il recinto, partendo da `/`).

**Verifica:** `npx vitest run src/lib/cliente src/lib/users` → tutte verdi. A mano sul dev: utente `cliente` di prova, `/settings` riporta a `/cliente`, `curl` di una rotta `/api/hosts` con la sua sessione dà 403.

**Commit:** «Vista cliente: ruolo cliente chiuso nella sua area».

---

### [ ] Task 2 — Template, registro delle schede e casa

**File**
- crea `src/app/(cliente)/cliente/layout.tsx`, `src/app/(cliente)/cliente/page.tsx`
- crea `src/lib/cliente/registro.ts`, `src/lib/cliente/contesto.ts`, `src/lib/cliente/__tests__/registro.test.ts`
- crea `src/components/cliente/` con `intestazione.tsx`, `riquadro-modulo.tsx`, `elenco-attenzione.tsx`, `pagina-modulo.tsx` (cornice delle pagine interne: freccia «Torna alla casa», titolo, riga piccola di contesto)
- modifica `src/app/(dashboard)/page.tsx`: accanto al titolo «Dashboard», per `admin` e `superadmin`, un link «Vista cliente» verso `/cliente`.

**Interfacce (prodotte, usate da tutti i task dopo)**
```ts
// src/lib/cliente/contesto.ts
import type Database from "better-sqlite3";
import type { ModuleState } from "@/lib/modules/registry";
export interface ContestoCliente { db: Database.Database; tenantCode: string; nomeCliente: string; moduli: ModuleState[]; ora: Date }
export async function contestoCliente(): Promise<ContestoCliente>; // sessione → cliente → db, come fa la Dashboard

// src/lib/cliente/registro.ts
export type Gravita = "grave" | "attenzione" | "nota";
export type StatoRiquadro = "a_posto" | "attenzione" | "grave";
export interface VoceAttenzione { gravita: Gravita; testo: string; href: string; scheda: string }
export interface RiquadroCliente { numero: string; unita?: string; contesto: string; stato: StatoRiquadro; aperti: number }
export interface SchedaCliente {
  id: string;            // anche segmento di URL: /cliente/<id>
  titolo: string;
  ordine: number;
  icona: string;         // nome dell'icona lucide
  attiva(c: ContestoCliente): boolean;
  riquadro(c: ContestoCliente): RiquadroCliente | Promise<RiquadroCliente>;
  attenzione(c: ContestoCliente): VoceAttenzione[] | Promise<VoceAttenzione[]>;
}
export const SCHEDE_CLIENTE: readonly SchedaCliente[];           // i task 3-7 aggiungono una riga ciascuno
export function schedeAttive(c: ContestoCliente): SchedaCliente[]; // filtrate e ordinate
export function ordinaAttenzione(v: VoceAttenzione[]): VoceAttenzione[]; // grave, attenzione, nota; a parità l'ordine d'arrivo
```

**Cosa fare**
- Layout: intestazione sola (marchio Domarc, «La tua rete · <nome cliente>», ora dei dati, «Stampa» che chiama `window.print()`, nome utente con «Esci»). Nessun menu laterale. Un admin che guarda vede in più «Torna alla Dashboard».
- Casa: in alto il riquadro «Cosa richiede attenzione» (somma di `attenzione()` delle schede attive, ordinata; ogni riga porta l'icona della gravità, il testo, il nome della scheda e il link); sotto «I moduli attivi», una griglia di `riquadro-modulo` (titolo con icona, segno di stato a destra, numero grande, riga di contesto). Se una scheda lancia un errore, il suo riquadro mostra «Dato non disponibile» e la casa resta in piedi (l'errore va nel log, non a schermo).
- Segni di stato: `a_posto` = cerchio con spunta, `attenzione` = cerchio con punto esclamativo e numero, `grave` = triangolo e numero.
- La prova del registro copre `schedeAttive` e `ordinaAttenzione` con due schede finte.

**Verifica:** `npx vitest run src/lib/cliente` verde; pagina `/cliente` sul dev guardata una volta a 1920 con un cliente vero.

**Commit:** «Vista cliente: template dedicato, registro delle schede e casa a riquadri».

---

### [ ] Task 3 — Scheda Reti

**File**
- crea `src/lib/cliente/schede/reti.ts` (scheda + letture), `src/lib/cliente/__tests__/reti.test.ts`
- crea `src/app/(cliente)/cliente/reti/page.tsx`
- crea `src/components/cliente/griglia-indirizzi.tsx`, `src/components/cliente/scheda-apparato.tsx`, `src/lib/cliente/porte-note.ts`

**Interfacce**
- usa: `getNetworks` di `@/lib/db`, la tabella `hosts`, `retiProposte(retiIpam)` di `src/lib/trunk/reti-proposte.ts` per le reti viste e non censite (solo se il modulo «Sensore trunk» è attivo), le porte aperte dell'host dalla stessa fonte che usa la scheda host dell'amministratore.
- produce:
```ts
export interface ReteCliente { id: number; nome: string; cidr: string; vlan: number | null; inUso: number; totale: number }
export interface ApparatoCliente { ip: string; nome: string; cosa: string /* «Computer fisso · Dell · Windows 11» */; acceso: boolean; vistoIl: string | null;
  collegatoA: { switch: string; porta: string; vlan: number | null; velocita: string | null } | null; porteAperte: Array<{ numero: number; nome: string | null }> }
export function retiCliente(c: ContestoCliente): ReteCliente[];
export function indirizziDellaRete(c: ContestoCliente, reteId: number): Array<{ ip: string; stato: "acceso" | "spento" | "libero" }>;
export function apparatoCliente(c: ContestoCliente, ip: string): ApparatoCliente | null;
export function nomeDellaPorta(numero: number): string | null; // porte-note.ts: 22 «accesso remoto SSH», 80/443 «pagina web», 135, 139/445 «condivisione file», 3389 «desktop remoto», 9100 «stampa», 161 «gestione di rete», 53 «nomi di rete», 25/587 «posta»
```

**Cosa fare**
- Pagina in due colonne: a sinistra «Le reti» (riga per rete: nome, VLAN, «N su M»; interruttore elenco/griglia nel titolo) e sotto «Viste sul cavo, non censite» (rete, VLAN, indirizzi visti, frase «La sonda le sente passare ma nessuno le ha dichiarate.»); a destra la griglia della rete scelta e, al clic su un quadretto, la scheda dell'apparato.
- La scelta sta nell'indirizzo: `/cliente/reti?rete=<id>&ip=<ip>`. Niente stato lato browser oltre a questo.
- `cosa` si compone dalla categoria del motore (`attr_category` → etichetta in italiano semplice, tabella in `src/lib/cliente/categorie.ts` che il Task 4 riusa), dal produttore e dal sistema operativo; i campi che mancano si saltano.
- `collegatoA` è `null` se non c'è una porta di switch nota: la riga non si disegna.
- Riquadro in casa: numero di reti, contesto «N VLAN · N indirizzi in uso», `attenzione` se ci sono reti non censite. Voci di attenzione: una per rete non censita («Rete <cidr> vista e non censita»).

**Verifica:** `npx vitest run src/lib/cliente` verde (letture su un database di prova con due reti, un host acceso, uno spento, uno senza switch); pagina guardata una volta a 1920 sul dev.

**Commit:** «Vista cliente: scheda Reti con VLAN, reti viste sul cavo e scheda dell'apparato».

---

### [ ] Task 4 — Scheda Apparati

**File**
- crea `src/lib/cliente/schede/apparati.ts`, `src/lib/cliente/categorie.ts` (se non nato nel Task 3), `src/lib/cliente/__tests__/apparati.test.ts`
- crea `src/app/(cliente)/cliente/apparati/page.tsx`, `src/components/cliente/pannello-porte.tsx`

**Interfacce**
- usa: `CATEGORY_TAXONOMY` di `src/lib/attribution/taxonomy.ts`, le funzioni pure di `src/lib/scheda/porte-da-guardare.ts` (`numeroPorta`, `ePortaFisica`, `etichettaVelocita`, `vlanDistinte`), la tabella `switch_ports`, `scheda-apparato.tsx` del Task 3.
- produce:
```ts
export type TipoCliente = "computer" | "server" | "rete" | "stampanti" | "telefoni" | "mobili" | "altro" | "non_riconosciuti";
export function tipoCliente(categoria: string | null): TipoCliente; // dalle radici della tassonomia: compute.workstation/laptop → computer; compute.* → server; network → rete; peripheral → stampanti; voip → telefoni; mobile → mobili; av/iot/ot/power/storage → altro (storage → server); null → non_riconosciuti
export function conteggiPerTipo(c: ContestoCliente): Record<TipoCliente, number>;
export function apparatiDelTipo(c: ContestoCliente, tipo: TipoCliente): Array<{ ip: string; nome: string; cosa: string; acceso: boolean; spentoDa: string | null; haPorte: boolean }>;
export interface PortaCliente { numero: number; stato: "collegata" | "libera"; dorsale: boolean; velocita: string | null; vlan: number[]; attaccato: { nome: string; ip: string | null } | null; verso: string | null }
export function porteDelloSwitch(c: ContestoCliente, ip: string): PortaCliente[] | null; // null se lo switch non è letto
```

**Cosa fare**
- Pagina in due colonne: a sinistra «Per tipo» con icona e conteggio; a destra l'elenco del tipo scelto e, per uno switch scelto, il pannello: una casella per porta (piena = collegata, vuota = libera, bordo spesso = dorsale), la riga di riepilogo («N collegate · N libere · N dorsali · VLAN …») e il dettaglio della porta scelta («Chi c'è attaccato», per una dorsale «verso <switch>» solo se il vicino è noto).
- Indirizzo: `/cliente/apparati?tipo=<tipo>&ip=<ip>&porta=<n>`.
- «Non riconosciuti» resta visibile, in grigio, in fondo. Nessuna confidenza, nessuna evidenza.
- Riquadro in casa: totale apparati, contesto «N accesi · N switch, N porte». Voci di attenzione: apparati di rete e server spenti da più di un giorno («<nome> spento da <quando>»), gravità `nota`.

**Verifica:** `npx vitest run src/lib/cliente` verde (`tipoCliente` su ogni radice della tassonomia; `porteDelloSwitch` con e senza lettura); pagina guardata una volta a 1920.

**Commit:** «Vista cliente: scheda Apparati per tipo, con il pannello delle porte degli switch».

---

### [ ] Task 5 — Scheda Dominio e accessi

**File**
- crea `src/lib/cliente/schede/dominio.ts`, `src/lib/cliente/__tests__/dominio.test.ts`, `src/app/(cliente)/cliente/dominio/page.tsx`

**Interfacce**
- usa: `ad_health_runs` e `ad_health_findings` (ultimo giro riuscito e, se esiste, quello più vicino a 30 giorni prima), `kpiSicurezza(db)` di `src/lib/security/kpi-dashboard.ts`, `leggiAccessiIndexer(tenantCode)` di `src/lib/security/accessi-indexer.ts`, gli eventi dei server di dominio in `src/lib/security/eventi-dc/`.
- produce:
```ts
export interface StatoDominio { dominio: string; punteggio: number | null; unMeseFa: number | null; controllatoIl: string | null; aree: Array<{ nome: string; punteggio: number }>; rilievi: Array<{ gravita: Gravita; testo: string; nomi: string[] }> }
export interface ProblemaAccesso { utente: string; tipo: "bloccato" | "falliti"; quanti: number; da: string | null; ultima: string | null; motivo: string | null }
export function statoDominio(c: ContestoCliente): StatoDominio | null;       // null se la Health AD non è mai riuscita
export function problemiDiAccesso(c: ContestoCliente): Promise<ProblemaAccesso[]>; // ultime 24 ore, bloccati prima
```

**Cosa fare**
- La scheda è attiva se c'è un dominio collegato (`ad_integrations` con almeno una riga attiva).
- Pagina: a sinistra «Stato del dominio» (punteggio, «un mese fa N» solo se c'è, barre delle aree); a destra «Cosa abbassa il punteggio» (rilievi come frasi; «vedi i nomi» apre l'elenco nella stessa pagina con `?rilievo=<n>`) e «Problemi di accesso · ultime 24 ore».
- I nomi delle aree e dei rilievi si prendono dai testi italiani che la pagina Sicurezza dominio mostra già; dove sono tecnici si aggiunge una frase semplice in `src/lib/cliente/frasi-dominio.ts`, con il titolo originale come ripiego.
- Riquadro in casa: punteggio «N su 100», contesto «stato del dominio · N accessi falliti». Voci di attenzione: account bloccati oggi (`attenzione`), rilievi gravi (`grave`).

**Verifica:** `npx vitest run src/lib/cliente` verde (Health mai eseguita → `null`; un solo giro → `unMeseFa` nullo); pagina guardata una volta a 1920 sul cliente 70791 dell'hub, che ha un dominio.

**Commit:** «Vista cliente: scheda Dominio e accessi».

---

### [ ] Task 6 — Scheda Log di sicurezza

**File**
- crea `src/lib/cliente/schede/log-sicurezza.ts`, `src/lib/cliente/frasi-avvisi.ts`, `src/lib/cliente/__tests__/log-sicurezza.test.ts`, `src/app/(cliente)/cliente/log-sicurezza/page.tsx`

**Interfacce**
- usa: lo stato dei moduli (`c.moduli`, una voce con `category === "siem"` attiva), le letture che oggi alimentano `/security-alerts` (`src/app/(dashboard)/security-alerts/`), la tabella `wazuh_agent` per i computer sotto controllo.
- produce:
```ts
export interface AvvisoCliente { gravita: Gravita; testo: string; dove: string | null; quando: string }
export function fraseAvviso(titoloOriginale: string): string; // tabella dei casi frequenti; se non c'è, restituisce il titolo originale
export function logSicurezza(c: ContestoCliente): Promise<{ fonte: string; sottoControllo: number; totaleComputer: number; perGiorno: number[] /* 7 valori */; aperti: AvvisoCliente[]; chiusiNelMese: number }>;
```

**Cosa fare**
- Scheda attiva solo con un modulo di categoria `siem` attivo. Titolo «Log di sicurezza», sotto in piccolo «fonte: <nome del modulo> · N computer sotto controllo su M».
- Pagina: a sinistra le barre dei 7 giorni (il giorno più alto più scuro) e la riga «N aperti · N chiusi nel mese · N computer senza controllo»; a destra «Avvisi aperti» come frasi, con dove e quando. Nessun numero di regola, nessun livello.
- `frasi-avvisi.ts` nasce con i venti avvisi più frequenti misurati sul cliente 70791 (`GROUP BY` sul titolo, prima di scrivere la tabella).
- Riquadro in casa: avvisi aperti, contesto «avvisi aperti · N chiusi nel mese»; `a_posto` se zero. Voci di attenzione: gli avvisi aperti gravi.

**Verifica:** `npx vitest run src/lib/cliente` verde (`fraseAvviso` con titolo noto e ignoto; scheda non attiva senza modulo); pagina guardata una volta a 1920.

**Commit:** «Vista cliente: scheda Log di sicurezza».

---

### [ ] Task 7 — Scheda Da sistemare

**File**
- crea `src/lib/cliente/schede/da-sistemare.ts`, `src/lib/cliente/__tests__/da-sistemare.test.ts`, `src/app/(cliente)/cliente/da-sistemare/page.tsx`

**Interfacce**
- usa: `barreReteDiSerie` di `src/lib/rilievi/barre-di-serie.ts` e i gruppi di `src/lib/rilievi/gruppi.ts` (lo stesso conto «un software o un rilievo per host» della Dashboard e della pagina Findings: i numeri devono coincidere), `vuln_findings`, `vuln_scan_runs` per la data dell'ultimo controllo.
- produce:
```ts
export interface DaSistemareApparato { nome: string; ip: string; gravi: number; alte: number; cosa: string; rimedio: string | null }
export function daSistemare(c: ContestoCliente): { ultimoControllo: string | null; gravi: number; alte: number; apparati: DaSistemareApparato[] }; // ordinati: più gravi prima
```

**Cosa fare**
- Scheda attiva solo con un modulo di categoria `va` attivo e almeno un controllo riuscito.
- Pagina: un elenco «Per apparato, dal più grave»: nome, «N gravi · N alte», una frase su cosa non va (il titolo del rilievo più grave dell'apparato), il rimedio se la fonte lo dà. Nessuna sigla CVE, nessun dettaglio dell'attacco, nessun punteggio.
- Solo gravità critica e alta. Media e bassa non si mostrano.
- Riquadro in casa: totale, contesto «N gravi · N alte», stato `grave` se ci sono critiche. Voci di attenzione: una per apparato con critiche («N problemi gravi su <nome>»).

**Verifica:** `npx vitest run src/lib/cliente` verde; sul dev i totali della scheda coincidono con «Critiche da sistemare» e «Alte da sistemare» della Dashboard dello stesso cliente.

**Commit:** «Vista cliente: scheda Da sistemare».

---

### [ ] Task 8 — Stampa, documenti, rilascio su dev

**File**
- modifica `src/app/globals.css` (regole `@media print` per l'area cliente: niente intestazione di navigazione, riquadri non spezzati) oppure un foglio dedicato importato dal layout del Task 2
- modifica `CHANGELOG.md`, `CONTEXT.md` (sezione «Vista cliente»: cos'è, ruolo, come si aggiunge una scheda), `docs/scheda-mappa.md` se cambia cosa fa il progetto, `TASKS.md`
- crea una pagina del manuale in `docs/` su come creare un utente cliente (pagina, clic, cosa vede)

**Cosa fare**
- Stampa della casa e di ogni pagina interna: una prova a schermo dell'anteprima, a 1920.
- In `CONTEXT.md` la ricetta per un modulo nuovo: un file in `src/lib/cliente/schede/`, una riga in `SCHEDE_CLIENTE`, una cartella in `src/app/(cliente)/cliente/`.
- Rilascio su `dev` e prova sull'hub (VM 533) con un utente `cliente` di prova sul cliente 70791; snapshot della VM prima, come da regola.
- Il cancello completo (`scripts/controlla.sh`) gira **una volta sola**, in sottofondo, prima di un eventuale passaggio a `main`, che resta da confermare con Riccardo.

**Verifica:** utente `cliente` di prova sull'hub: entra, vede la casa, apre le schede attive, `/settings` lo riporta a `/cliente`.

**Commit:** «Vista cliente: stampa e documenti».

---

## Non in questo piano

- «Lo segue Domarc» accanto a un problema: il dato non esiste. Si aggiunge quando c'è una fonte.
- Telefono, rapporto periodico per posta, marchio del cliente.
- Moduli futuri (patch, backup, Wi-Fi): nascono dopo, come file in più.

## Registro

## Consuntivo
### Fatto
### Mancante
### Scostamenti dal piano
### Consigli di sviluppo

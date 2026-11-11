# Vista cliente — piano di esecuzione

> Lo esegue un altro agente (Cursor), un task alla volta, in ordine. Chi ha scritto il piano controlla
> ogni task consegnato. Le caselle nel titolo dei task tengono il conto: `[ ]` da fare, `[~]` in corso,
> `[x]` fatto (solo con la riga `Verifica:` scritta sotto), `[!]` bloccato (motivo).

> **Chi scrive questo piano (Riccardo, 11/11/2026): una sessione sola**, quella che l'ha scritto e che controlla i task (worktree `.worktrees/da-ipam-classi-vecchie`). Chi esegue aggiorna solo lo stato del proprio task, la riga `Verifica:` e il Registro. Ogni altra sessione che vede un difetto (a schermo o nel codice) lo scrive in `TASKS.md`, sezione «2026-11-11 — Vista per operatori non amministratori», e non aggiunge né cambia task qui.

**Obiettivo:** dare a una persona del cliente un'area di sola lettura, semplice, con i dati che le servono (reti, apparati, cose da sistemare, dominio e accessi, log di sicurezza), senza comandi né configurazione.

**Architettura:** un'area a parte dentro DA-IPAM, sotto `/cliente`, in un gruppo di rotte suo `src/app/(cliente)/` con il suo layout (niente menu laterale). Le pagine sono Server Component che leggono il database del cliente con funzioni di sola lettura in `src/lib/cliente/`: nessuna rotta `/api` nuova. I moduli sono un registro di schede: ogni scheda dichiara quando compare, il suo riquadro in casa e le voci che porta in «Cosa richiede attenzione». Un utente «Solo lettura» con il segno `vista_cliente` è chiuso dentro quell'area.

**Spec:** nessun file a parte. Le decisioni di Riccardo dell'11/11/2026 stanno in `TASKS.md`, sezione «2026-11-11 — Vista per operatori non amministratori». Le tavole approvate sono descritte qui, task per task.

**Livello di controllo:** leggero (deciso da Riccardo l'11/11/2026). Il Task 1 tocca l'accesso e lo schema del database hub, che sono zona rossa: lì la prova si scrive e si vede fallire prima del codice.

**Stato:** approvato · **Ultimo aggiornamento:** 2026-11-11

## Regole per chi esegue

1. Ramo `dev`. **Mai `main`.** Si lavora in un worktree di `origin/dev`, mai nel clone principale.
2. Dopo ogni task: `npm run lint && npx tsc --noEmit`, le prove del task, poi `git add <solo i file del task>`, `npm run version:release -- --staged-only`, `git push origin HEAD:dev`. **Mai `git add -A`**, mai `git reset --hard`.
3. Una riga in `CHANGELOG.md` per task (cosa e perché), nello stesso commit.
4. Le prove esistenti non si modificano per farle passare. Se una prova esistente fallisce, ci si ferma e lo si scrive nel task come `[!]`.
5. Le prove si scrivono con `node:test` e `node:assert/strict`, come quelle già nel repo (esempio: `src/lib/users/__tests__/service.test.ts`), e si lanciano con `node --import tsx --test <file>`. Vitest non c'è e non si aggiunge. TypeScript strict, niente `any`. Testi a schermo in italiano. `db-tenant` si importa solo in modo statico (regola 14 di `CLAUDE.md`). `JSON.parse` sempre in `try/catch`.
6. Stile: `docs/STILE-UI.md` e i mattoni di `src/components/shared/console.tsx` (`Pannello`, `TesseraNumero`, `VoceSelezionabile`, `Etichetta`, `SchedaDettaglio`, `DatoDettaglio`, `Vuoto`, `BadgeGravita`, `TempoRelativo`). Testo ≥ 13 px. shadcn v4: niente `asChild`, si usa `render={<Componente />}`.
7. Riccardo è daltonico: ogni stato si distingue per **forma** (icona) e **luminosità**, mai solo per tinta.
8. Fuori dal perimetro del task non si tocca niente. Le pagine dell'amministratore restano come sono, salvo dove il piano lo dice.
9. Se un dato che il piano dà per esistente non c'è (tabella, colonna, funzione), ci si ferma e lo si scrive: non si inventa un ripiego.
10. Niente build completo, niente cancello (`scripts/controlla.sh`) dopo ogni task: gira una volta sola alla fine (Task 8).

## Vincoli globali

- Sola lettura stretta: nell'area nessun pulsante che scrive, nessuna chiamata `fetch` con metodo diverso da GET, nessun «visto», nessuna nota.
- Solo scrivania: si ragiona e si guarda a 1920 px. Niente telefono.
- Un cliente solo: niente cambio cliente, niente parole interne a schermo (hub, appliance, sonda, evidenze, confidenza, credenziali, scansione, Wazuh, Scanner-Edge, SIEM, CVE).
- Titoli fissi: «La tua rete», «Cosa richiede attenzione», «I moduli attivi», «Reti», «Apparati», «Da sistemare», «Dominio e accessi», «Log di sicurezza».
- Un modulo spento non si vede: mai «non configurato», mai un link a `/settings`.
- Nell'area nessun link porta fuori da `/cliente`, tranne «Torna alla Dashboard» per l'amministratore ed «Esci».
- Le letture passano dal database del cliente della sessione: `getServerTenantCode()` di `@/lib/api-tenant`, poi `withTenant(tenantCode, …)` e `getTenantDb(tenantCode)` di `@/lib/db-tenant`, come fa `src/app/(dashboard)/page.tsx`.
- Date e ore a schermo in ora italiana, con gli strumenti di `@/lib/db-date` (`parseDbDate`, `FUSO_UTENTI`).
- Se una lettura fallisce, il pezzo mostra «Dato non disponibile» e il resto della pagina resta in piedi; l'errore va in `console.error("[cliente] …")`, mai a schermo.

## Casi da non dimenticare

1. Un utente con `vista_cliente` che apre `/settings` o chiama `POST /api/hosts`: torna a `/cliente` oppure riceve 403 (Task 1).
2. Cliente senza nessun modulo opzionale attivo: la casa mostra solo Reti e Apparati, senza buchi né errori (Task 2).
3. Switch senza porte lette: nessun pannello porte e nessuna riga «Collegato a», senza messaggi d'errore (Task 3 e 4).
4. Health AD mai riuscita, o con un solo giro: niente punteggio inventato, niente «un mese fa» (Task 5).
5. `hosts.open_ports` vuoto o non JSON: la riga «Porte aperte» non si disegna (Task 3).

---

### [x] Task 1 — Utente «Cliente» e recinto

**Corretto l'11/11 dopo il primo stop (aveva ragione chi esegue):** la colonna si aggiunge in due posti, vedi «File»; le prove girano con `node --import tsx --test`, non con Vitest, che nel repo non c'è. Il task riparte da capo.

**Perché un segno e non un ruolo nuovo.** Nel database hub il ruolo ha un vincolo `CHECK(role IN ('superadmin','admin','viewer'))` su `users` e `CHECK(role IN ('admin','viewer'))` su `user_tenant_access` (`src/lib/db-hub-schema.ts` righe 33 e 53): un ruolo nuovo vorrebbe dire ricostruire due tabelle con chiavi esterne. Si aggiunge invece una colonna. Gli utenti «Solo lettura» di oggi restano come sono.

**File**
- crea `src/lib/cliente/recinto.ts`, `src/lib/cliente/__tests__/recinto.test.ts`
- modifica `src/lib/db-hub-schema.ts`: nel `CREATE TABLE users` la colonna `vista_cliente INTEGER NOT NULL DEFAULT 0` (vale per le installazioni nuove; in questo file **nessun** `ALTER`)
- modifica `src/lib/db-hub.ts`: in `initializeHubDb`, nell'elenco `nuove` delle colonne di `users` (righe 477-488, quello con `totp_richiesta` … `ultima_istanza`), in coda la riga `["vista_cliente", "INTEGER NOT NULL DEFAULT 0"]` con un commento di una riga (vale per le installazioni esistenti: il ciclo sotto fa l'`ALTER` solo se la colonna manca); nel tipo `HubUser` il campo `vista_cliente: number`; nelle funzioni che creano e modificano un utente (quelle chiamate da `src/lib/users/service.ts`) la scrittura della colonna, 0 o 1
- modifica `src/lib/auth.ts`: l'oggetto utente restituito da `authorize` porta `vistaCliente: boolean` letto dalla colonna
- modifica `src/lib/auth.config.ts`: nel callback `jwt` `token.vistaCliente = user.vistaCliente === true` (accanto a `token.role`, riga 66); nel callback `session` `u.vistaCliente = token.vistaCliente === true` (accanto a `u.role`, riga 132); nel callback `authorized` (riga 138) il recinto, vedi sotto
- modifica `src/types/index.ts` (tipo dell'utente, riga 12): campo `vista_cliente?: boolean`
- modifica `src/lib/users/service.ts`: creazione e modifica accettano `vista_cliente` (booleano, assente = `false`)
- modifica `src/app/(dashboard)/settings/page.tsx` (righe 311, 316, 867-872, 898-903): quarta voce nei due menu del ruolo
- modifica `src/components/shared/user-menu.tsx` riga 89: etichetta «Cliente» se `vistaCliente`

**Interfaccia prodotta**
```ts
// src/lib/cliente/recinto.ts — pura, senza Next, senza database
export type EsitoRecinto = "passa" | "vai_a_cliente" | "vietato";
/**
 * vistaCliente === false → sempre "passa".
 * vistaCliente === true:
 *   - percorso === "/cliente" o comincia con "/cliente/"  → "passa"
 *   - comincia con "/api/auth"                             → "passa"
 *   - comincia con "/api/"                                 → "vietato"
 *   - ogni altro percorso                                  → "vai_a_cliente"
 */
export function recinto(vistaCliente: boolean, percorso: string): EsitoRecinto;
```

**Cosa fare**
1. Scrivere `recinto.test.ts` con questi casi e vederlo fallire: con `true` → `/cliente` passa, `/cliente/reti` passa, `/clienteX` vai_a_cliente, `/` vai_a_cliente, `/settings` vai_a_cliente, `/discovery` vai_a_cliente, `/api/hosts` vietato, `/api/auth/session` passa, `/api/version` vietato; con `false` → tutti passano.
2. Scrivere `recinto`.
3. In `authorized`, subito prima del `return true` finale (dopo il controllo `if (!isLoggedIn)`):
```ts
const esito = recinto((auth?.user as { vistaCliente?: boolean } | undefined)?.vistaCliente === true, pathname);
if (esito === "vai_a_cliente") return Response.redirect(new URL("/cliente", nextUrl));
if (esito === "vietato") return Response.json({ error: "Non consentito" }, { status: 403 });
```
   Nel ramo `/login` già autenticato il redirect resta verso `/`: il recinto lo porta poi a `/cliente`.
4. `service.ts`: `vista_cliente: true` è ammesso solo se il ruolo è `viewer` e i clienti assegnati sono esattamente uno; altrimenti 400 «Un utente cliente è in sola lettura e appartiene a un solo cliente». Aggiungere i casi a `src/lib/users/__tests__/service.test.ts` senza cambiare quelli che ci sono.
5. Impostazioni → Utenti: nei due menu del ruolo una voce in più, `value="cliente"`, testo «Cliente (vista semplice)». È solo dell'interfaccia: al salvataggio manda `role: "viewer"` e `vista_cliente: true`; le altre voci mandano `vista_cliente: false`. In modifica, un utente con `vista_cliente` si apre con quella voce scelta.

**Verifica:** `node --import tsx --test src/lib/cliente/__tests__/*.test.ts src/lib/users/__tests__/*.test.ts` → 62 prove, 0 fallite (2026-11-11). `npm run lint` → 0 errori. `npx tsc --noEmit` → 0 errori. La prova sul dev (accesso, `/settings` che riporta a `/cliente`, `GET /api/hosts` a 403) resta al controllo: la pagina `/cliente` arriva col Task 2.

**Commit:** «Vista cliente: utente Cliente chiuso nella sua area».

---

### [x] Task 1 bis — Il cambio a «Cliente» vale subito (dal controllo del Task 1)

**Controllo del Task 1 (11/11, commit `3a0da573`):** passato. File toccati solo quelli elencati; firme come da piano; 62 prove verdi rilanciate; il terminale SSH (`/ws/ssh`, fuori dal recinto) chiede un gettone che nasce da una rotta `/api`, vietata al Cliente. Un difetto trovato, non previsto dal piano: il segno viaggia nel gettone di sessione, quindi un utente già dentro che l'amministratore passa a «Cliente» continua a vedere l'interfaccia completa finché non rientra.

**File**
- modifica `src/lib/users/service.ts` (`updateUserAs`), `src/lib/users/__tests__/service.test.ts` (solo casi nuovi)

**Cosa fare**
- In `updateUserAs`, dentro la transazione già esistente, dopo `updateUserRole(userId, role, vistaCliente)`: se il valore di `vista_cliente` dell'utente **prima** della modifica è diverso da quello nuovo, chiamare `segnaUscita(userId)` di `@/lib/accesso/sessione` (import statico). È la stessa funzione di «Esci»: il gettone vecchio non vale più e l'utente deve rientrare.
- Prova: un utente `viewer` passato a Cliente ha `sessioni_valide_da` valorizzato dopo la modifica; una modifica che non cambia il segno lo lascia com'era.

**Verifica:** `node --import tsx --test src/lib/users/__tests__/*.test.ts` → 61 prove, 0 fallite (2026-11-11). `npm run lint` → 0 errori. `npx tsc --noEmit` → 0 errori.

**Commit:** «Vista cliente: il passaggio a Cliente chiude le sessioni aperte». Si può consegnare insieme al Task 2.

---

### [x] Task 2 — Template, registro delle schede e casa

**File**
- crea `src/lib/cliente/contesto.ts`, `src/lib/cliente/registro.ts`, `src/lib/cliente/__tests__/registro.test.ts`
- crea `src/app/(cliente)/cliente/layout.tsx`, `src/app/(cliente)/cliente/page.tsx`
- crea `src/components/cliente/intestazione.tsx`, `riquadro-modulo.tsx`, `elenco-attenzione.tsx`, `pagina-modulo.tsx`, `segno-stato.tsx`
- modifica `src/app/(dashboard)/page.tsx` riga 186: accanto al titolo «Dashboard», se il ruolo è `admin` o `superadmin`, un `Link` «Vista cliente» verso `/cliente`

**Interfacce prodotte (le usano tutti i task dopo: nomi e firme non cambiano)**
```ts
// src/lib/cliente/contesto.ts
import type Database from "better-sqlite3";
import type { ModuleState } from "@/lib/modules/registry";

export interface ContestoCliente {
  tenantCode: string;
  nomeCliente: string;      // session.user.tenants.find(t => t.code === tenantCode)?.name ?? tenantCode
  moduli: ModuleState[];    // resolveModules(tenantCode, ruolo) dentro withTenant; [] se fallisce
  ora: Date;
  amministratore: boolean;  // ruolo admin o superadmin: vede «Torna alla Dashboard»
}
/** Sessione → cliente → moduli. Senza sessione: redirect("/login"). */
export async function contestoCliente(): Promise<ContestoCliente>;
/** Esegue una lettura dentro il contesto del cliente: withTenant(c.tenantCode, () => fn(getTenantDb(c.tenantCode))). */
export function nelCliente<T>(c: ContestoCliente, fn: (db: Database.Database) => T): T;
/** true se esiste un modulo di quella categoria con enabled && configured. */
export function moduloAttivo(c: ContestoCliente, categoria: ModuleState["category"]): boolean;

// src/lib/cliente/registro.ts
export type Gravita = "grave" | "attenzione" | "nota";
export type StatoRiquadro = "a_posto" | "attenzione" | "grave";
export interface VoceAttenzione { gravita: Gravita; testo: string; href: string; scheda: string /* titolo della scheda */ }
export interface RiquadroCliente { numero: string; unita?: string; contesto: string; stato: StatoRiquadro; aperti: number }
export interface SchedaCliente {
  id: string;        // segmento di URL: /cliente/<id>
  titolo: string;
  ordine: number;
  icona: string;     // nome di un'icona lucide-react
  attiva(c: ContestoCliente): boolean | Promise<boolean>;
  riquadro(c: ContestoCliente): RiquadroCliente | Promise<RiquadroCliente>;
  attenzione(c: ContestoCliente): VoceAttenzione[] | Promise<VoceAttenzione[]>;
}
export const SCHEDE_CLIENTE: readonly SchedaCliente[];   // vuoto in questo task; i task 3-7 aggiungono una riga ciascuno
export async function schedeAttive(c: ContestoCliente, schede?: readonly SchedaCliente[]): Promise<SchedaCliente[]>; // attive, per `ordine`; una scheda che lancia è scartata e l'errore va in console.error
export function ordinaAttenzione(v: VoceAttenzione[]): VoceAttenzione[]; // grave, attenzione, nota; a parità resta l'ordine d'arrivo
```

**Cosa fare**
- **Layout** (`layout.tsx`): solo `Intestazione` e il contenuto, larghezza massima 1600 px centrata. Nessun menu laterale. Intestazione, da sinistra: marchio Domarc (`/logo-color.png`), «La tua rete · <nomeCliente>», a destra «dati delle HH:MM» (ora italiana di `c.ora`), «Stampa» (componente client minimo che chiama `window.print()`), nome utente, «Esci» (stessa azione del menu utente esistente). Se `c.amministratore`, in più «Torna alla Dashboard» verso `/`.
- **Casa** (`page.tsx`): in cima un `Pannello` «Cosa richiede attenzione» con a destra «N voci»: una riga per voce (icona della gravità, testo, a destra il titolo della scheda), tutta la riga è un link a `href`; se non ci sono voci, una riga sola «Niente da segnalare». Sotto, il titolo piccolo «I moduli attivi» e una griglia `grid-cols-3` di `RiquadroModulo`: in alto icona e titolo, a destra `SegnoStato`, sotto il numero grande con `unita` piccola accanto, sotto ancora `contesto`; tutto il riquadro è un link a `/cliente/<id>`.
- **`SegnoStato`**: `a_posto` → icona `CircleCheck` e testo «a posto»; `attenzione` → `CircleAlert` e il numero `aperti`; `grave` → `TriangleAlert` e il numero `aperti`. Tre forme diverse; il colore è solo un rinforzo.
- **`PaginaModulo`**: cornice delle pagine interne. Props `{ titolo: string; contesto?: string; children }`. In alto un link «← La tua rete» verso `/cliente`, il titolo, e accanto in piccolo `contesto`.
- **Scheda inesistente o spenta**: le pagine dei task 3-7 cominciano con `if (!(await scheda.attiva(c))) redirect("/cliente")`.
- **Prova** (`registro.test.ts`): `schedeAttive` con tre schede finte (una spenta, una che lancia, due in ordine inverso) e `ordinaAttenzione`.

**Verifica:** `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 4 prove, 0 fallite (2026-11-11). `npm run lint` → 0 errori. `npx tsc --noEmit` → 0 errori. Sul dev, senza sessione, `/cliente` porta al login. La casa autenticata non è stata aperta.

**Commit:** «Vista cliente: template dedicato, registro delle schede e casa».

---

### [x] Task 3 — Scheda Reti

**Dal controllo del Task 2 (11/11, commit `13681f8f`): passato**, 65 prove verdi rilanciate; non guardato a schermo. Una correzione da fare in questo task, prima del resto: in `src/lib/cliente/contesto.ts`, se il cliente in sessione manca o è `"__ALL__"` (superadmin su «tutti i clienti»), `redirect("/")`. Oggi `getServerTenantCode()` in quel caso rende `"DEFAULT"` e la vista mostrerebbe i dati del cliente sbagliato col titolo «DEFAULT». Si legge `session.user.tenantCode` prima di chiamare `getServerTenantCode()`.

**File**
- crea `src/lib/cliente/categorie.ts`, `src/lib/cliente/porte-note.ts`, `src/lib/cliente/schede/reti.ts`, `src/lib/cliente/__tests__/reti.test.ts`
- crea `src/app/(cliente)/cliente/reti/page.tsx`, `src/components/cliente/griglia-indirizzi.tsx`, `src/components/cliente/scheda-apparato.tsx`
- modifica `src/lib/cliente/registro.ts`: una riga in `SCHEDE_CLIENTE`

**Fonti (verificate nel codice l'11/11)**
- `networks`: `id`, `cidr`, `name`, `vlan_id`.
- `hosts`: `network_id`, `ip`, `status` (`online` | `offline` | `unknown`), `custom_name`, `hostname`, `last_seen`, `open_ports` (JSON, array di oggetti con `port: number`), `attr_category`, `attr_vendor_name`, `attr_os_name`, `device_manufacturer`, `vendor`, `os_info`, `model`.
- `switch_ports`: `host_id`, `device_id`, `port_name`, `vlan`, `speed`, `is_trunk`; `network_devices`: `id`, `name` (schema in `src/lib/db-schema.ts` riga 84).
- Reti viste sul cavo: `trunkLetturaAttiva()` di `@/lib/trunk/sensore-trunk` e `retiProposte(retiIpam: string[])` di `@/lib/trunk/reti-proposte`, che rende `ReteProposta[]` (`vid`, `cidr`, `ip` = indirizzi visti, `ultimoGiorno`). Vanno chiamate dentro il contesto del cliente.

**Interfacce prodotte**
```ts
// src/lib/cliente/categorie.ts  (lo riusa il Task 4)
/** attr_category ("network.switch", "compute.workstation", …) → parola semplice. Sconosciuta o null → null. */
export function nomeCategoria(categoria: string | null): string | null;
// tabella: network.router «router», network.switch «switch», network.access_point «punto Wi-Fi», network.firewall «firewall»,
// network.controller «controllo Wi-Fi», network.modem «modem», compute.server «server», compute.workstation «computer fisso»,
// compute.laptop «portatile», compute.hypervisor «server di virtualizzazione», compute.vm «macchina virtuale»,
// storage.nas «archivio di rete», storage.san «archivio di rete», storage.tape «unità a nastro», peripheral.printer «stampante»,
// peripheral.scanner «scanner», peripheral.mfp «multifunzione», av.camera «telecamera», av.nvr «videoregistratore»,
// av.display «schermo», av.speaker «altoparlante», voip.phone «telefono», voip.pbx «centralino», voip.gateway «adattatore telefonico»,
// power.ups «gruppo di continuità», power.pdu «presa comandata», mobile.phone «cellulare», mobile.tablet «tablet»;
// per le altre foglie di CATEGORY_TAXONOMY (iot.*, ot.*): «dispositivo».

// src/lib/cliente/porte-note.ts
/** 22 «accesso remoto», 23 «accesso remoto non protetto», 25/587 «posta», 53 «nomi di rete», 80/443/8080/8443 «pagina web»,
 *  135 «servizi Windows», 139/445 «condivisione file», 161 «gestione di rete», 389/636 «elenco utenti», 3389 «desktop remoto»,
 *  5900 «controllo remoto», 9100 «stampa», 631 «stampa», 5060 «telefonia», 1433/3306/5432 «archivio dati». Altrimenti null. */
export function nomeDellaPorta(numero: number): string | null;

// src/lib/cliente/schede/reti.ts — le funzioni con `db` sono pure letture SQL, provate su un database in memoria
export interface ReteCliente { id: number; nome: string; cidr: string; vlan: number | null; inUso: number; totale: number }
export interface ReteVista { cidr: string; vlan: number | null; indirizzi: number }
export interface IndirizzoCliente { ip: string; stato: "acceso" | "spento" | "libero" }
export interface ApparatoCliente {
  ip: string; nome: string; cosa: string; acceso: boolean; vistoIl: string | null;
  collegatoA: { switch: string; porta: string; vlan: number | null; velocita: string | null } | null;
  porteAperte: Array<{ numero: number; nome: string | null }>;
}
export function retiCliente(db: Database.Database): ReteCliente[];                         // ordinate per nome
export function indirizziDellaRete(db: Database.Database, reteId: number): IndirizzoCliente[]; // vedi regole sotto
export function apparatoCliente(db: Database.Database, ip: string): ApparatoCliente | null;
export function retiViste(c: ContestoCliente): ReteVista[];                                 // [] se trunkLetturaAttiva() è falso
export const schedaReti: SchedaCliente;                                                     // id "reti", titolo "Reti", ordine 10, icona "Network"
```

**Regole di calcolo**
- `inUso` = host della rete con `status = 'online'`. `totale` = indirizzi utilizzabili del `cidr` (2^(32−prefisso) − 2; per /31 e /32 il numero pieno).
- `indirizziDellaRete`: per reti fino a /22 un elemento per indirizzo utilizzabile (`acceso` se c'è un host `online`, `spento` se c'è un host non `online`, `libero` se non c'è riga); per reti più grandi di /22 solo gli indirizzi che hanno una riga in `hosts`.
- `nome` dell'apparato = `custom_name`, poi `hostname`, poi l'IP.
- `cosa` = i pezzi presenti, uniti da « · »: `nomeCategoria(attr_category)` con l'iniziale maiuscola; produttore = `attr_vendor_name`, poi `device_manufacturer`, poi `vendor`; sistema = `attr_os_name`, poi `os_info`. Tutti assenti → «Non riconosciuto».
- `collegatoA`: la riga di `switch_ports` con `host_id` = id dell'host e `is_trunk = 0`, unita a `network_devices` per il nome; velocità con `etichettaVelocita` di `@/lib/scheda/porte-da-guardare`. Nessuna riga → `null`.
- `porteAperte`: `JSON.parse(open_ports)` in `try/catch`; si tengono i numeri di porta distinti in ordine crescente, al più 12.

**Pagina** (`/cliente/reti?rete=<id>&ip=<ip>`, due colonne 1 : 1,15)
- Sinistra, `Pannello` «Le reti»: una riga per rete (nome, `Etichetta` «VLAN n» se c'è, «inUso su totale»); la riga è un link che imposta `rete`. Senza `rete` nell'indirizzo è scelta la prima. Sotto, solo se `retiViste` non è vuoto, `Pannello` «Viste sul cavo, non censite»: rete, «VLAN n» o «senza VLAN», «n indirizzi», e la frase «La sonda le sente passare ma nessuno le ha dichiarate.»
- Destra: titolo «<nome> · <cidr>» con la legenda «pieno = acceso · grigio = spento · vuoto = libero», poi `GrigliaIndirizzi`: 32 quadretti per riga, ognuno un link che imposta `ip` (i liberi non sono link) con l'indirizzo in `title`. Pieno = sfondo `text-foreground`; grigio = sfondo `text-muted-foreground`; vuoto = solo bordo. Sotto la griglia, se c'è `ip`, `SchedaApparato`: nome, IP, «acceso»/«spento» con icona, poi le righe «Cos'è», «Visto l'ultima volta», «Collegato a» («<switch>, porta <porta> · VLAN <n> · <velocità>»), «Porte aperte» (numero e, se noto, nome). Le righe senza dato non si disegnano.

**Scheda nel registro**
- `attiva`: sempre `true`.
- `riquadro`: `numero` = numero di reti; `contesto` = «N VLAN · N indirizzi in uso»; `aperti` = numero di reti viste e non censite; `stato` = `attenzione` se `aperti > 0`, altrimenti `a_posto`.
- `attenzione`: una voce per rete vista, gravità `attenzione`, testo «Rete <cidr> vista e non censita», `href` «/cliente/reti».

**Verifica:** `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 7 prove, 0 fallite (2026-11-11). `npm run lint` → 0 errori. `npx tsc --noEmit` → 0 errori. Sul dev la pagina non è stata aperta con una sessione.

**Commit:** «Vista cliente: scheda Reti con VLAN, reti viste sul cavo e scheda dell'apparato».

---

### [x] Task 4 — Scheda Apparati

**Dal controllo del Task 3 (11/11, commit `3ac1b4d8`): passato**, 7 prove verdi rilanciate, firme come da piano, nessun link fuori dall'area; non guardato a schermo. Due ritocchi a `src/lib/cliente/schede/reti.ts` da fare in questo task, prima del resto:
1. nel riquadro, «N VLAN» conta le VLAN **distinte** (`new Set` dei `vlan` non nulli), non le reti che ne hanno una;
2. `attenzioneReti` porta al più 5 voci; se le reti viste sono di più, la quinta voce diventa «Altre N reti viste e non censite».

**Deciso da Riccardo l'11/11: gli assenti sono un quarto stato, più chiaro.** Da fare in questo task, dopo i due ritocchi. Misura sul cliente 70791: 186 accesi, 57 spenti da poco, 124 assenti.
3. `src/lib/cliente/schede/reti.ts`: `IndirizzoCliente["stato"]` diventa `"acceso" | "spento" | "assente" | "libero"`. Un host è `assente` quando soddisfa `condizioneAssente()` di `@/lib/hosts/assenti` (`status = 'offline'` e `last_seen` nullo o più vecchio di `ASSENTE_DOPO_GIORNI`): la condizione si mette nella `SELECT` degli host come colonna `assente` (0 o 1), non si ricalcola in JavaScript. `ApparatoCliente` prende il campo `assente: boolean`. `inUso` non cambia (conta solo gli accesi).
4. `src/components/cliente/griglia-indirizzi.tsx`: `assente` → `bg-muted-foreground/30`, senza bordo; resta un link come lo spento. Quattro livelli di luminosità: pieno (`bg-foreground`), grigio (`bg-muted-foreground`), chiaro (`bg-muted-foreground/30`), vuoto (solo bordo).
5. `src/app/(cliente)/cliente/reti/page.tsx`: la legenda diventa «pieno = acceso · grigio = spento · chiaro = non si vede da più di 7 giorni · vuoto = libero» (il 7 viene da `ASSENTE_DOPO_GIORNI`).
6. `src/components/cliente/scheda-apparato.tsx`: per un apparato `assente` lo stato a schermo è «non si vede da più di 7 giorni», con un'icona diversa da quella di «spento».
7. `src/lib/cliente/__tests__/reti.test.ts`: casi nuovi (non si cambiano gli esistenti): un host `offline` con `last_seen` di 10 giorni fa è `assente`; uno `offline` di ieri è `spento`; uno `offline` senza `last_seen` è `assente`.
8. In questo task (Apparati) vale la stessa distinzione: in `RigaApparato` si aggiunge `assente: boolean`; nell'elenco l'ordine è accesi, spenti, assenti; la riga di un assente dice «non si vede da <tempo>». Le voci di attenzione e `aperti` contano solo gli apparati di tipo `rete` o `server` **spenti da più di 24 ore e non assenti** (fra 1 e 7 giorni): un apparato fermo da mesi non è una notizia.

**File**
- crea `src/lib/cliente/schede/apparati.ts`, `src/lib/cliente/__tests__/apparati.test.ts`
- crea `src/app/(cliente)/cliente/apparati/page.tsx`, `src/components/cliente/pannello-porte.tsx`
- modifica `src/lib/cliente/registro.ts`: una riga in `SCHEDE_CLIENTE`

**Fonti**
- `hosts` (colonne del Task 3), `switch_ports`: `device_id`, `port_index`, `port_name`, `status` (`up` | `down` | `disabled`), `speed`, `vlan`, `is_trunk`, `is_uplink`, `host_id`, `single_mac_hostname`, `single_mac_ip`, `trunk_neighbor_name`, `trunk_primary_name`. `network_devices`: `id`, `name`, `host` (l'indirizzo), `device_type`.
- Funzioni pure di `@/lib/scheda/porte-da-guardare`: `numeroPorta`, `ePortaFisica`, `etichettaVelocita`.
- `CATEGORY_TAXONOMY` di `@/lib/attribution/taxonomy`.

**Interfacce prodotte**
```ts
export type TipoCliente = "computer" | "server" | "rete" | "stampanti" | "telefoni" | "mobili" | "altro" | "non_riconosciuti";
export const TIPI_CLIENTE: ReadonlyArray<{ tipo: TipoCliente; titolo: string; icona: string }>;
// in quest'ordine: computer «Computer» Monitor · server «Server» Server · rete «Rete» Network · stampanti «Stampanti» Printer ·
// telefoni «Telefoni» Phone · mobili «Cellulari e tablet» Smartphone · altro «Telecamere e altro» Camera · non_riconosciuti «Non riconosciuti» CircleHelp
export function tipoCliente(categoria: string | null): TipoCliente;
// compute.workstation, compute.laptop → computer; il resto di compute.* e storage.* → server; network.* → rete;
// peripheral.* → stampanti; voip.* → telefoni; mobile.* → mobili; av.*, iot.*, ot.*, power.* → altro; null o sconosciuta → non_riconosciuti
export function conteggiPerTipo(db: Database.Database): Record<TipoCliente, number>;
export interface RigaApparato { ip: string; nome: string; cosa: string; acceso: boolean; vistoIl: string | null; haPorte: boolean }
export function apparatiDelTipo(db: Database.Database, tipo: TipoCliente): RigaApparato[]; // accesi prima, poi per nome; al più 500
export interface PortaCliente {
  numero: number; nome: string; stato: "collegata" | "libera"; dorsale: boolean;
  velocita: string | null; vlan: number | null;
  attaccato: { nome: string; ip: string | null } | null; verso: string | null;
}
export function porteDelloSwitch(db: Database.Database, ip: string): PortaCliente[] | null; // null se nessuna porta letta
export const schedaApparati: SchedaCliente; // id "apparati", titolo "Apparati", ordine 20, icona "MonitorSmartphone"
```

**Regole di calcolo**
- Si contano e si elencano tutti gli host; un host con `physical_device_id` uguale a quello di un altro host già contato vale una volta sola (si tiene quello con l'IP più basso).
- `haPorte` = esiste una riga in `network_devices` con `host` = IP dell'host e almeno una riga in `switch_ports`.
- `porteDelloSwitch`: `network_devices` per `host = ip`, poi le sue `switch_ports` tenendo solo quelle per cui `ePortaFisica` è vero, ordinate per `numeroPorta`. `stato` = `collegata` se `status = 'up'`, altrimenti `libera`. `dorsale` = `is_trunk = 1` oppure `is_uplink = 1`. `attaccato` = l'host di `host_id` (nome come nel Task 3) oppure `single_mac_hostname` / `single_mac_ip`; `null` per le dorsali. `verso` = `trunk_neighbor_name`, poi `trunk_primary_name`, solo per le dorsali.

**Pagina** (`/cliente/apparati?tipo=<tipo>&ip=<ip>&porta=<n>`, due colonne 0,8 : 1,6)
- Sinistra, `Pannello` «Per tipo»: una `VoceSelezionabile` per tipo con icona e conteggio; i tipi a zero non si mostrano; «Non riconosciuti» in fondo, in grigio. Senza `tipo` nell'indirizzo è scelto il primo con conteggio maggiore di zero.
- Destra: «<titolo del tipo> · N apparati», una riga per apparato (icona acceso/spento, nome, `cosa`, a destra l'IP oppure «spento da <tempo>» con `TempoRelativo`); la riga è un link che imposta `ip`. Sotto, se c'è `ip`: se `haPorte`, `PannelloPorte`; altrimenti `SchedaApparato` del Task 3.
- `PannelloPorte`: titolo «Porte di <nome>» con la legenda «pieno = collegata · vuoto = libera · bordo spesso = dorsale»; una casella per porta col numero dentro, 12 per riga (pieno = sfondo `text-foreground` e numero chiaro; vuoto = solo bordo sottile; dorsale = bordo di 2 px, sfondo chiaro); ogni casella è un link che imposta `porta`. Sotto: «N collegate · N libere · N dorsali». Sotto ancora, se c'è `porta`: «Porta <n>» con «collegata · <velocità> · VLAN <n>» e «Chi c'è attaccato: <nome> · <ip>»; per una dorsale «verso <nome>», solo se `verso` c'è.

**Scheda nel registro**
- `attiva`: sempre `true`.
- `riquadro`: `numero` = totale apparati; `contesto` = «N accesi · N switch, N porte»; `aperti` = apparati di tipo `rete` o `server` con `status = 'offline'` e `last_seen` più vecchio di 24 ore; `stato` = `attenzione` se `aperti > 0`.
- `attenzione`: una voce per ognuno di quegli apparati (al più 5), gravità `nota`, testo «<nome> spento da <tempo>», `href` «/cliente/apparati?tipo=<tipo>&ip=<ip>».
- Attenzione al confronto di date in SQLite: `last_seen` è scritto come `AAAA-MM-GG HH:MM:SS`; si confronta con `datetime('now','-1 day')`, mai con una stringa ISO con la `T`.

**Verifica:** `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 14 prove, 0 fallite (2026-11-11). `npm run lint` → 0 errori (72 avvisi già presenti). `npx tsc --noEmit` → 0 errori. Coperti: ogni foglia di `CATEGORY_TAXONOMY`, `porteDelloSwitch` con e senza righe, due host con lo stesso `physical_device_id` contati una volta, i tre casi dell'assente, l'ordine acceso/spento/assente, le notizie solo fra 1 e 7 giorni. Sul dev la pagina non è stata aperta con una sessione. L'host «spento» della prova già esistente ha `last_seen` di ieri: senza data sarebbe assente.

**Commit:** «Vista cliente: scheda Apparati per tipo, con il pannello delle porte degli switch».

---

### [x] Task 4 bis — Resa: correzioni viste a schermo (dal controllo del Task 4)

**Controllo del Task 4 (11/11, commit `288cdde7`): passato sul codice**, 14 prove verdi rilanciate, firme come da piano. Poi casa, Reti e Apparati sono state guardate a 1920 sull'hub (cliente 70791, tema scuro). Quello che segue è ciò che a schermo non funziona. Si fa **prima del Task 5**, in un commit solo.

**File** (solo questi): `src/components/cliente/intestazione.tsx`, `griglia-indirizzi.tsx`, `pannello-porte.tsx`, `scheda-apparato.tsx`, `src/app/(cliente)/cliente/reti/page.tsx`, `src/app/(cliente)/cliente/apparati/page.tsx`, `src/lib/cliente/schede/reti.ts`, `src/lib/cliente/schede/apparati.ts`, nuovo `src/lib/cliente/testi.ts`, e le prove in `src/lib/cliente/__tests__/` (solo casi nuovi, più l'adeguamento dei casi che contano i tipi, vedi punto 9).

**Intestazione e testi**
1. **Marchio invisibile sul tema scuro**: `/logo-color.png` su fondo scuro è un rettangolo nero. Due immagini: `/logo-color.png` con classe `dark:hidden` e `/logo-white.png` con classe `hidden dark:block` (esistono entrambe in `public/`; `sidebar.tsx` riga 553 usa già la bianca).
2. **«spento da 7 giorni fa»** e **«non si vede da 26/10/2026»** sono sbagliati. Nuovo `src/lib/cliente/testi.ts`, puro e provato:
```ts
/** «da 3 ore», «da 1 giorno», «da 5 giorni»; oltre 7 giorni «dal 26/10/2026». Data illeggibile → «da tempo». */
export function daQuanto(data: Date, adesso: Date): string;
```
   Sotto 1 ora: «da meno di un'ora». Lo usano le voci di attenzione di Apparati («<nome> spento da 5 giorni») e le righe dell'elenco («spento da 5 giorni», «non si vede dal 26/10/2026»). `testoRelativo` di `console.tsx` non si usa più nell'area cliente e non si tocca.
3. **Apparati senza nome nelle voci di attenzione**: oggi «192.168.40.167 spento da…». Se il nome è l'indirizzo, la voce comincia con la categoria: «Router 192.168.40.167 spento da 5 giorni» (categoria da `nomeCategoria`, iniziale maiuscola; senza categoria resta l'indirizzo).

**Reti**
4. **Reti viste sul cavo: troppo rumore** (sul 70791 sono 25, con reti pubbliche di Internet e reti da 1 indirizzo). In `retiViste`: si scartano le reti che non sono private (si tengono solo 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) e quelle con meno di 3 indirizzi visti; ordine per indirizzi decrescente. Funzione pura `retePrivata(cidr: string): boolean` in `reti.ts`, provata (192.168.6.0/24 sì, 172.24.178.0/24 sì, 95.230.196.0/24 no, 217.28.64.0/24 no, 172.32.0.0/24 no). Le voci di attenzione restano al più 5 con la regola già scritta.
5. **La rete scelta non si distingue**: l'elenco «Le reti» usa `VoceSelezionabile` di `console.tsx`, come fa «Per tipo» in Apparati (stesso aspetto: riga scelta con fondo e bordo).
6. **«Assente» e «libero» sul tema scuro si confondono**. In `griglia-indirizzi.tsx`: `assente` → `bg-muted-foreground/50`; `libero` → `border border-dashed border-foreground/20`. La legenda a parole diventa una legenda con i quattro quadretti veri accanto alle parole («acceso», «spento», «non si vede da più di 7 giorni», «libero»), con il mattone `Legenda` di `console.tsx` se accetta un campione di classe, altrimenti quattro `span` con le stesse classi della griglia.

**Apparati**
7. **Il dettaglio finisce fuori schermo**: con 35 righe il pannello delle porte sta sotto l'elenco e non si vede che il clic ha fatto qualcosa. La pagina passa a tre colonne da 1280 px in su: `xl:grid-cols-[260px_minmax(0,1fr)_minmax(0,1fr)]` — tipi, elenco, dettaglio. Il dettaglio (`PannelloPorte` o `SchedaApparato`) sta nella terza colonna con `xl:sticky xl:top-4`. Senza apparato scelto la terza colonna mostra `Vuoto` con «Scegli un apparato per vedere i dettagli». Sotto 1280 resta com'è.
8. **La riga scelta non si distingue**: la riga dell'apparato scelto prende fondo e bordo come una `VoceSelezionabile` scelta (non solo il grassetto).
9. **«Server 150» è falso**: 99 sono macchine virtuali. Nuovo tipo `virtuali`, titolo «Macchine virtuali», icona `Boxes`, dopo «Server»: `compute.vm` → `virtuali`. `TipoCliente` e `TIPI_CLIENTE` si aggiornano; in `riquadro-modulo.tsx` non serve niente. Le prove che elencano i tipi si adeguano a questo solo cambio.
10. **Righe troppo rumorose**: nell'elenco la colonna «cosa» mostra solo categoria e produttore; il sistema operativo resta nella scheda dell'apparato. In `RigaApparato` si aggiunge `cosaBreve: string` (categoria · produttore, o «Non riconosciuto»). Dovunque si mostri il sistema, si scarta se è `Linux/Unix/embedded` oppure comincia con cifre seguite da `/` (esempio vero: `21/MikroTik router ftpd 7.22`, che è l'insegna di una porta, non un sistema): funzione pura `sistemaPulito(s: string | null): string | null` in `testi.ts`, provata.
11. **«19 switch, 512 porte»** conta anche NAS, router e firewall. `porteLette` conta solo `network_devices.device_type = 'switch'` (sul 70791: 12 switch, 386 porte).
12. **«1 dorsali»**: singolare e plurale in «N collegate · N libere · N dorsali» («1 collegata», «1 libera», «1 dorsale»).

**Tema** (Riccardo, 11/11: la vista **segue la preferenza** chiaro/scuro, non è forzata in chiaro)
13. Nell'intestazione, accanto a «Stampa», il comando per passare da chiaro a scuro: stesso gancio `useTema` e stessa resa che usa `src/components/shared/user-menu.tsx`, senza duplicarne la logica. Senza questo un utente Cliente non ha modo di scegliere, perché non vede il menu utente. Classe `nascosto-stampa`. Ogni correzione di questo task si guarda in tutti e due i temi.

**Verifica:** `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 28 prove, 0 fallite (2026-11-11). `npm run lint` → 0 errori (73 avvisi: 72 già presenti, uno nuovo sul secondo marchio, lo stesso avviso che la sidebar ha già sulle due immagini). `npx tsc --noEmit` → 0 errori. Coperti: `daQuanto`, `sistemaPulito`, `retePrivata` (i cinque CIDR), le reti pubbliche e quelle con meno di 3 indirizzi scartate, `compute.vm` → `virtuali`, la frase con la categoria quando il nome è l'indirizzo. `quantoSpento` resta com'era. L'elenco «Le reti» usa `VoceSelezionabile`. La pagina autenticata non è stata aperta, né in chiaro né in scuro.

**Commit:** «Vista cliente: correzioni di resa su casa, Reti e Apparati».

**Non di questo task (dato, non interfaccia):** `PC-LasagniF` (Windows 11 Pro) risulta «Router»: è il riconoscimento, va guardato a parte.

---

### [x] Task 4 ter — Colori del marchio Domarc

**Perché.** Riccardo, 11/11: «dovresti anche usare i colori del brandmark di Domarc, non i colori attuali». Tavola approvata da Riccardo l'11/11 **sul tema chiaro**; la resa sul tema scuro qui sotto è una proposta di chi ha scritto il task e va guardata a schermo. Si fa **dopo il Task 4 bis** (che tocca gli stessi file) e **prima del Task 6**, in un commit suo. Il tema segue la preferenza (deciso da Riccardo, Task 4 bis punto 13): niente area forzata in chiaro.

**Dal controllo del Task 4 bis (11/11, commit `bf5c3673`): passato sul codice**, 28 prove verdi rilanciate, file solo quelli elencati. Non guardato a schermo (sull'hub c'era ancora la 0.9.1147). Due ritocchi da fare in questo task, prima del resto:
1. **«Scegli un apparato per vedere i dettagli» non compare mai.** In `src/app/(cliente)/cliente/apparati/page.tsx` riga 67, senza apparato scelto la classe è `hidden xl:sticky xl:top-4`: `hidden` resta anche da 1280 px in su. Diventa `hidden xl:block xl:sticky xl:top-4`.
2. **Una funzione rimasta senza uso.** `quantoSpento` in `src/lib/cliente/schede/apparati.ts` (riga 342, «da ieri») non la chiama più nessuno dopo `daQuanto`. Si toglie, insieme al suo caso di prova in `apparati.test.ts` (è l'unica prova che si può togliere: prova una funzione che non esiste più).

**File**
- modifica `src/app/globals.css`, `src/app/(cliente)/cliente/layout.tsx`, `src/components/cliente/intestazione.tsx`, `riquadro-modulo.tsx`, `griglia-indirizzi.tsx`, `pannello-porte.tsx`, `src/app/(cliente)/cliente/dominio/page.tsx` (solo le barre)
- crea `src/components/cliente/barra.tsx`
- nessun file in `src/lib/`, nessuna prova da cambiare

**I colori, una volta sola.** In `globals.css`:
```css
.vista-cliente {
  --vc-navy: #0D2537;         /* fascia dell'intestazione, in tutti e due i temi */
  --vc-cian: #00A7E7;         /* filo dei riquadri, dorsale, barre */
  --vc-giallo: #FFD400;       /* solo: «questo è quello scelto» */
  --vc-acceso: #0D2537;       /* acceso, porta collegata */
  --vc-su-acceso: #FFFFFF;    /* numero scritto sopra --vc-acceso */
  --vc-spento: #00A7E7;
  --vc-assente: #BFE6F7;
  --vc-bordo: #9AA6AE;        /* contorno di libero e libera */
  --vc-barra-fondo: #DDF1FA;
}
.dark .vista-cliente {
  --vc-acceso: #FFFFFF;
  --vc-su-acceso: #0D2537;
  --vc-spento: #00A7E7;
  --vc-assente: #1F4E6B;
  --vc-bordo: #5B6770;
  --vc-barra-fondo: #123A55;
}
```
Nei componenti: `bg-[var(--vc-acceso)]`, `border-[var(--vc-cian)]`, ecc. Nessun valore esadecimale scritto nei componenti.

**Cosa cambia, oggetto per oggetto**
1. **Intestazione**: una fascia `bg-[var(--vc-navy)]` a tutta larghezza della finestra, in tutti e due i temi (nel layout la fascia sta fuori dal `div` centrato da 1600 px, e dentro la fascia un `div` con la stessa larghezza massima); sotto la fascia un filo `border-b border-[var(--vc-cian)]`. Il marchio è **sempre** `/logo-white.png`: questo sostituisce il punto 1 del Task 4 bis (le due immagini `dark:hidden` / `hidden dark:block` si tolgono). Testo bianco; nome del cliente in `text-[var(--vc-cian)]`; «dati delle HH:MM» bianco al 75%. «Stampa», il comando del tema, «Torna alla Dashboard» ed «Esci»: contorno bianco al 50%, testo bianco, fondo trasparente, al passaggio fondo bianco al 10%.
2. **Riquadro di un modulo**: in alto un filo di 3 px `border-t-[3px] border-t-[var(--vc-cian)]`; icona del titolo in `text-cian-testo`; al passaggio bordo `border-primary`. Fondo, numero e testi restano sui token di oggi (`bg-card`, `text-foreground`), che cambiano già col tema.
3. **Griglia degli indirizzi**: `acceso` → `bg-[var(--vc-acceso)]`; `spento` → `bg-[var(--vc-spento)]`; `assente` → `bg-[var(--vc-assente)]`; `libero` → `border border-dashed border-[var(--vc-bordo)]`, senza fondo. Queste classi sostituiscono quelle del punto 6 del Task 4 bis; la legenda coi quattro quadretti veri di quel punto resta, con queste classi. L'indirizzo scelto: anello giallo staccato, `shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--vc-giallo)]`, al posto dell'`outline`.
4. **Pannello delle porte** (`classePorta`): collegata → `bg-[var(--vc-acceso)] text-[var(--vc-su-acceso)]`; libera → `border border-[var(--vc-bordo)]`, numero in `text-muted-foreground`; dorsale → in più un filo intorno `shadow-[0_0_0_2px_var(--vc-cian)]`; porta scelta → lo stesso anello giallo del punto 3 (se è anche dorsale vince l'anello giallo). Legenda con tre caselle vere accanto alle parole: «collegata», «libera», «dorsale».
5. **Righe scelte negli elenchi**: restano come le fa il Task 4 bis (punti 5 e 8, `VoceSelezionabile`: `bg-selezione` e `border-primary` sono già colori Domarc). Niente da fare qui.
6. **Stati e gravità** (`SegnoStato`, `ElencoAttenzione`): restano su `STILE_STATO`. Non si toccano.
7. **Barre**: nuovo `src/components/cliente/barra.tsx`, `Barra({ valore, massimo }: { valore: number; massimo: number })`: barra orizzontale alta 6 px, fondo `bg-[var(--vc-barra-fondo)]`, riempimento `bg-[var(--vc-cian)]`, larghezza `valore / massimo` limitata fra 0 e 100%. La pagina Dominio e accessi (Task 5, già fatta) la usa per le aree al posto delle classi di oggi; il Task 6 la usa per i giorni, in verticale con la stessa coppia di colori e il giorno più alto in `bg-[var(--vc-acceso)]`.

**Regola che resta.** Riccardo è daltonico: gli stati della griglia si distinguono per **luminosità** (sul chiaro: scuro, medio, chiaro, vuoto tratteggiato; sullo scuro: bianco, medio, scuro, vuoto tratteggiato) e la legenda mostra i quadretti veri. Il giallo non è mai uno stato: vuol dire solo «scelto» (e «attenzione» dentro `STILE_STATO`).

**Verifica:** `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 27 prove, 0 fallite (2026-11-11). `npm run lint` → 0 errori (72 avvisi già presenti: il secondo marchio non c'è più, resta quello bianco). `npx tsc --noEmit` → 0 errori. Prima i due ritocchi: il segnaposto della terza colonna ha `xl:block`, `quantoSpento` e la sua prova sono tolti. Le pagine autenticate non sono state aperte, né in chiaro né in scuro.

**Commit:** «Vista cliente: colori del marchio Domarc».

---

### [x] Task 5 — Scheda Dominio e accessi

**Dal controllo del Task 4 (11/11, commit `288cdde7`): passato**, 14 prove verdi rilanciate, firme come da piano, quarto stato «assente» fatto come deciso; non guardato a schermo. Tre ritocchi da fare in questo task, prima del resto (misure sul cliente 70791 dell'hub):
1. **Frase sbagliata.** `tempoSpento` in `src/lib/cliente/schede/apparati.ts` usa `testoRelativo`, che rende «2 giorni fa»: la voce diventa «X spento da 2 giorni fa». Si scrive una funzione propria, senza importare da `@/components`: meno di 48 ore → «da ieri»; altrimenti «da N giorni» (N = giorni interi). La voce resta «<nome> spento <quanto>» → «SW-PIANO1 spento da 3 giorni». Una prova nuova sulla funzione.
2. **Il pannello porte si apre anche per NAS.** Sul 70791 hanno righe in `switch_ports` 9 apparati: 5 switch, 2 router e 2 NAS (`DA-FILES`, `DA-ADRA`). `ipConPorte`, `porteDelloSwitch` e `porteLette` devono filtrare `nd.device_type IN ('switch', 'router')`. Nel riquadro il contesto diventa «N accesi · N porte di rete lette» (niente conteggio degli switch). Una prova nuova: un `network_devices` di tipo `nas` con porte non dà pannello.
3. **Categorie senza foglia.** Sul 70791 ci sono 19 host con `attr_category = 'compute'` e 3 con `'storage'` (solo la radice): `nomeCategoria` rende `null` e la riga perde il «cos'è». In `src/lib/cliente/categorie.ts` si aggiungono i nomi delle radici: `compute` «computer o server», `storage` «archivio di rete», `network` «apparato di rete», `peripheral` «periferica», `av` «audio e video», `voip` «telefonia», `power` «alimentazione», `iot` e `ot` «dispositivo», `mobile` «dispositivo mobile». `tipoCliente` non cambia. Una prova nuova.

**File**
- crea `src/lib/cliente/schede/dominio.ts`, `src/lib/cliente/__tests__/dominio.test.ts`, `src/app/(cliente)/cliente/dominio/page.tsx`
- modifica `src/lib/cliente/registro.ts`: una riga in `SCHEDE_CLIENTE`

**Fonti**
- `ad_integrations` (il dominio collegato).
- `ad_health_runs`: `id`, `integration_id`, `started_at`, `status` (`running` | `ok` | `error`), `score_global`, `score_stale`, `score_privileged`, `score_trust`, `score_anomaly`. `ad_health_findings`: `run_id`, `severity`, `title`, `description`, `object_count`, `sample_dns_json`. Schema in `src/lib/ad/health/persist.ts`.
- `dc_evento` (schema in `src/lib/security/eventi-dc/db.ts`): `quando`, `event_id`, `account`, `postazione`, `ip`, `motivo`. Eventi: 4740 = account bloccato; 4625, 4771, 4776 = accesso non riuscito (`src/lib/security/eventi-dc/eventi.ts`).
- **Da leggere prima di scrivere:** in `src/lib/ad/health/` il verso del punteggio (se più alto è meglio) e i valori di `severity`; in `src/lib/security/eventi-dc/db.ts` il formato di `quando`. La pagina dell'amministratore `src/app/(dashboard)/sicurezza-dominio/` mostra già questi dati: verso, etichette e soglie si prendono da lì, non si reinventano.

**Interfacce prodotte**
```ts
export interface StatoDominio {
  punteggio: number | null; unMeseFa: number | null; controllatoIl: string | null;
  aree: Array<{ nome: string; punteggio: number }>;   // «Account fermi» score_stale · «Account con privilegi» score_privileged · «Fiducie tra domini» score_trust · «Anomalie» score_anomaly; le aree a NULL si saltano
  rilievi: Array<{ gravita: Gravita; testo: string; quanti: number; nomi: string[] }>;
}
export interface ProblemaAccesso { utente: string; tipo: "bloccato" | "falliti"; quanti: number; da: string | null; ultima: string; motivo: string | null }
export function statoDominio(db: Database.Database): StatoDominio | null;      // null se nessun giro con status 'ok'
export function problemiDiAccesso(db: Database.Database): ProblemaAccesso[];    // ultime 24 ore; [] se dc_evento non esiste
export const schedaDominio: SchedaCliente; // id "dominio", titolo "Dominio e accessi", ordine 40, icona "Users"
```

**Regole di calcolo**
- `statoDominio`: l'ultimo giro con `status = 'ok'`. `unMeseFa` = `score_global` del giro `ok` più recente fra quelli con `started_at` più vecchio di 25 giorni; se non c'è, `null`.
- `rilievi`: i rilievi di quel giro, i più gravi prima, al più 10. `testo` = `title`; `quanti` = `object_count`; `nomi` = da `sample_dns_json` (`JSON.parse` in `try/catch`), tenendo per ogni voce solo il primo pezzo del nome distinto (il valore dopo `CN=` fino alla prima virgola). `gravita`: i due livelli più alti di `severity` → `grave`, quello medio → `attenzione`, gli altri → `nota`.
- `problemiDiAccesso`: da `dc_evento` nelle ultime 24 ore, raggruppando per `account` (i vuoti e quelli che finiscono con `$` si scartano). `tipo` = `bloccato` se c'è almeno un 4740 (e `quanti` conta i 4740), altrimenti `falliti` (e `quanti` conta 4625 + 4771 + 4776, solo se almeno 5). `da` = `postazione`, poi `ip`, dell'evento più recente; `ultima` = `quando` più recente; `motivo` = `motivo` dell'evento più recente. Ordine: bloccati prima, poi per `quanti` decrescente. Al più 20.
- Se `dc_evento` non esiste (`SELECT 1 FROM sqlite_master WHERE name = 'dc_evento'`), l'elenco è vuoto.

**Pagina** (`/cliente/dominio?rilievo=<indice>`, due colonne 1 : 1,2)
- `PaginaModulo` con `contesto` «controllo del <data e ora italiana di controllatoIl>».
- Sinistra, «Stato del dominio»: punteggio grande con « su 100» e, se `unMeseFa` c'è, « · un mese fa <n>»; sotto una barra per area (nome, barra, numero). Se `statoDominio` è `null`: `Vuoto` «Il controllo del dominio non è ancora stato eseguito».
- Destra, «Cosa abbassa il punteggio»: una riga per rilievo (icona della gravità, «<quanti> · <testo>», a destra il link «vedi i nomi» che imposta `rilievo`); il rilievo scelto mostra sotto di sé i `nomi`, uno per riga. Poi «Problemi di accesso · ultime 24 ore»: una riga per problema («<utente> · bloccato <n> volte» oppure «<utente> · <n> tentativi falliti», a destra «da <da> · ultima <ora>» e il `motivo` se c'è). Senza problemi: «Nessun problema di accesso nelle ultime 24 ore».

**Scheda nel registro**
- `attiva`: esiste almeno una riga in `ad_integrations`.
- `riquadro`: `numero` = punteggio (o «—» se `null`), `unita` «su 100»; `contesto` = «stato del dominio · N accessi falliti» (somma dei `falliti`); `aperti` = numero di utenti bloccati più rilievi `grave`; `stato` = `grave` se c'è un rilievo `grave`, `attenzione` se c'è un bloccato, altrimenti `a_posto`.
- `attenzione`: una voce per utente bloccato (gravità `attenzione`, «<utente> bloccato <n> volte oggi») e una per rilievo `grave` (gravità `grave`, «<quanti> · <testo>»), `href` «/cliente/dominio».

**Verifica:** `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 22 prove, 0 fallite (2026-11-11). `npm run lint` → 0 errori (72 avvisi già presenti). `npx tsc --noEmit` → 0 errori. Coperti: nessun giro `ok` → `null`; un solo giro recente → `unMeseFa` nullo; account con `$` scartati; 4 fallimenti no, 5 sì; `quantoSpento`; un NAS non apre il pannello; le radici senza foglia hanno un nome. Sul dev la pagina non è stata aperta con una sessione. L'asserzione storica `nomeCategoria("network")` era `null`: il ritocco 3 la porta a «apparato di rete». Lo switch della prova porte ha ora `device_type` switch, altrimenti il filtro nuovo lo nasconderebbe.

**Commit:** «Vista cliente: scheda Dominio e accessi».

---

### [x] Task 6 — Scheda Log di sicurezza

**Dal controllo del Task 5 (11/11, commit `d92be786`): passato sul codice**, 22 prove verdi rilanciate, firme come da piano; i tre ritocchi del Task 4 sono fatti; le date sul database sono in formato ISO, quindi i confronti delle ultime 24 ore sono giusti. Non guardato a schermo. Tre ritocchi a `src/lib/cliente/schede/dominio.ts` da fare in questo task, prima del resto (misure sul cliente 70791: punteggio 100, 4 rilievi `Critical`, 11 `High`, 15 `Medium`, 4 `Low`; nelle ultime 24 ore 26 blocchi di un solo account):
1. **«100 su 100» sembra un voto pieno, ed è il rischio massimo.** Nel riquadro `unita` diventa «di rischio su 100» e il contesto «più alto è peggio · N accessi falliti». Nella pagina la stessa dicitura accanto al punteggio grande.
2. **I nomi non escono mai.** `sample_dns_json` sul dato vero contiene nomi semplici (`["Guest","mauri-a","nety-audit",…]`), non nomi distinti con `CN=`: `nomiDa` rende sempre un elenco vuoto e «vedi i nomi» non mostra niente. Se la voce contiene `CN=` si prende quel pezzo, altrimenti la voce così com'è (senza spazi ai lati); i doppi si tolgono. Una prova nuova con l'elenco vero qui sopra → `["Guest", "mauri-a", "nety-audit"]`.
3. **Troppi rilievi gravi in casa.** `attenzioneDominio` oggi porta una voce per ogni rilievo grave (sul 70791 sarebbero 10). Al più 3 voci di rilievo, le più gravi; se i rilievi gravi sono di più, la terza diventa «Altri N rilievi gravi nel dominio». Il conto dei gravi (per `aperti` e per questa voce) si fa su **tutti** i rilievi del giro, non sui primi 10: `statoDominio` espone in più `graviTotali: number`. Una prova nuova.

**File**
- crea `src/lib/cliente/frasi-avvisi.ts`, `src/lib/cliente/schede/log-sicurezza.ts`, `src/lib/cliente/__tests__/log-sicurezza.test.ts`, `src/app/(cliente)/cliente/log-sicurezza/page.tsx`
- modifica `src/lib/cliente/registro.ts`: una riga in `SCHEDE_CLIENTE`

**Fonti**
- `wazuh_alert_event` (schema in `src/lib/integrations/wazuh-alerts-db.ts`): `category`, `diagnostic`, `rule_level`, `rule_description`, `agent_name`, `target_user`, `occurrence_count`, `first_seen_at`, `last_seen_at`, `acknowledged`, `acknowledged_at`.
- `wazuh_agent`: `status` (`active` | `disconnected` | `pending` | `never_connected`).
- Il nome della fonte: `label` del modulo di categoria `siem` in `c.moduli`.

**Interfacce prodotte**
```ts
// src/lib/cliente/frasi-avvisi.ts
/** Frase semplice per i titoli più frequenti; se il titolo non è in tabella restituisce il titolo così com'è. */
export function fraseAvviso(titoloOriginale: string): string;

// src/lib/cliente/schede/log-sicurezza.ts
export interface AvvisoCliente { gravita: Gravita; testo: string; dove: string | null; chi: string | null; quando: string; volte: number }
export interface LogSicurezza {
  sottoControllo: number; totaleComputer: number;
  perGiorno: Array<{ giorno: string; avvisi: number }>;   // 7 elementi, dal più vecchio a oggi, giorni senza avvisi a 0
  aperti: AvvisoCliente[];                                 // i più gravi prima, poi i più recenti; al più 30
  totaleAperti: number; chiusiNelMese: number;
}
export function logSicurezza(db: Database.Database, ora: Date): LogSicurezza;
export const schedaLogSicurezza: SchedaCliente; // id "log-sicurezza", titolo "Log di sicurezza", ordine 50, icona "FileText"
```

**Regole di calcolo**
- Si contano solo le righe con `diagnostic = 0`.
- `aperti` = `acknowledged = 0`. `testo` = `fraseAvviso(rule_description)`; `dove` = `agent_name`; `chi` = `target_user`; `quando` = `last_seen_at`; `volte` = `occurrence_count`. `gravita`: `rule_level >= 12` → `grave`; `>= 7` → `attenzione`; altrimenti `nota`.
- `chiusiNelMese` = `acknowledged = 1` con `acknowledged_at` negli ultimi 30 giorni.
- `perGiorno`: righe con `last_seen_at` negli ultimi 7 giorni, contate per giorno italiano (come `giornoItaliano` in `src/lib/security/kpi-dashboard.ts`).
- `sottoControllo` = `wazuh_agent` con `status = 'active'`; `totaleComputer` = tutte le righe di `wazuh_agent`.
- **Prima di scrivere `frasi-avvisi.ts`:** sull'hub (cliente 70791) si misurano i 20 `rule_description` più frequenti con un `GROUP BY`, e la tabella nasce da quelli. La misura si scrive nel task come riga di verifica.

**Pagina** (`/cliente/log-sicurezza`, due colonne 1 : 1,2)
- `PaginaModulo` con `contesto` «fonte: <label del modulo> · <sottoControllo> computer sotto controllo su <totaleComputer>».
- Sinistra, «Avvisi negli ultimi 7 giorni»: sette barre verticali, la più alta con sfondo `text-foreground`, le altre `text-muted-foreground`, sotto ogni barra il giorno («lun», «mar», …) e sopra il numero. Sotto: «<totaleAperti> aperti · <chiusiNelMese> chiusi nel mese · <totaleComputer − sottoControllo> computer senza controllo».
- Destra, «Avvisi aperti»: una riga per avviso (icona della gravità, `testo`, «× <volte>» se maggiore di 1, a destra «<dove> · <tempo>» con `TempoRelativo`). Senza avvisi: «Nessun avviso aperto».
- Nessun numero di regola, nessun livello, nessun pulsante per prendere in carico.

**Scheda nel registro**
- `attiva`: `moduloAttivo(c, "siem")`.
- `riquadro`: `numero` = `totaleAperti`; `contesto` = «avvisi aperti · <chiusiNelMese> chiusi nel mese»; `aperti` = `totaleAperti`; `stato` = `grave` se c'è un aperto `grave`, `attenzione` se ce n'è almeno uno, altrimenti `a_posto`.
- `attenzione`: una voce per ogni aperto `grave` (al più 5), testo «<testo> su <dove>», `href` «/cliente/log-sicurezza».

**Verifica:** `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 32 prove, 0 fallite (2026-11-11). `npm run lint` → 0 errori (72 avvisi già presenti). `npx tsc --noEmit` → 0 errori. Coperti: `fraseAvviso` con un titolo in tabella e uno fuori; le righe `diagnostic = 1` escluse; sette giorni sempre presenti, dal 5 all'11 novembre con un solo avviso il 9; nomi `["Guest","mauri-a","nety-audit"]`; 12 rilievi gravi, in casa la terza voce è «Altri 10 rilievi gravi nel dominio». L'asserzione storica del CN teneva fuori «senza cn»: il ritocco 2 lo tiene, perché non c'è `CN=`. Misura sul cliente 70791, 11/11/2026, `diagnostic = 0` (210 righe su 248), i 20 titoli da cui nasce la tabella: sshd brute force utente inesistente 16, sshd authentication failed 15, PAM login failed 15, sshd non-existent user 14, Logon Failure 14, syslog authentication failure 12, New user 12, New group 12, PAM multiple failed 10, Multiple Windows Logon Failures 10, account locked out 9, unix_chkpwd 8, Windows Audit Policy changed 8, User account changed 7, Proxmox authentication failed 7, sshd brute force authentication failed 6, Windows DC Logon Failure 3, account enabled or created 3, Maximum authentication attempts 3, NTLM utente inesistente 2. La pagina autenticata non è stata aperta.

**Commit:** «Vista cliente: scheda Log di sicurezza».

---

### [ ] Task 6 bis — Log di sicurezza: gli ultimi 7 giorni per tipo

**Perché.** Riccardo, 11/11. La scheda conta gli avvisi «aperti», cioè mai presi in carico. Sul cliente 70791 sono 209 (110 di livello medio, nessuno grave) e l'ultimo preso in carico è del 27/07: nessuno li chiude, quindi al cliente il numero crescerebbe sempre. Si mostra invece **cosa è successo negli ultimi 7 giorni, raggruppato per tipo**. Le parole «aperti», «chiusi», «presi in carico» spariscono dalla vista cliente. Si fa **prima del Task 7**, in un commit suo.

**File**
- modifica `src/lib/cliente/schede/log-sicurezza.ts`, `src/lib/cliente/__tests__/log-sicurezza.test.ts`, `src/app/(cliente)/cliente/log-sicurezza/page.tsx`
- qui le prove esistenti che parlano di `aperti`, `totaleAperti` e `chiusiNelMese` **si riscrivono**: quei campi non esistono più (è l'unica eccezione alla regola 4)

**Interfacce (sostituiscono quelle del Task 6)**
```ts
export interface TipoAvviso {
  gravita: Gravita;
  testo: string;      // fraseAvviso(rule_description)
  avvisi: number;     // righe del tipo negli ultimi 7 giorni
  computer: number;   // agent_name distinti (i vuoti non contano)
  ultima: string;     // last_seen_at più recente del tipo
}
export interface LogSicurezza {
  sottoControllo: number; totaleComputer: number;
  perGiorno: Array<{ giorno: string; avvisi: number }>;   // com'è oggi
  tipi: TipoAvviso[];                                      // al più 30
  totaleSettimana: number;                                 // somma di perGiorno
}
export function logSicurezza(db: Database.Database, ora: Date): LogSicurezza;   // firma invariata
```
`AvvisoCliente` si toglie.

**Regole di calcolo**
- Finestra: la stessa di `perGiorno` (dalla mezzanotte italiana di sei giorni fa a ora), righe con `diagnostic = 0`. La colonna `acknowledged` non si legge più.
- Un tipo = le righe con la stessa `fraseAvviso(rule_description)` (descrizione vuota → «Avviso»).
- `gravita` del tipo = quella della riga col `rule_level` più alto (`>= 12` grave, `>= 7` attenzione, altrimenti nota: le soglie di oggi).
- Ordine: grave, attenzione, nota; a parità `avvisi` decrescente, poi `testo`.
- `istanteSql` e le letture su `acknowledged_at` si tolgono se restano senza uso.

**Pagina**
- Sinistra: le sette barre restano. La riga sotto diventa «<totaleSettimana> avvisi in 7 giorni · <sottoControllo> computer sotto controllo su <totaleComputer>» e, solo se la differenza è maggiore di zero, « · <n> senza controllo».
- Destra: pannello «Cosa è successo negli ultimi 7 giorni», una riga per tipo: icona della gravità, `testo`, «<avvisi> avvisi su <computer> computer» (singolari: «1 avviso», «1 computer»; con `computer` a zero solo «<avvisi> avvisi»), a destra «l'ultimo <daQuanto(ultima)>» con `daQuanto` di `@/lib/cliente/testi` (esce «l'ultimo da 3 ore», «l'ultimo da 2 giorni»). Senza tipi: «Nessun avviso negli ultimi 7 giorni».

**Scheda nel registro**
- `riquadro`: `numero` = `totaleSettimana`; `contesto` = «avvisi in 7 giorni · <n> tipi» (singolare «1 tipo»); `aperti` = numero di tipi `grave` o `attenzione`; `stato` = `grave` se c'è un tipo `grave`, `attenzione` se c'è un tipo `attenzione`, altrimenti `a_posto`.
- `attenzione`: una voce per ogni tipo `grave` (al più 3), gravità `grave`, testo «<testo> · <avvisi> avvisi su <computer> computer», `href` «/cliente/log-sicurezza». I tipi `attenzione` non entrano in casa: restano nella scheda.

**Verifica:** `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` verde. Casi: due righe con la stessa frase e computer diversi → un tipo, 2 avvisi, 2 computer; una riga di 8 giorni fa non conta; una riga `diagnostic = 1` non conta; un tipo con una riga di livello 12 e una di livello 5 è `grave`; una riga già presa in carico (`acknowledged = 1`) **conta** come le altre.

**Commit:** «Vista cliente: i log di sicurezza mostrano gli ultimi 7 giorni per tipo».

---

### [x] Task 7 — Scheda Da sistemare

**Corretto l'11/11 dopo lo stop (aveva ragione chi esegue):** l'elenco dei rilievi non porta gli host e si ferma a 200 righe. Non serve: `elencoRilievi` sa già raggruppare **per host su tutte le pagine**, con la gravità che il rilievo ha su quell'host. La scheda legge i gruppi, non le righe. Fonti, interfacce e regole qui sotto sono riscritte; il task riparte da capo.

**File**
- crea `src/lib/cliente/schede/da-sistemare.ts`, `src/lib/cliente/__tests__/da-sistemare.test.ts`, `src/app/(cliente)/cliente/da-sistemare/page.tsx`
- modifica `src/lib/cliente/registro.ts`: una riga in `SCHEDE_CLIENTE`
- **non** si modifica niente in `src/lib/rilievi/`

**Fonti (verificate nel codice l'11/11)**
- `elencoRilievi(filtro)` di `@/lib/rilievi/unione`, chiamata **una volta sola**, dentro il contesto del cliente, così:
```ts
elencoRilievi({
  gravita: ["Critical", "High"],
  raggruppa: "host",
  conIndicatori: true,
  pageSize: 200,
  exploitDi: exploitPerRotte().exploitDi,   // come in src/lib/rilievi/barre-di-serie.ts
  cvssDi: cvssPerRotte(),                   // idem
})
```
- Dal risultato servono:
  - `gruppi: GruppoRilievi[]` (tipo in `src/lib/rilievi/gruppi.ts` riga 20): un gruppo per host, calcolato su **tutti** i rilievi filtrati, non sulla pagina. Di ogni gruppo: `tipo` (si tengono solo quelli con `tipo === "host"`: il gruppo «Senza un host preciso» ha `tipo === "senza"` e si scarta), `chiave`, `nome`, `dettaglio` (indirizzo e rete, già composto, o `null`), `gravita.Critical`, `gravita.High` (contati con la gravità che il rilievo ha su quell'host), `anteprima` (i titoli dei suoi rilievi, i più gravi in testa).
  - `data: RilievoUnito[]` (al più 200 righe, le più gravi prima): serve **solo** per ricavare il rimedio dal titolo (`titolo`, `rimedio`) e la data dell'ultimo controllo (`visto`).
  - `perRete: BarraRete[]` (c'è perché `conIndicatori` è vero; campi `critical` e `high`): **non** si usa per i totali, perché qui il filtro per gravità cambia il conto. I totali si prendono da `barreReteDiSerie()` di `@/lib/rilievi/barre-di-serie`, che è la fonte della Dashboard.
- `Severity` è `"Critical" | "High" | "Medium" | "Low"` (`src/lib/severity-style.ts`).

**Interfacce prodotte**
```ts
export interface DaSistemareApparato { chiave: string; nome: string; dettaglio: string | null; gravi: number; alte: number; cosa: string; rimedio: string | null }
export interface DaSistemare { ultimoControllo: string | null; gravi: number; alte: number; apparati: DaSistemareApparato[] }
/** Pura: dai gruppi per host e dalle righe (per i rimedi) alle righe della scheda. Provata con dati finti. */
export function perApparato(
  gruppi: readonly Pick<GruppoRilievi, "chiave" | "tipo" | "nome" | "dettaglio" | "gravita" | "anteprima">[],
  righe: readonly Pick<RilievoUnito, "titolo" | "rimedio">[],
): DaSistemareApparato[];
export function daSistemare(c: ContestoCliente): DaSistemare;
export const schedaDaSistemare: SchedaCliente; // id "da-sistemare", titolo "Da sistemare", ordine 30, icona "Wrench"
```

**Regole di calcolo**
- Solo gravità critica e alta: lo fa il filtro `gravita` della chiamata. Media e bassa non si mostrano.
- `perApparato`: si tengono i gruppi con `tipo === "host"` e con `gravita.Critical + gravita.High > 0`. Per ognuno: `gravi` = `gravita.Critical`; `alte` = `gravita.High`; `cosa` = `anteprima[0]` (se manca, «Rilievo senza titolo»); `rimedio` = il `rimedio` della prima riga di `righe` con lo stesso `titolo` di `cosa`, senza spazi ai lati (stringa vuota o titolo non trovato → `null`). Ordine: `gravi` decrescente, poi `alte` decrescente, poi `nome`. Al più 100 apparati.
- `gravi` e `alte` totali della scheda = somma di `critical` e di `high` su `barreReteDiSerie()`, così coincidono con «Critiche da sistemare» e «Alte da sistemare» della Dashboard.
- `ultimoControllo` = il `visto` più recente fra le righe di `data` (`null` se non ce n'è).
- Se `elencoRilievi` lancia, la scheda mostra «Dato non disponibile» e l'errore va in `console.error("[cliente] da sistemare: …")`.

**Pagina** (`/cliente/da-sistemare`, una colonna)
- `PaginaModulo` con `contesto` «ultimo controllo: <data italiana>».
- `Pannello` «Per apparato, dal più grave»: una riga per apparato: icona (triangolo se `gravi > 0`, cerchio con esclamativo altrimenti), nome in evidenza con `dettaglio` accanto in piccolo, «<gravi> gravi · <alte> alte» (le parti a zero si saltano), `cosa`, e a destra «rimedio: <rimedio>» se c'è. Senza apparati: «Niente da sistemare».
- Nessuna sigla CVE, nessun punteggio, nessun dettaglio dell'attacco, nessun link alla pagina Findings.

**Scheda nel registro**
- `attiva`: `moduloAttivo(c, "va") || moduloAttivo(c, "siem")`.
- `riquadro`: `numero` = `gravi + alte`; `contesto` = «<gravi> gravi · <alte> alte»; `aperti` = `gravi + alte`; `stato` = `grave` se `gravi > 0`, `attenzione` se `alte > 0`, altrimenti `a_posto`.
- `attenzione`: una voce per ogni apparato con `gravi > 0` (al più 5), gravità `grave`, testo «<gravi> problemi gravi su <nome>» (singolare se 1), `href` «/cliente/da-sistemare».

**Verifica:** `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 36 prove, 0 fallite (2026-11-11). `npm run lint` → 0 errori (72 avvisi già presenti). `npx tsc --noEmit` → 0 errori. Coperti: il gruppo `tipo: "senza"` scartato; un gruppo senza critici né alti scartato; rimedio trovato dal titolo; rimedio vuoto (la riga successiva con lo stesso titolo non conta) → `null`; ordine Gamma, Beta, Alfa, Zeta. I totali del riquadro sono la somma di `barreReteDiSerie()`, la stessa funzione di «Critiche da sistemare» e «Alte da sistemare»: il confronto sullo stesso cliente non è stato fatto, questo worktree non ha il database del cliente e la pagina autenticata non è stata aperta.

**Commit:** «Vista cliente: scheda Da sistemare».

---

### [ ] Task 8 — Stampa, documenti, prova sull'hub

**File**
- modifica `src/app/globals.css`: un blocco `@media print` limitato all'area (classe `vista-cliente` sul contenitore del layout del Task 2): si nascondono «Stampa», «Esci», «Torna alla Dashboard» e i link «← La tua rete»; i riquadri non si spezzano fra due pagine (`break-inside: avoid`); sfondo bianco
- modifica `CONTEXT.md`: sezione «Vista cliente — 11/11/2026»: cos'è, l'utente «Cliente» e il recinto, e la ricetta per un modulo nuovo (un file in `src/lib/cliente/schede/`, una riga in `SCHEDE_CLIENTE`, una cartella in `src/app/(cliente)/cliente/<id>/`)
- modifica `docs/MANUALE-UTENTE.md`: come creare un utente «Cliente» (Impostazioni → Utenti → Nuovo utente → Ruolo «Cliente (vista semplice)» → un solo cliente) e cosa vede
- modifica `CHANGELOG.md`, `TASKS.md`, e `docs/scheda-mappa.md` (una riga: esiste la vista cliente)

**Cosa fare**
- Anteprima di stampa della casa e di una pagina interna, guardata una volta.
- `npm run lint && npx tsc --noEmit && npm run build`, poi `bash scripts/controlla.sh` **una volta sola**, in sottofondo; l'esito si legge dal codice di uscita.
- Sull'hub (VM 533, `192.168.4.8`), dopo che il servizio ha preso il commit: utente «Cliente» di prova sul cliente 70791. Entra, vede la casa, apre ogni scheda attiva; `/settings` lo riporta a `/cliente`; `GET /api/hosts` risponde 403.
- Niente su `main`: il passaggio lo decide Riccardo.

**Verifica:** le quattro righe della prova sull'hub, scritte qui sotto il task con data e ora.

**Commit:** «Vista cliente: stampa e documenti».

---

## Non in questo piano

- «Lo segue Domarc» accanto a un problema: il dato non esiste. Si aggiunge quando c'è una fonte.
- Telefono, rapporto periodico per posta, marchio del cliente.
- Moduli futuri (patch, backup, Wi-Fi): nascono dopo, come file in più.
- Il riepilogo per macro categoria nelle pagine Reti e Discovery dell'amministratore (punto E del 10/11): qui si fa solo quello della vista cliente.

## Come si controlla ogni task

Chi controlla, per ogni task consegnato: legge `git diff` del commit; verifica che i file toccati siano solo quelli elencati; rilancia le prove del task; confronta nomi e firme con le «Interfacce prodotte»; cerca nell'area `fetch(` con metodo diverso da GET e link fuori da `/cliente`; guarda la pagina una volta a 1920 sul dev. Un task passa solo se ha la riga `Verifica:` con comando ed esito.

## Registro

- 2026-11-11 Task 1 [!]: fermo prima del codice. L'`ALTER` idempotente non sta in `db-hub-schema.ts` (solo `CREATE TABLE`); sta in `initializeHubDb` di `src/lib/db-hub.ts` (righe 467-493), file fuori elenco. Vitest non è nel progetto: le prove usano `node:test`. Nessun ripiego.

- 2026-11-11 Piano corretto dopo lo stop del Task 1: colonna `vista_cliente` in `CREATE TABLE` (`db-hub-schema.ts`) e nell'elenco `nuove` di `initializeHubDb` (`db-hub.ts`); prove con `node --import tsx --test` in tutti i task. Task 1 torna `[ ]`.

- 2026-11-11 Task 1 [x]: utente Cliente e recinto. Verifica: `node --import tsx --test src/lib/cliente/__tests__/*.test.ts src/lib/users/__tests__/*.test.ts` → 62 prove, 0 fallite. lint 0 errori, tsc 0 errori.

- 2026-11-11 Controllo del Task 1: passato (commit `3a0da573`, 62 prove verdi rilanciate). Aggiunto il Task 1 bis: il cambio del segno chiude le sessioni aperte.

- 2026-11-11 Task 1 bis [x]: il cambio del segno chiude le sessioni. Verifica: `node --import tsx --test src/lib/users/__tests__/*.test.ts` → 61 prove, 0 fallite.

- 2026-11-11 Task 2 [x]: template, registro delle schede e casa. Verifica: `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 4 prove, 0 fallite. lint 0 errori, tsc 0 errori.

- 2026-11-11 Controllo dei Task 1 bis (`9d99898e`) e 2 (`13681f8f`): passati, 65 prove verdi rilanciate. Non guardata a schermo la casa. Correzione aggiunta al Task 3: niente vista cliente su «tutti i clienti».

- 2026-11-11 Task 3 [x]: scheda Reti. Prima la correzione: senza un cliente in sessione, o con «tutti i clienti», la vista torna alla Dashboard. Verifica: `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 7 prove, 0 fallite. lint 0 errori, tsc 0 errori.

- 2026-11-11 Controllo del Task 3 (`3ac1b4d8`): passato, 7 prove verdi rilanciate. Due ritocchi messi in testa al Task 4. Aperta una decisione per Riccardo sugli host assenti (124 su 367 sul cliente 70791).

- 2026-11-11 Riccardo: gli host assenti (spenti da più di 7 giorni) sono un quarto stato, più chiaro. Scritto in testa al Task 4, punti 3-8.

- 2026-11-11 Task 4 [x]: scheda Apparati. Prima i due ritocchi alle reti e il quarto stato assente. Verifica: `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 14 prove, 0 fallite. lint 0 errori, tsc 0 errori. La pagina autenticata non è stata aperta.

- 2026-11-11 Controllo del Task 4 (`288cdde7`): passato, 14 prove verdi rilanciate. Tre ritocchi messi in testa al Task 5 (frase «spento da», pannello porte solo per switch e router, nomi delle categorie senza foglia).

- 2026-11-11 Controllo del Task 4 (`288cdde7`): passato sul codice, 14 prove verdi. Resa guardata a 1920 sull'hub (casa, Reti, Apparati): 12 correzioni scritte nel Task 4 bis.

- 2026-11-11 Task 5 [x]: scheda Dominio e accessi. Prima i tre ritocchi. Verifica: `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 22 prove, 0 fallite. lint 0 errori, tsc 0 errori. La pagina autenticata non è stata aperta.

- 2026-11-11 Riccardo: colori del marchio Domarc nella vista cliente (tavola approvata sul tema chiaro). Aggiunto il Task 4 ter, dopo il 4 bis e prima del 6; sostituisce i punti 1 e 6 (classi) del 4 bis. Il tema segue la preferenza.

- 2026-11-11 Controllo del Task 5 (`d92be786`): passato sul codice, 22 prove verdi rilanciate. Tre ritocchi messi in testa al Task 6 («100 su 100» è il rischio, nomi mai mostrati, troppi rilievi gravi in casa).

- 2026-11-11 Task 4 bis [x]: correzioni di resa su casa, Reti e Apparati (scritto prima del Task 5, eseguito dopo, il Task 5 resta). Verifica: `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 28 prove, 0 fallite. lint 0 errori, tsc 0 errori. La pagina autenticata non è stata aperta.

- 2026-11-11 Controllo del Task 4 bis (`bf5c3673`): passato sul codice, 28 prove verdi rilanciate. Due ritocchi in testa al Task 4 ter (segnaposto della terza colonna mai visibile, funzione `quantoSpento` rimasta senza uso).

- 2026-11-11 Task 4 ter [x]: colori del marchio Domarc. Prima i due ritocchi. Verifica: `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 27 prove, 0 fallite. lint 0 errori, tsc 0 errori. Le pagine autenticate non sono state aperte.

- 2026-11-11 Task 6 [x]: scheda Log di sicurezza. Prima i tre ritocchi a Dominio. Verifica: `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 32 prove, 0 fallite. lint 0 errori, tsc 0 errori. La pagina autenticata non è stata aperta. La tabella delle frasi nasce dalla misura sul 70791 (210 avvisi veri, 20 titoli).

- 2026-11-11 Task 7 [!]: fermo prima del codice. `elencoRilievi` non restituisce `ospiti` (unione.ts riga 399) e taglia `pageSize` a 200 (riga 392): non si può raggruppare per apparato né leggere tutte le righe. Nessun ripiego.

- 2026-11-11 Piano corretto dopo lo stop del Task 7: la scheda legge i gruppi per host di `elencoRilievi` (`raggruppa: "host"`), non le righe; rimedio dal titolo. Task 7 torna `[ ]`.

- 2026-11-11 Controllo dei Task 4 ter e 6 (consegnati senza passare dal controllo, fino alla v0.9.1154): passati sul codice, 32 prove verdi rilanciate; ritocchi dei controlli precedenti tutti fatti; nessun colore scritto nei componenti; formati delle date degli avvisi verificati sull'hub. Non guardati a schermo. Aperta una decisione per Riccardo sugli avvisi «aperti» (209 sul 70791, ultimo «preso in carico» a luglio).

- 2026-11-11 Riccardo: nei Log di sicurezza si mostrano gli ultimi 7 giorni per tipo, non gli avvisi «aperti». Aggiunto il Task 6 bis, prima del Task 7.

- 2026-11-11 Task 7 [x]: scheda Da sistemare, dai gruppi per host. Verifica: `node --import tsx --test src/lib/cliente/__tests__/*.test.ts` → 36 prove, 0 fallite. lint 0 errori, tsc 0 errori. La pagina autenticata non è stata aperta. I totali del riquadro passano da `barreReteDiSerie()`, come la Dashboard; il confronto sullo stesso cliente non è stato fatto.

- 2026-11-11 Controllo del Task 7 (`4de0b8a5`): il codice è come da piano, 36 prove verdi rilanciate. **Sul dato vero però la scheda non regge** (misura sull'hub, cliente 70791): i gruppi per host contano ogni CVE (una riga direbbe «374 gravi · 2211 alte» mentre il riquadro dice 124 e 385), la «cosa più grave» è una sigla (`CVE-2025-55315`, `controllo:tls-deep:…`), il rimedio si trova per 10 apparati su 92. Errore del piano, non di chi esegue. In attesa di una decisione di Riccardo: passare alla vista per software.

## Consuntivo
### Fatto
### Mancante
### Scostamenti dal piano
### Consigli di sviluppo

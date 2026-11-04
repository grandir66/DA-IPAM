# WMI nella scansione quando WinRM è chiuso — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` oppure in linea
> (una sessione che esegue i task in ordine). Le caselle `- [ ]` tengono il conto.

**Obiettivo:** nelle reti senza WinRM, la scansione prova la credenziale Windows via WMI su ogni macchina con 135 aperta, senza fermarsi ai primi rifiuti e senza rischiare il blocco degli account di dominio.
**Architettura:** nuovo protocollo di credenziale `wmi` (porta 135), accanto a `winrm`, con una prova leggera di sola identità. Una verifica unica della password per esecuzione distingue «password errata» da «diritti mancanti»: solo il primo caso consuma il budget anti-blocco.
**Spec:** nessun documento separato. Requisiti da Riccardo il 04/11/2026 (72729, sezione in `TASKS.md`): «in assenza di winrm wmi funzionasse», «potrebbero esserci tante macchine windows che rispondono wmi con account di dominio».
**Livello di controllo:** completo, proposto da Claude perché tocca credenziali e migrazione del database. Da confermare da Riccardo.
**Stato:** bozza · **Ultimo aggiornamento:** 2026-11-04

## Vincoli globali

- Tutto parte da Riccardo: nessuna scansione nuova sui clienti senza il suo sì.
- `MAX_CONSECUTIVE_FAILURES_PER_RUN` resta 3 e non cambia significato per le password errate o non verificabili.
- Un solo tentativo WMI per credenziale e per host in ogni esecuzione, e si smette alla prima voce valida (`validatedProtos`, fix C2 del 2026-06-23).
- La password non passa mai negli argomenti di un processo: resta su stdin come in `runWmiProbe`.
- Le prove esistenti non si toccano per farle passare.
- Niente WMI se 5985 o 5986 è aperta: lì vale WinRM.
- Il dato resta in sola lettura verso le macchine: WQL su `Win32_ComputerSystem`, nessun metodo WMI.
- Cancello di DA-IPAM (non esiste `scripts/controlla.sh`): `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.
- Ogni commit di codice su `dev` chiude con `npm run version:release` e push (`CLAUDE.md`, regola 1). Mai push su `main`: avanza solo con la promozione `dev`→`main` dalla UI, ed è un rilascio alle appliance, da confermare da Riccardo.
- `db-tenant` si importa solo staticamente (`CLAUDE.md`, regola 14), anche nei file nuovi: niente `await import()` di quel modulo.
- Niente `any` (regola 13): in `wmi-run.ts` e nelle prove i tipi sono dichiarati.

## Passi

| ID | Stato | Passo | Agente | Dipende da | Fatto quando | Verifica |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | [ ] | Misura sul 72729 col codice di oggi | orchestratore | sì di Riccardo | numero di PC che accettano l'account è noto | tabella nel Registro |
| S1 | [ ] | Prova leggera di identità | implementer | — | `runWmiIdentita` provata | `node --import tsx --test src/lib/devices/__tests__/wmi-identita.test.ts` |
| S2 | [ ] | Protocollo `wmi` e migrazione | implementer | — | migrazione provata su database vero in memoria | `npx tsc --noEmit` e prova di migrazione |
| S3 | [ ] | Verifica della password per esecuzione | implementer | — | tre esiti provati | prova del task |
| S4 | [ ] | Budget: «negato» diverso da «fallito» | implementer | S3 | prove nuove viste fallire, poi verdi | prova del task |
| S5 | [ ] | Discovery: i due punti di validazione | implementer | S1 S2 S3 S4 | ramo WMI e porta chiusa provati | prova del task + cancello |
| S6 | [ ] | Apparato, testi e manuale | implementer | S2 S5 | pagina resa ≥1280 | verifica resa |
| S7 | [ ] | Collaudo sul 72729 | orchestratore | S0-S6 e rilascio approvato | risultato uguale a S0 o migliore | tabella nel Registro |

## Casi da non dimenticare

1. Porta 5985 chiusa: oggi `runWinrmCommand` fallisce e `runBudget.recordFailure` conta quell'host, senza alcun login. Con quattro PC così la voce è esclusa dall'esecuzione: coperto dal Task 5.
2. Password giusta e diritti mancanti sui primi tre PC: non deve escludere il quarto. Coperto dal Task 4.
3. Password errata per davvero: nessun tentativo WMI su nessun PC. Coperto dai Task 3 e 5.
4. Account locale o nessuna integrazione AD: la verifica dà «non_so» e vale il budget di oggi, 3 e stop. Coperto dai Task 3 e 4.
5. Windows 7, dove la 135 risponde ma il namespace può comportarsi diversamente: il rifiuto o l'errore si registrano sull'host senza fermare gli altri. Coperto dai Task 1 e 5.

## Task

### [ ] Task 0 — Misura sul 72729 col codice di oggi (S0)

Serve a sapere quanto vale il lavoro prima di scriverlo. Nessuna modifica al codice.

- **Dove:** VM 100 sul nodo `pve`, script temporaneo in `/opt/da-ipam`, tolto a fine prova, come il 04/11.
- **Cosa fare:** con la voce `WinRM`, prima un login LDAP su `192.168.0.10`. Se non riesce ci si ferma. Poi `runWmiProbe` una volta per host, uno alla volta, sugli host di rete 1 con 135 aperta e 5985/5986 chiuse, esclusi stampanti e DC.
- **Stampa:** IP, nome, esito (`ok` / `AUTH_REJECTED` / altro codice), mai utente o password.
- **Verifica:** tabella nel Registro.
- **Decisione:** se nessun PC accetta l'account, si aspetta l'account amministratore dal loro IT prima di S1.

### [ ] Task 1 — Prova leggera di identità (S1)

**File**
- Modifica: `src/lib/devices/wmi-bridge.py`, dopo `NTLMLogin` e la definizione di `query()`.
- Modifica: `src/lib/devices/wmi-run.ts`.
- Crea: `src/lib/devices/__tests__/wmi-identita.test.ts`.

**Interfacce prodotte**

```ts
export interface WmiIdentita { hostname: string; dominio: string | null }
export async function runWmiIdentita(
  host: string, username: string, password: string,
): Promise<WmiIdentita>;
```

**Cosa fare**
- Nel bridge, con `req.get("solo_identita")` vero: una sola query `SELECT Name,Domain FROM Win32_ComputerSystem`, risposta `{"data":{"hostname":…,"domain":…},"transport":"wmi/dcom"}`, poi disconnessione nello stesso `finally`.
- In `wmi-run.ts`, riusare controllo della 135, `findBridgePython`, stdin e classificazione errori di `runWmiProbe`. Estrarre un `eseguiBridge(input)` interno senza cambiare il comportamento di `runWmiProbe`.
- `hostname` vuoto: `WmiError` con codice `UNKNOWN`.

**Verifica:** prova con `execFile` finto (identità buona, `AUTH_REJECTED`, 135 chiusa), vista fallire prima del codice. Poi `node --import tsx --test src/lib/devices/__tests__/wmi-identita.test.ts`.

**Commit:** `WMI: prova leggera di identità`.

### [ ] Task 2 — Protocollo `wmi` e migrazione (S2)

**File** (il compilatore segnala gli altri `Record<CredProtocol, …>`)
- `src/lib/credentials/porte.ts`: `CredProtocol` con `"wmi"`, `DEFAULT_PORTS.wmi = 135`.
- `src/lib/credentials/tipi.ts`: `tipiPerProtocollo("wmi")` e `TIPI_PROPRI.wmi` = `windows`.
- `src/lib/credentials/lega-voce.ts`, `src/lib/credentials/converti-apparati.ts`.
- `src/lib/db.ts:3947, 3995, 4048, 5278`: unioni di tipo.
- `src/lib/scanner/discovery.ts:155`: `autoBindCredentialToDevice`.
- `src/app/api/hosts/[id]/credentials/route.ts:31` e `src/app/api/devices/[id]/credentials/route.ts:60,118`: `z.enum`.
- `src/lib/db-schema.ts:535`, `src/lib/db-tenant-schema.ts:1109,1153`: CHECK con `'wmi'`.
- `src/lib/db-tenant.ts`, dopo la migrazione di riga 2581: due ricostruzioni nuove, `host_credentials` e `device_credential_bindings`, condizione `!row.sql.includes("'wmi'")`, stessa forma di quelle `redfish`.
- Crea: `src/lib/__tests__/migrazione-protocollo-wmi.test.ts`.

**Cosa fare**
- La lettura delle credenziali dell'apparato (`loginApparatoDb`) deve accettare un legame `wmi` quando il protocollo dell'apparato è `winrm`.
- Il sì a `avviaChocoDopoCredenziali` resta solo su `winrm`: Chocolatey senza WinRM non gira.

**Verifica:** database SQLite vero con lo schema precedente e righe presenti, migrazione, righe intatte, inserimento `wmi` accettato, secondo avvio senza effetto. Il valore al limite si scrive sul database vero, non su un doppio. `npx tsc --noEmit`.

**Commit:** `Credenziali: protocollo wmi`.

### [ ] Task 3 — Verifica della password per esecuzione (S3)

**File**
- Crea: `src/lib/scanner/verifica-password-run.ts`.
- Crea: `src/lib/scanner/__tests__/verifica-password-run.test.ts`.

**Interfacce prodotte**

```ts
export type EsitoPassword = "valida" | "errata" | "non_so";
export class VerificaPasswordRun {
  constructor(prova: (credId: number) => Promise<EsitoPassword>);
  /** Una sola prova per voce in tutta l'esecuzione. */
  esito(credId: number): Promise<EsitoPassword>;
}
export function provaLdapDellaVoce(credId: number): Promise<EsitoPassword>;
```

**Cosa fare**
- `provaLdapDellaVoce`: login LDAP sulla prima integrazione AD accesa, con la stessa sequenza di `connectLdap` (StartTLS tentato, poi bind).
- `InvalidCredentialsError` con `data 52e`: `errata`. Bind riuscito: `valida`.
- Tutto il resto dà `non_so`: nessuna integrazione, DC che non risponde, timeout, account bloccato, utente locale senza dominio. Un errore di trasporto non è una risposta.
- Il risultato si tiene in memoria solo per l'esecuzione e non si scrive da nessuna parte.

**Verifica:** i tre esiti, più due chiamate per la stessa voce che fanno una sola prova. Viste fallire prima del codice.

**Commit:** `Scansione: verifica la password una volta per esecuzione`.

### [ ] Task 4 — Budget: «negato» diverso da «fallito» (S4)

**File**
- Modifica: `src/lib/scanner/credential-run-budget.ts`.
- Crea: `src/lib/scanner/__tests__/credential-run-budget-negato.test.ts`. Le prove esistenti non si toccano.

**Interfacce prodotte**

```ts
/** Accesso rifiutato con password verificata: nessun logon errato, lo streak non cresce e non si azzera. */
recordDenied(credId: number): void;
```

**Cosa fare**
- `recordDenied` tiene solo un contatore per `logSummary`: «cred#N: rifiutata su X host per diritti mancanti».
- Il docstring cita l'incidente: 72729, 04/11/2026, account di dominio valido rifiutato dai PC.

**Verifica:** 30 `recordDenied` di fila: `gate` resta vero. 3 `recordFailure`: esclusa come oggi. `node --import tsx --test src/lib/scanner/__tests__/credential-run-budget-negato.test.ts`.

**Commit:** `Budget credenziali: il rifiuto per diritti non consuma il budget`.

### [ ] Task 5 — Discovery: i due punti di validazione (S5)

**File**
- Crea: `src/lib/scanner/prova-wmi-host.ts` e `src/lib/scanner/__tests__/prova-wmi-host.test.ts`.
- Modifica: `src/lib/scanner/discovery.ts:1442-1553` (tipo `windows`) e `:2574-2604` (`credential_validate`).

**Interfacce prodotte**

```ts
export type EsitoWmiHost = "valida" | "negata" | "errore" | "saltata";
export function deveUsareWmi(porteAperte: readonly number[]): boolean; // 135 sì, 5985 e 5986 no
export async function provaWmiHost(input: {
  ip: string; hostId: number; credId: number; nomeVoce: string;
  username: string; password: string;
  password_verificata: EsitoPassword; budget: CredentialRunBudget;
  log: (m: string) => void;
}): Promise<EsitoWmiHost>;
```

**Cosa fare**

| Password | Esito WMI | Registro sull'host | Budget |
| --- | --- | --- | --- |
| `errata` | nessun tentativo, `saltata` | nessuna riga | la voce si logga una volta |
| `valida` | identità ok | `recordCredentialSuccess(…, "wmi", 135)`, `autoBindCredentialToDevice` | `recordSuccess` |
| `valida` | `AUTH_REJECTED` | `recordCredentialFailure` con «diritti mancanti» | `recordDenied` |
| `non_so` | `AUTH_REJECTED` | `recordCredentialFailure` | `recordFailure` |
| qualsiasi | porta o trasporto | `recordCredentialFailure` | né l'uno né l'altro |

- Con `deveUsareWmi` vero **non** si chiama `runWinrmCommand`. Così la porta chiusa smette di consumare il budget (caso 1).
- Con `deveUsareWmi` falso e 5985/5986 chiuse (nessuna porta nota) resta il comportamento di oggi.
- `gateCredential("wmi", …, 135)` prima di ogni tentativo: tiene backoff e budget.
- `validatedProtos` riceve `wmi`: dopo il successo non si prova la voce seguente.
- `applyAuthEvidence`: solo se `evidenceFromAuthOutcome` accetta `wmi`, altrimenti si aggiunge lì con la sua prova.
- `progress.phase` e il log dicono «WMI», non «WinRM».

**Verifica:** prova con bridge finto su 20 host con password valida e 17 rifiuti: 3 successi, nessuna esclusione. Con `errata`: zero chiamate al bridge. Host con 5985 aperta: zero chiamate. Poi il cancello completo.

**Commit:** `Scansione: WMI quando WinRM è chiuso`.

### [ ] Task 6 — Apparato, testi e manuale (S6)

**File**
- `src/lib/devices/device-info.ts:1489`: con credenziale `wmi` si va direttamente a `getDeviceInfoFromWmi`, senza attendere il fallimento WinRM.
- `src/lib/devices/device-connection-test.ts:313`: il testo dice ancora che si usa solo WinRM.
- La scheda dell'host mostra la voce come «WMI» e il motivo «diritti mancanti».
- `docs/MANUALE-WINRM.md`: sezione WMI con prerequisiti (amministratore locale, regola firewall) e dati che mancano rispetto a WinRM.
- `CHANGELOG.md`.

**Verifica:** pagina di un host resa a 1280 e 1920 con dati finti di forma vera.

**Commit:** `WMI: scheda host, testi e manuale`.

### [ ] Task 7 — Collaudo sul 72729 (S7)

- Promozione `dev`→`main` dalla UI solo col sì di Riccardo, poi «Aggiorna» dell'appliance da DA-Link, con snapshot della VM 100 su `pve`.
- Sì di Riccardo anche per lanciare la scansione sul cliente.
- **Fatto quando:** i PC che hanno accettato in S0 risultano con credenziale `wmi`, nessun account bloccato, il riepilogo conta i rifiuti per diritti.

## Registro

## Consuntivo

### Fatto

### Mancante

### Scostamenti dal piano

### Consigli di sviluppo

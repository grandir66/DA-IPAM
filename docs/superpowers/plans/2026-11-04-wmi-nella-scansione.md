# Accesso Windows automatico e diritti chiari — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` oppure in linea
> (una sessione che esegue i task in ordine). Le caselle `- [ ]` tengono il conto.

**Obiettivo:** su qualsiasi cliente la scansione prova da sola WinRM e WMI senza fermarsi e senza bloccare account, e l'applicativo dice con chiarezza cosa abilitare per l'utente delle scansioni e cosa per la sicurezza del dominio.
**Architettura:** tre pezzi. Un motore unico sceglie la strada per ogni host e dà a ogni esito un motivo preciso. Un catalogo unico dei diritti sostituisce il testo sparso nelle guide. Un controllo dell'account confronta quel catalogo con ciò che l'account può fare davvero.
**Spec:** nessun documento separato. Requisiti di Riccardo del 04/11/2026 in `TASKS.md`: «testare sia winrm che wmi in automatico senza bloccarsi, non tanto per questo utente ma in generale»; «deve essere chiara la definizione dei diritti dell'utente necessari per le scansioni»; «nell'applicativo deve essere chiaro cosa abilitare per l'utente e cosa abilitare per la sicurezza del dominio».
**Livello di controllo:** completo (deciso da Riccardo il 2026-11-04).
**Stato:** in corso · **Ultimo aggiornamento:** 2026-11-04

## Vincoli globali

- `MAX_CONSECUTIVE_FAILURES_PER_RUN` resta 3 e non cambia significato per le password errate o non verificabili.
- Mai più di un tentativo per voce, per host e per strada in ogni esecuzione; ci si ferma alla prima strada riuscita (`validatedProtos`, fix C2 del 2026-06-23).
- La password resta su stdin, mai negli argomenti di un processo.
- Verso le macchine solo lettura: WQL su `Win32_ComputerSystem` e comando `hostname`. Il controllo dell'account non scrive nulla sul dominio.
- Una macchina non può fermare la scansione: tetto di 20 secondi alla prova di identità.
- Le prove esistenti non si toccano per farle passare; se una cambia esito, si spiega nel commit.
- Cancello di DA-IPAM: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.
- Ogni commit di codice su `dev` chiude con `npm run version:release` e push. Mai push su `main`: avanza solo con la promozione `dev`→`main` dalla UI, da confermare da Riccardo.
- `db-tenant` si importa solo staticamente (`CLAUDE.md`, regola 14). Niente `any`. Testi in italiano.
- Pagine secondo `docs/STILE-UI.md` e `src/components/shared/console.tsx`. L'interfaccia si scrive dopo il sì alla tavola degli oggetti (Task 7).

## Passi

| ID | Stato | Passo | Agente | Dipende da | Fatto quando | Verifica |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | [x] | Misura sul 72729 col codice di oggi | orchestratore | — | esito noto | tabella nel Registro |
| S1 | [x] | Prova leggera WMI, tetto ai tempi | implementer | — | `runWmiIdentita` provata | prova del task |
| S2 | [x] | Protocollo `wmi` e colonna `motivo` | implementer | — | migrazione provata su database vero | `npx tsc --noEmit` e prova |
| S3 | [x] | Verifica della password per esecuzione | implementer | — | LDAP, SMB e «non so» provati | prova del task |
| S4 | [~] | Motore: strada e motivo per host | implementer | S1 S2 S3 | tabella delle decisioni provata | prova del task |
| S5 | [ ] | Discovery usa il motore nei due punti | implementer | S4 | 20 host finti senza blocchi | prova + cancello |
| S6 | [ ] | Catalogo unico dei diritti | implementer | — | guide allineate, una sola fonte | prova del task |
| S7 | [x] | Tavola degli oggetti approvata | orchestratore | S6 | sì di Riccardo | nota nel Registro |
| S8 | [ ] | Controllo dell'account e pagina | implementer | S3 S6 S7 | pagina resa a 1280 e 1920 | verifica resa |
| S9 | [ ] | Stato per host e copertura | implementer | S5 S7 | motivo visibile per host | verifica resa |
| S10 | [ ] | Collaudo sul 72729 | orchestratore | tutti, promozione approvata | esito confrontato con S0 | tabella nel Registro |

## Casi da non dimenticare

1. Porta 5985 chiusa: oggi la scansione conta un fallimento senza alcun login e dopo tre host esclude la voce. Task 4.
2. Password giusta e diritti mancanti sui primi tre PC: il quarto va provato. Task 4.
3. Password errata: nessun tentativo su nessuna macchina. Task 3 e 4.
4. Account locale, o dominio che non è quello dell'integrazione AD: la verifica dà sempre «non so» e vale il limite di 3, perché una password valida su una macchina non dice nulla sulle altre. SMB serve solo a un account del dominio noto quando il DC non risponde. Task 3.
5. WinRM rifiutato con password verificata: oggi WMI non parte, perché `device-info.ts` presume che fallirebbe anche lui. I diritti delle due strade sono diversi, quindi si prova. Task 4.
6. 135 aperta e porte dinamiche chiuse dal firewall: il tentativo resterebbe appeso fino a 90 secondi. Il tetto di 20 secondi lo chiude come `firewall`. Task 1 e 4.
7. Controllo dell'account eseguito con un account senza diritti di lettura sui gruppi: «non verificato», mai «no». Task 8.

## Task

### [x] Task 0 — Misura sul 72729 col codice di oggi (S0)

Verifica: script temporaneo sulla VM 100 → 13 PC, 12 `AUTH_REJECTED`, 1 `TCP_TIMEOUT`, 0 accessi. Dettaglio nel Registro.

### [x] Task 1 — Prova leggera WMI, tetto ai tempi (S1)

**File**
- Modifica: `src/lib/devices/wmi-bridge.py`, `src/lib/devices/wmi-run.ts`.
- Crea: `src/lib/devices/__tests__/wmi-identita.test.ts`.

**Interfacce prodotte**

```ts
export interface WmiIdentita { hostname: string; dominio: string | null }
export async function runWmiIdentita(
  host: string, username: string, password: string,
): Promise<WmiIdentita>;
```

**Cosa fare**
- Bridge, con `req.get("solo_identita")` vero: una sola query `SELECT Name,Domain FROM Win32_ComputerSystem`, stessa disconnessione nel `finally`.
- `wmi-run.ts`: estrarre `eseguiBridge(input, timeoutMs)` senza cambiare `runWmiProbe` (resta 90 s). `runWmiIdentita` usa 20 s e il controllo della 135.
- Superato il tetto: `WmiError` con codice `BRIDGE_TIMEOUT`.

**Verifica:** prova con `execFile` finto: identità, `AUTH_REJECTED`, 135 chiusa, tetto superato. Vista fallire prima del codice.

**Commit:** `WMI: prova leggera di identità con tetto di 20 secondi`.

Verifica: `node --import tsx --test src/lib/devices/__tests__/wmi-identita.test.ts` → 8 verdi, viste rosse prima del codice.

### [x] Task 2 — Protocollo `wmi` e colonna `motivo` (S2)

**File**
- `src/lib/credentials/porte.ts`: `CredProtocol` con `"wmi"`, `DEFAULT_PORTS.wmi = 135`.
- `src/lib/credentials/tipi.ts`: `tipiPerProtocollo("wmi")` e `TIPI_PROPRI.wmi` = `windows`.
- `src/lib/credentials/lega-voce.ts`, `src/lib/credentials/converti-apparati.ts`.
- `src/lib/db.ts:3947, 3995, 4048, 5278` e `src/lib/scanner/discovery.ts:155`: unioni di tipo.
- `src/app/api/hosts/[id]/credentials/route.ts:31`, `src/app/api/devices/[id]/credentials/route.ts:60,118`: `z.enum`.
- `src/lib/db-schema.ts:535`, `src/lib/db-tenant-schema.ts:1109,1153`: CHECK con `'wmi'`.
- `src/lib/db-tenant.ts`: dopo riga 2581 due ricostruzioni, condizione `!row.sql.includes("'wmi'")`, stessa forma di quelle `redfish`. `ALTER TABLE host_credentials ADD COLUMN motivo TEXT` idempotente.
- Crea: `src/lib/__tests__/migrazione-protocollo-wmi.test.ts`.

**Cosa fare**
- `motivo` vale uno dei `MotivoAccesso` del Task 4, oppure NULL.
- `loginApparatoDb` accetta un legame `wmi` quando il protocollo dell'apparato è `winrm`.
- `avviaChocoDopoCredenziali` resta solo su `winrm`: Chocolatey senza WinRM non gira.

**Verifica:** database SQLite vero con lo schema di prima e righe presenti, migrazione, righe intatte, `wmi` accettato, secondo avvio senza effetto.

**Commit:** `Credenziali: protocollo wmi e motivo dell'esito`.

Verifica: `npm test` → 6595 pass, 0 fail, dopo revisione e correzioni. Colonne confrontate col database del 72729.

### [x] Task 3 — Verifica della password per esecuzione (S3)

**File**
- Crea: `src/lib/scanner/verifica-password-run.ts`, `src/lib/devices/smb-login.py`, e la prova `src/lib/scanner/__tests__/verifica-password-run.test.ts`.

**Interfacce prodotte**

```ts
export type EsitoPassword = "valida" | "errata" | "non_so";
export class VerificaPasswordRun {
  constructor(prove: {
    ldap: (credId: number) => Promise<EsitoPassword>;
    smb: (credId: number, ip: string) => Promise<EsitoPassword>;
  });
  /** Una sola verifica per voce in tutta l'esecuzione. `ip` serve solo se LDAP dà non_so. */
  esito(credId: number, ip: string): Promise<EsitoPassword>;
}
```

**Cosa fare**
- LDAP: sulla prima integrazione AD accesa, sequenza di `connectLdap`. `data 52e` = `errata`, login riuscito = `valida`, tutto il resto `non_so`: un errore di trasporto non è una risposta.
- SMB, se LDAP dà `non_so` e la 445 è aperta: login impacket con password su stdin, senza aprire condivisioni. `STATUS_LOGON_FAILURE` = `errata`, sessione aperta = `valida`, altro `non_so`.
- Il risultato sta in memoria per l'esecuzione e non si scrive da nessuna parte.

**Verifica:** i tre esiti per entrambe le prove, una sola verifica per voce. Viste fallire prima del codice.

**Commit:** `Scansione: verifica la password una volta per esecuzione`.

Verifica: `node --import tsx --test src/lib/scanner/__tests__/verifica-password-run.test.ts` → 48 verdi. `smb-login.py` provato con un finto impacket: la prova vera sta nel collaudo.

### [~] Task 4 — Motore: strada e motivo per host (S4)

**File**
- Crea: `src/lib/scanner/accesso-windows.ts`, `src/lib/scanner/__tests__/accesso-windows.test.ts`.
- Modifica: `src/lib/scanner/credential-run-budget.ts` con `recordDenied(credId: number): void`, che non tocca lo streak e alimenta `logSummary`.
- Crea: `src/lib/scanner/__tests__/credential-run-budget-negato.test.ts`.

**Interfacce prodotte**

```ts
export type StradaWindows = "winrm" | "wmi";
export type MotivoAccesso =
  | "ok" | "diritti_mancanti" | "password_errata" | "firewall"
  | "porte_chiuse" | "nessuna_voce" | "budget_esaurito" | "errore";
export function stradeDaProvare(porteAperte: readonly number[]): StradaWindows[];
export interface EsitoAccesso { strada: StradaWindows | null; motivo: MotivoAccesso; dettaglio: string }
export async function provaAccessoWindows(input: {
  ip: string; hostId: number; credId: number; porteAperte: readonly number[];
  username: string; password: string; dominioAd: string;
  verifica: VerificaPasswordRun; budget: CredentialRunBudget;
  prova: { winrm: ProvaWinrm; wmi: ProvaWmi };
}): Promise<EsitoAccesso>;
```

**Cosa fare**
- `stradeDaProvare`: 5985 o 5986 aperta → `["winrm","wmi"]` se c'è anche la 135, altrimenti `["winrm"]`. Solo 135 → `["wmi"]`. Nessuna → `[]`.
- Per ogni host la verifica della password viene prima di tutto: `errata` → nessuna strada, motivo `password_errata`.
- Ogni voce con porte chiuse esce con `porte_chiuse` senza login e senza toccare il budget.

| Password | Esito della strada | Motivo | Budget | Strada successiva |
| --- | --- | --- | --- | --- |
| `valida` | riuscita | `ok` | `recordSuccess` | no |
| `valida` | `AUTH_REJECTED` | `diritti_mancanti` | `recordDenied` | sì |
| `non_so` | `AUTH_REJECTED` | `errore` | `recordFailure` | no |
| qualsiasi | `TCP_TIMEOUT`, `BRIDGE_TIMEOUT` dopo la 135 aperta | `firewall` | nessuno | sì |
| qualsiasi | altro trasporto | `errore` | nessuno | sì |

**Verifica:** prova per ogni riga della tabella, e 30 `recordDenied` di fila con `gate` ancora vero; 3 `recordFailure` escludono come oggi. Il docstring cita l'incidente del 72729 del 04/11/2026.

**Commit:** `Scansione: motore di accesso Windows con motivo per host`.

### [ ] Task 5 — Discovery usa il motore nei due punti (S5)

**File**
- Modifica: `src/lib/scanner/discovery.ts:1442-1553` (tipo `windows`) e `:2574-2604` (`credential_validate`).
- Modifica: `src/lib/devices/device-info.ts:1484-1516`: fallback su WMI anche con `AUTH_REJECTED` quando esiste un legame `wmi` validato. Il commento sulle «stesse credenziali» si riscrive.
- Modifica: `src/lib/db-tenant.ts` `recordCredentialSuccess` e `recordCredentialFailure`, con `motivo` opzionale.
- Crea: `src/lib/scanner/__tests__/discovery-accesso-windows.test.ts`.

**Cosa fare**
- Sostituire i due blocchi WinRM con `provaAccessoWindows`, tenendo `gateCredential`, `validatedProtos`, `applyAuthEvidence` e il controllo del nome host del tipo `windows`.
- Riuscita: `recordCredentialSuccess(host.id, credId, strada, porta)` e `autoBindCredentialToDevice`.
- Log e `progress.phase` dicono «WinRM» o «WMI» e il motivo.
- Riepilogo a fine esecuzione: quanti host per ogni motivo, senza nomi utente.

**Verifica:** 20 host finti con password valida, 17 rifiuti, 3 riusciti: nessuna esclusione. Con `errata`: zero chiamate. Con 5985 chiusa e 135 chiusa: zero chiamate e budget intatto. Poi il cancello completo.

**Commit:** `Scansione: WinRM e WMI in automatico`.

### [ ] Task 6 — Catalogo unico dei diritti (S6)

**File**
- Crea: `src/lib/credentials/diritti.ts`, `src/lib/credentials/__tests__/diritti.test.ts`.
- Modifica: `src/components/shared/ad-setup-guide-dialog.tsx`, `src/components/shared/winrm-setup-guide-dialog.tsx`, `src/components/shared/guida-audit-dc.tsx`, `src/app/(dashboard)/sicurezza-dominio/sicurezza-dominio-client.tsx:295`, `src/lib/devices/device-connection-test.ts:313`.
- Modifica: `docs/MANUALE-ACTIVE-DIRECTORY.md`, `docs/MANUALE-WINRM.md`, `docs/MANUALE-EVENTI-DC.md`, `CHANGELOG.md`.

**Interfacce prodotte**

```ts
export type FamigliaDiritti = "utente_scansioni" | "sicurezza_dominio";
export interface DirittoRichiesto {
  id: string;
  famiglia: FamigliaDiritti;
  funzione: string;        // cosa si ottiene
  abilitare: string;       // cosa fare, una riga
  dove: string;            // PC e server | DC | dominio
  obbligatorio: boolean;
  comandoIt?: string;      // PowerShell per l'IT del cliente
}
export const DIRITTI: readonly DirittoRichiesto[];
```

**Contenuto, una riga per voce**

| Famiglia | Funzione | Cosa abilitare | Dove |
| --- | --- | --- | --- |
| Utente delle scansioni | Inventario via WMI | Administrators locale + regola firewall WMI | PC e server |
| Utente delle scansioni | Inventario via WinRM | Administrators locale + servizio WinRM attivo | PC e server |
| Utente delle scansioni | Software e patch | Administrators locale + WinRM | PC e server |
| Sicurezza del dominio | Computer, utenti, gruppi | Utente di dominio normale | dominio |
| Sicurezza del dominio | Eventi di sicurezza dei DC | Event Log Readers + Remote Management Users | DC |
| Sicurezza del dominio | Registrazione degli eventi | GPO di audit (`Configura-Audit-DC.ps1`) | DC |
| Sicurezza del dominio | DHCP | DHCP Administrators + Remote Management Users | DC |

**Cosa fare:** le guide leggono da `DIRITTI`. Spariscono le frasi in conflitto, per esempio Administrators sul DC per leggere gli eventi. Regola scritta in `diritti.ts`: mai Domain Admins, e l'account delle scansioni è separato da quello di sola lettura.

**Verifica:** prova che ogni voce abbia i campi pieni, e una `rg` che non trovi più i nomi dei gruppi fuori da `diritti.ts` nei componenti toccati.

**Commit:** `Diritti: una sola definizione per guide e pagine`.

### [x] Task 7 — Tavola degli oggetti approvata (S7)

Si propone a Riccardo la tavola grafica degli oggetti del Task 8 e del Task 9, oggetto per oggetto. Nessun codice di interfaccia prima del sì. Il sì si scrive nel Registro.

### [ ] Task 8 — Controllo dell'account e pagina (S8)

**File**
- Crea: `src/lib/credentials/controllo-account.ts`, `src/app/api/credentials/[id]/controllo/route.ts`, `src/components/credentials/diritti-account.tsx`, e le prove.
- Modifica: la pagina Credenziali, secondo la tavola approvata.

**Interfacce prodotte**

```ts
export type StatoDiritto = "si" | "no" | "non_verificato";
export interface RigaControllo { dirittoId: string; stato: StatoDiritto; base: string }
export async function controllaAccount(credId: number): Promise<RigaControllo[]>;
```

**Cosa fare**
- Rotta con `requireAdmin` e `withTenantFromSession`.
- Lettura dei gruppi con filtro ricorsivo `LDAP_MATCHING_RULE_IN_CHAIN` `1.2.840.113556.1.4.1941`, per chi è dentro un gruppo tramite un altro gruppo.
- Sui PC non si prova nulla al clic: lo stato arriva dagli esiti dell'ultima scansione. Sono veri e non consumano tentativi.
- Il comando per l'IT si copia dal catalogo.

**Verifica:** gruppo diretto, gruppo annidato, utente senza gruppi, LDAP che non risponde (`non_verificato`). Pagina resa a 1280 e 1920 con dati finti di forma vera.

**Commit:** `Credenziali: controllo di cosa può fare un account`.

### [ ] Task 9 — Stato per host e copertura (S9)

**File**
- Modifica: `src/components/settings/credential-coverage-tab.tsx`, `src/components/shared/host-credentials-dialog.tsx`, e la funzione di lettura paginata in `db-tenant.ts`, con JOIN e senza N+1.

**Cosa fare:** ogni motivo ha una parola sola e una sola azione, presa dal catalogo. Stati con doppio segnale, fondo e icona, distinguibili per luminanza e forma.

**Verifica:** pagina resa a 1280 e 1920 con tutti i motivi.

**Commit:** `Copertura: motivo dell'accesso Windows per host`.

### [ ] Task 10 — Collaudo sul 72729 (S10)

- Promozione `dev`→`main` dalla UI solo col sì di Riccardo, poi «Aggiorna» dell'appliance da DA-Link, con snapshot della VM 100 su `pve`.
- Sì di Riccardo anche per lanciare la scansione sul cliente.
- **Fatto quando:** con l'account readonly i 12 PC risultano `diritti_mancanti` e `.207` è `firewall` o `porte_chiuse`, nessuna esclusione, nessun blocco; con l'account dedicato, se arriva, i PC passano a `ok` via WMI.

## Registro

- 2026-11-04 Riccardo: «Sì, parti». Piano e tavola approvati, livello completo, subagent fino al cancello su `dev`, nessuna promozione su `main`. Task 10 escluso.
- 2026-11-04 Riccardo: il piano si allarga dal solo WMI al motore generale e alla chiarezza sui diritti.
- 2026-11-04 Task 0 → [x] Voce `WinRM` (utente readonly, solo Domain Users), password verificata in LDAP su 192.168.0.10. Una prova per PC, in sequenza. Account non bloccato, `badPwdCount` 0.

| IP | PC | Esito |
| --- | --- | --- |
| 192.168.0.80 | FedeAiO-PC | `AUTH_REJECTED` |
| 192.168.0.82 | CelleSF-PC | `AUTH_REJECTED` |
| 192.168.0.204 | SERENAGIU-PC | `AUTH_REJECTED` |
| 192.168.0.205 | Veronica-PC | `AUTH_REJECTED` |
| 192.168.0.207 | LICIAB-PC | `TCP_TIMEOUT` sulla 135 |
| 192.168.0.213 | Daniele-PC | `AUTH_REJECTED` |
| 192.168.0.214 | AlfonsoB-PC (Windows 7) | `AUTH_REJECTED` |
| 192.168.0.217 | Clara-pc | `AUTH_REJECTED` |
| 192.168.0.222 | DOLORES-PC | `AUTH_REJECTED` |
| 192.168.0.223 | Simonaz-PC | `AUTH_REJECTED` |
| 192.168.0.227 | ClaudiaR-PC (prova precedente) | `AUTH_REJECTED` |
| 192.168.0.230 | Roberto-PC | `AUTH_REJECTED` |
| 192.168.0.234 | Lucio-PC | `AUTH_REJECTED` |

## Consuntivo

### Fatto

### Mancante

### Scostamenti dal piano

### Consigli di sviluppo

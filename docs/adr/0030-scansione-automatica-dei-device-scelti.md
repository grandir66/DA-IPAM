# ADR 0030 — Scansione automatica dei device scelti: un job per selezione, letture riusate, lucchetto per apparato

**Stato:** Accepted
**Data:** 2026-10-22
**Autore:** Riccardo Grandi, con Claude

## Contesto

Gli apparati si leggevano solo a mano ("Aggiorna", "Interroga") o dal giro ARP, e l'hub non ha il job `arp_poll`: le tabelle
MAC e le VLAN degli switch invecchiavano. Richiesta di Riccardo (22/10): "scansione automatica dei device indicati, creando
un job con selezione multipla da Discovery; le credenziali devono essere memorizzate". Piano
`plans/2026-10-22-scansione-automatica-da-discovery.md` (v0.9.861-867). Lo scheduler (`scheduled_jobs`) c'è già, le letture
anche; mancano il modo di scegliere gli apparati, una regola per non leggere lo stesso apparato due volte insieme, e un
esito per apparato.

## Decisione

Un job per selezione, che riusa le letture esistenti, con un lucchetto per apparato e un esito per apparato.

1. **Un job pianificato per selezione**: tipo `apparati_scelti`, con `config` = nome, `device_ids` (al più **50**), letture
   scelte (info, porte e MAC, VLAN) e l'ora per il giornaliero. Lo crea, modifica, sospende ed elimina **solo un admin**,
   da Discovery. Il 50 è il tetto della finestra "Rendi apparato" e un giro seriale da 50 sta nell'ora (circa 1 minuto per
   apparato nel caso peggiore misurato). Frequenze solo tre: ogni ora, ogni 4 ore, ogni giorno alle HH:MM.
2. **CHECK v11 di `scheduled_jobs`**: il CHECK sui tipi si allarga con la migrazione `migrateScheduledJobsV11`, che
   ricostruisce la tabella (stessa forma della v10, già passata sul cliente A), con guardia su `'apparati_scelti'`. SQLite non
   modifica un CHECK: l'unica via è ricostruire.
3. **Idoneità = credenziale dell'host provata OPPURE collegamento credenziale riuscito** (decisione di Riccardo, 22/10: "le
   credenziali devono essere memorizzate"). Diverge dalla testata della scheda, che resta più severa (solo host provato).
   Un apparato non idoneo è "escluso" col motivo e il link che lo risolve; il server ricontrolla alla creazione e a ogni giro.
4. **Letture riusate, nessuna lettura nuova**: info = quello che fa "Aggiorna"; porte e MAC = il corpo per apparato del
   giro ARP, estratto senza cambiarne il comportamento; VLAN = `letturaVlanSwitch` (e la scheda MikroTik) **dietro
   l'interruttore** (`switch_vlan`, `mikrotik_scheda`) ma **ignorando la cadenza oraria**: un job creato da un admin è una scelta
   esplicita, l'interruttore resta il freno generale (ADR 0018, ADR 0029). Interruttore spento = esito "spenta", non errore.
5. **Lucchetto per apparato**, chiave `tenant|deviceId`, in memoria su `globalThis` (`lucchetto-apparato.ts`), condiviso dal
   giro ARP, dal job e da "Interroga": occupato = il giro e il job passano oltre ("saltato: lettura già in corso"),
   "Interroga" risponde **409**. Gli apparati si leggono uno alla volta, **al più 5 minuti** ciascuno; allo scadere il
   lucchetto si **libera anche se la lettura appesa continua**.
6. **Fuso italiano solo per questo job**: l'orario ("ogni giorno alle 06:00") è in ora italiana, perché lo sceglie una
   persona. Gli altri tipi restano come sono; `next_run` non vale per questi job (la "prossima" è calcolata).
7. **"Esegui ora" risponde 202 e gira in sottofondo**, segnato in `runningJobs` (non si sovrappone a sé né al giro
   programmato). Prima girava nella richiesta ed era sovrapponibile.
8. **Esito per apparato** in `job_apparati_esiti` (ultimo esito, niente storico): stato ok/parziale/errore/escluso/saltato
   e, per ogni lettura, letto/errore/spenta/non_valida con il codice. "**Saltato**" anche quando non c'è nulla da leggere (le
   letture scelte non valgono per quel tipo di apparato). Job con nessun apparato letto = **fallisce** ("0 su N"), così
   l'allarme delle sincronizzazioni ferme lo vede; log e motivo con soli id e codici, mai nomi o IP.
9. **Sull'hub**: job #25 "Switch e router del CED", ogni 4 ore, apparati 1, 7, 8, 10, 11, 12; primo giro 6 letti su 6 in
   83 s. Creato con l'ok di Riccardo; un job creato da script vuole il riavvio dello scheduler per essere visto.

## Alternative scartate

- **Un job per apparato**: decine di righe nella pagina dei job, nessun esito d'insieme, nessuna modifica di gruppo.
- **Aggiungere le letture al job `arp_poll`**: l'hub non ce l'ha, e non si sceglie chi leggere né ogni quanto.
- **Lucchetto su tabella del DB**: sopravvive al riavvio ma resta "occupato" dopo un crollo e vuole un tempo di scadenza e
  una pulizia; l'app è un processo solo per tenant, la memoria basta.
- **Idoneità solo con host provato (regola della testata)**: escluderebbe gli apparati con collegamento riuscito, contro
  la richiesta "credenziali memorizzate"; i 5 switch Ubiquiti avrebbero richiesto comunque "Prova credenziali".
- **Rispettare la cadenza oraria delle VLAN nel job**: un job a 4 ore leggerebbe le VLAN solo se l'ora cade giusta.
- **Frequenze libere (cron a mano)**: tre scelte bastano e l'ora sta in un posto solo.

## Conseguenze

### Positive

- Tabelle MAC, porte e VLAN degli apparati scelti si aggiornano da sole, con esito visibile per apparato (pagina dei job e
  testata della scheda).
- Nessuna lettura nuova e nessun interruttore scavalcato; due letture dello stesso apparato non partono insieme.
- Un job tutto in errore si vede nell'allarme, non passa muto.

### Negative

- Due regole di idoneità diverse (job e testata della scheda): un apparato può essere in scansione e non mostrare la
  credenziale come "provata".
- L'ora italiana vale solo per `apparati_scelti`: negli altri job l'orario resta nel fuso del server.
- Un solo esito per apparato: niente storico, un'esclusione ripetuta si vede solo guardando il job.

### Cosa diventa difficile in futuro

- **Il lucchetto è in memoria**: vale per un processo solo. Con due processi (o istanze) sullo stesso tenant non protegge, e
  un riavvio lo azzera.
- **Dopo il timeout dei 5 minuti due letture possono sovrapporsi**: il lucchetto si libera ma la lettura appesa non si
  interrompe (ADR 0006); se riprende a scrivere mentre parte la successiva, vince chi scrive per ultimo. Un annullamento
  vero (AbortSignal fino alle librerie SNMP/SSH) è lavoro a parte.
- **CHECK ricostruito a ogni tipo nuovo**: ogni tipo di job in più vuole una v12, v13…, con la ricostruzione di
  `scheduled_jobs`; e `job_apparati_esiti` non ha FK verso `scheduled_jobs` (la ricostruzione la romperebbe): le righe si
  cancellano a mano in `deleteScheduledJob` e gli orfani a ogni giro.
- **Cambiare il corpo del giro ARP cambia anche il job**: la lettura porte e MAC è una sola funzione per due chiamanti.
- **Aggiungere apparati a un job esistente** non si può dalla Discovery (si crea un job nuovo o si toglie da "Modifica").
- **Il fuso fisso**: se un cliente vuole l'orario in un altro fuso serve un parametro, non c'è.

## Riferimenti

- Piano: `docs/superpowers/plans/2026-10-22-scansione-automatica-da-discovery.md` (decisioni, Consuntivo)
- `CONTEXT.md` §6 "Scansione automatica dei device scelti"; `CHANGELOG.md` (22/10)
- Codice: `src/lib/apparati-scelti/`, `src/lib/apparati-scelti/lucchetto-apparato.ts`, `src/lib/cron/jobs.ts`
- ADR 0006 (timeout delle letture), ADR 0018 (letture spente), ADR 0029 (VLAN degli switch)

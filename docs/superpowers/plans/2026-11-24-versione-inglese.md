# DA-IPAM in inglese — censimento e piano

> Riccardo, 24/11/2026: «inizia a fare un censimento del lavoro e un piano». **Solo
> piano: niente codice finché Riccardo non approva** le decisioni della §3 e il livello.
> Livello proposto: **Leggero** (lavoro di più settimane su un progetto in esercizio;
> nessuna zona rossa toccata finché si resta su `dev`: `main` avanza solo via promote).

## 1. Censimento (24/11/2026, `dev` a `5f7d4276`)

Misure fatte con uno script euristico (parole italiane tipiche, accenti; esclusi commenti,
import, classi CSS e SQL). **Sono ordini di grandezza, non conti esatti**: lo script conta
anche qualche identificatore italiano e perde qualche frase corta.

### Dimensioni dell'app

| Cosa | Quanti |
| --- | --- |
| Pagine (`page.tsx`) | 93 |
| Rotte API (`route.ts`) | 468 |
| Componenti (`src/components`) | 309 |
| File di logica (`src/lib`, prove escluse) | 998 |
| File di prova | 846, di cui ~460 asseriscono testo italiano |

### Stato di partenza

- **Nessuna libreria di traduzione.** Tutto il testo è scritto nel codice; `<html lang="it">` fisso.
- **~20.000 stringhe italiane in ~2.100 file.** Ripartizione per tipo:

| Tipo | Stima | Nota |
| --- | --- | --- |
| Testo JSX | ~930 | si estrae quasi meccanicamente |
| Proprietà UI (label, placeholder, title) | ~590 | idem |
| Toast, alert, confirm | ~560 | idem |
| Messaggi JSON delle API (`error:`, `message:`) | ~1.130 | arrivano a video: vanno tradotti o resi codici |
| Eccezioni (`throw new Error`) | ~610 | parte finisce a video, parte nei log |
| Log | ~390 | **restano in italiano** (diagnostica interna) |
| Altre stringhe | ~16.000 | soprattutto frasi composte in `src/lib` (vedi sotto) |

- **Il grosso non è nell'interfaccia ma in `src/lib`**: frasi costruite lato server con dati
  dentro. Aree più pesanti: `lib/topology` (~1.950, le «frasi» dei collegamenti e i testi
  delle letture), `lib/credentials` (~1.200), `lib/integrations` (~1.000), `lib/scanner`
  (~940), `lib/devices` (~800), `lib/vuln` (~720), `lib/vault`, `lib/ad`, `lib/attribution`,
  `lib/opzioni`, `lib/cliente`, `lib/scheda`. Qui serve traduzione **con parametri e plurali**
  (ICU), non una sostituzione di parole.
- **Date e numeri con locale italiano fisso**: ~280 punti (`toLocaleString("it-IT")`, `Intl`
  in 27 file, `localeCompare` 167 volte).

### Testo che fa anche da logica (rischio di rotture mute)

1. **Confronti su frasi italiane**: ~70 punti, per esempio
   `result.failure === "Controller non trovato"`, `msg === "Dispositivo non trovato" ? 404`,
   `motivo.startsWith("è un impianto")`, `msg.includes("non ha risposto")`,
   `motivo.startsWith('Sessione SNMP non aperta')`. Tradotto il testo, il ramo non scatta più
   e nessun errore lo dice.
2. **Valori italiani salvati nel database con CHECK**: `stato IN ('in_attesa','inviato',
   'scartato','fallito','superato')`, `('proposto','confermato','escluso'|'rifiutato')`,
   `esito IN ('in_corso','riuscito','rifiutato','cambiato','non_so')`, `('da_fare','in_corso',
   'fatto','ignorato')`, inventario `stato IN ('Attivo','In magazzino','In riparazione',
   'Dismesso','Rubato')`, `categoria IN (…'Stampante'…)`, `device_type` con `'stampante'`,
   `'telecamera'`. **Restano come sono** (sono codici): si traduce solo l'etichetta a video.
   I due casi con maiuscole e spazi (inventario) oggi sono mostrati così come salvati.
3. **Frasi salvate già composte**: colonne `note`, `description`, `motivo` (15), `last_error`
   (14), `esito`, `dettaglio`, `headline`, `title`. Esempio visto il 23/11 sull'hub:
   `last_error = "Auto-disabilitato dopo 5 errori consecutivi: …"`. Le righe vecchie restano
   in italiano per sempre; le nuove vanno salvate come **codice + parametri**.
4. **File di stato sul disco**: `data/aggiornamento.json` (`fase: "salute"`,
   `esito: "riuscito"`, `"fetch_fallito"`) letto dall'interfaccia e forse da script.

### Testo che esce dall'app

- **Notifiche e email** (`lib/notifications/notifier.ts`, `policy.ts`,
  `health/scheduler-health-notify.ts`, `integrations/wazuh-health-notify.ts`,
  `modules/appliance-health-notify.ts`, `servizi-rete/sonde.ts`, `rilievi/da-servizi.ts`).
- **Verso DA-Vul-can**: `lib/vulcan/corpo-rilievi.ts`, `corpo-inventario.ts`, `corpo-ad.ts`
  mandano frasi italiane («Le credenziali di fabbrica danno accesso.») che finiscono **nei
  report di Vulcan**. Tradurle qui senza Vulcan dà report misti.
- **Verso DA-Link e Zabbix**: `lib/dalink/*`, `lib/zabbix-lettura/*` (stati, nomi, segnali).
- **Esportazioni**: ~21 rotte API producono file (CSV/XLSX/DOCX, `Content-Disposition`);
  una pagina di stampa (`(stampa)/topology`).

### Fuori da questo repo (da decidere a parte)

Scanner-Edge (sorgente in DA-Vul-can, pagine :8443/:9443), DA-Vul-can (report `.docx`),
DA-Link, Deploy-Appliance (installer e pagine). Un prodotto «universale» li coinvolge tutti;
questo piano copre **solo DA-IPAM** e il contratto con Vulcan (§2, tappa 6).

## 2. Piano a tappe

Regola che vale dalla tappa 0 in poi: **una tappa non cambia nessun testo visibile in
italiano** finché non c'è l'inglese; la prova è che l'interfaccia in italiano resta identica.

| Tappa | Cosa | Fatto quando | Stima |
| --- | --- | --- | --- |
| 0 | **Infrastruttura**: `next-intl` (App Router, server e client), `messages/it.json` e `en.json`, scelta della lingua (§3.2), `lang` dinamico, helper unico per date/numeri (`formatData`, `formatNumero`) | una pagina pilota (es. Impostazioni) legge i testi da `it.json`, a video identica; `en.json` vuoto ricade sull'italiano | 1-2 giorni |
| 1 | **Disinnescare il testo-logica**: i ~70 confronti diventano codici (`ERR_NOT_FOUND`, `motivo.codice`), le API rispondono `{ code, params, message }` con `message` ancora italiano | `rg` sui confronti a frasi = 0; prove esistenti verdi | 2-3 giorni |
| 2 | **Etichette per i valori salvati**: mappa codice → etichetta per ogni CHECK italiano e per `aggiornamento.json`; nessuna migrazione dei dati | ogni valore salvato passa da una funzione di etichetta | 1-2 giorni |
| 3 | **Estrazione dell'interfaccia** (pagine e componenti: JSX, label, toast): a gruppi di sezioni, un agente per gruppo su file diversi | ~2.100 stringhe UI in `it.json`; a video identico; una schermata a 1920 per gruppo solo se cambia il layout | 5-8 giorni |
| 4 | **Frasi composte di `src/lib`** (topologia, credenziali, integrazioni, scanner, dispositivi, vuln, AD…): messaggi ICU con parametri e plurali; le colonne nuove salvano codice + parametri, le vecchie si mostrano così come sono | le aree della §1 leggono da `it.json`; prove che asserivano frasi riscritte per asserire codici (con l'autorizzazione esplicita di Riccardo, vedi §3.6) | 8-12 giorni |
| 5 | **Date, numeri, ordinamenti**: i ~280 `it-IT` fissi passano dall'helper; `localeCompare` con la lingua attiva | `rg '"it-IT"'` fuori dall'helper = 0 | 1-2 giorni |
| 6 | **Testo in uscita**: email e notifiche nella lingua del tenant; contratto con Vulcan (si manda codice + parametri oppure si dichiara la lingua del corpo) | deciso e scritto in un ADR; Vulcan avvisato con una riga nel suo `TASKS.md` | 2-3 giorni + lavoro su Vulcan |
| 7 | **Traduzione inglese**: `en.json` completo (bozza automatica + rilettura umana per i termini di dominio), glossario fisso | nessuna chiave mancante (prova automatica); giro a video in inglese sulle pagine principali | 3-5 giorni + rilettura |
| 8 | **Freno contro le regressioni**: regola ESLint che vieta testo letterale nel JSX e prova che `it.json` ed `en.json` hanno le stesse chiavi, nel `scripts/controlla.sh` | il cancello fallisce su un testo nuovo scritto nel codice | 1 giorno |

**Totale realistico: 5-8 settimane di lavoro** (tappe 3 e 4 sono l'80%), più la rilettura
dell'inglese e la parte su Vulcan. Rilascio: tutto su `dev`, a tappe; l'inglese si accende
solo alla tappa 7, prima resta invisibile.

### Rischi e come li si tiene

| Rischio | Freno |
| --- | --- |
| Regressioni diffuse su centinaia di file mentre `dev` rilascia più volte al giorno | tappe piccole, un'area per volta, conflitti ridotti lavorando per cartella; la tappa 0 non cambia testi |
| Rami che scattano più (confronti su frasi) | tappa 1 **prima** di tradurre qualunque cosa |
| Report misti con Vulcan | tappa 6 con contratto deciso prima di tradurre i corpi |
| Inglese che resta indietro sulle funzioni nuove | tappa 8 (lint + chiavi uguali) dal giorno in cui si accende l'inglese |
| Prove che si rompono perché asseriscono frasi (~460 file) | si usa la lingua italiana fissa nelle prove: restano valide; si riscrivono solo dove il testo diventa codice, e solo col sì di Riccardo |
| Repo pubblico | nessun impatto diretto; i testi non contengono dati di clienti |

## 3. Decisioni da prendere prima di partire (Riccardo)

1. **Libreria**: `next-intl` (consigliata: nativa per App Router, ICU, server components)?
2. **Chi sceglie la lingua**: per utente (preferenza nel profilo), per tenant, o per appliance
   (`.env`)? Consiglio: per utente, col tenant come predefinito.
3. **I valori salvati nel database restano codici italiani** (`riuscito`, `da_fare`…) e si
   traduce solo l'etichetta? Consiglio: sì, nessuna migrazione.
4. **Righe vecchie con frasi già composte** (`last_error`, `motivo`…): si lasciano in
   italiano? Consiglio: sì, si traducono solo le nuove.
5. **Vulcan**: i rilievi si mandano come codici o nella lingua del tenant? (Coinvolge il
   repo DA-Vul-can.)
6. **Prove esistenti**: autorizzi a riscrivere le prove che asseriscono frasi solo dove la
   frase diventa codice (tappe 1 e 4)? Senza il sì restano intatte e girano in italiano.
7. **Scope**: solo DA-IPAM per ora, o anche Edge, Vulcan, DA-Link in un piano unico?
8. **Rilettura dell'inglese**: chi la fa per i termini di dominio?
9. **Regola 13 di `CLAUDE.md`** («Testo UI/errori in italiano»): col sì al piano diventa
   «testo UI/errori in italiano **nei file di messaggi**, mai scritto nel codice». La regola
   si cambia alla tappa 0, con un ADR.

## 4. Stato dei passi

- [x] Censimento (24/11, script euristico; numeri nella §1)
- [ ] Decisioni §3 — aspetta Riccardo
- [ ] Tappe 0-8

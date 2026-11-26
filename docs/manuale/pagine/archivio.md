---
percorso: /archivio
titolo: Archivio — le credenziali delle persone, sotto chiave
versione: 0.9.1376
aggiornata: 2026-11-26
---

## A cosa serve

È un archivio di password in formato KeePass **riservato alle persone**, separato dalle credenziali che DA-IPAM usa
per lavorare: scansioni e giri non lo leggono mai. Ad archivio chiuso non si vede nemmeno un titolo.

Si arriva da **Sicurezza › Archivio**. La voce la vede chiunque sia collegato, ma entra solo chi ha ricevuto
l'accesso. Il ruolo nell'installazione non conta: comanda chi possiede il **codice dell'amministratore dell'archivio**.
Nessuna schermata nel manuale.

## Crearlo (una volta sola)

Finché non esiste, la pagina dice «L'archivio non è ancora stato creato». Un amministratore dell'installazione preme
**Crea l'archivio** e inserisce il suo codice a 6 cifre. Compaiono, **una volta sola**, due valori da scrivere e
mettere al sicuro fuori da questa macchina:

- il **Codice dell'amministratore dell'archivio**: serve per dare, ridare e togliere l'accesso alle persone;
- la **Chiave di recupero delle copie**: è l'unica cosa che apre le copie cifrate, se la macchina si rompe.

Non stanno sul disco e nessuno potrà rileggerli. Si prosegue con **Li ho scritti e messi al sicuro**. Chi ha creato
l'archivio non ha per questo l'accesso: se lo deve dare col codice, come a chiunque.

## Aprire e chiudere

| Campo | Che cosa si scrive |
|---|---|
| **Password principale** | La propria, personale. La prima volta è quella provvisoria ricevuta da chi ha il codice dell'amministratore. |
| **Nuova password (14+)** | Compare solo se la password è provvisoria: sceglierne una nuova è obbligatorio per aprire. |
| **Il tuo codice a 6 cifre** | Quello della propria seconda verifica. |

**Apri per 10 minuti** apre. L'archivio si richiude da solo dopo 10 minuti senza gesti e comunque dopo un'ora;
**Chiudi ora** lo chiude subito.

## L'elenco delle voci

A sinistra i gruppi, in fondo il **cestino**. **Cerca fra le voci** guarda titolo, utente e URL.

| Colonna | Che cosa dice |
|---|---|
| **Titolo**, **Utente**, **URL**, **Gruppo** | Quello che si è scritto nella voce. I segreti non compaiono mai in elenco. |
| **Segni** | ▲ **password corta** (meno di 10 caratteri) o **uguale a un'altra** voce. La password non viene mostrata. |

**+ Aggiungi voce** apre il modulo: gruppo, titolo, utente, URL, note, **Password** (con **Genera**, che ne propone
una casuale) e **Campo in più** per altri segreti (un PIN, una risposta di sicurezza).

## Il dettaglio di una voce

Un clic sulla riga apre il dettaglio a destra. I segreti restano nascosti:

- **Mostra 30 s**: fa vedere quel segreto per trenta secondi;
- **Copia**: lo mette negli appunti senza mostrarlo.

Ogni «Mostra» e ogni «Copia» lascia una riga nel registro, col nome di chi l'ha fatto.

| Pulsante | Che cosa fa |
|---|---|
| **Modifica** | Riapre il modulo. Una password lasciata vuota resta quella di prima. |
| **Sposta** | Chiede il **Gruppo di destinazione** e sposta con **Sposta qui**. Lo storico delle versioni non segue la voce. |
| **Storico (n)** | Elenca le **Versioni di prima** (quando, titolo, utente, quali segreti c'erano, mai i valori). **Ripristina** rimette quella versione; quella di adesso va nello storico. |
| **Nel cestino** | Sposta la voce nel cestino. Da lì **Ripristina** la rimette nel gruppo da cui veniva. |
| **Cancella per sempre** | Solo dal cestino: la voce sparisce davvero. |

## Il riquadro «Accessi»

Elenca chi ha l'accesso. Tutte le azioni chiedono il **Codice dell'amministratore**:

- **Dai o ridai l'accesso**: si sceglie la **Persona** e una **Password provvisoria (14+)** da consegnarle; alla prima
  apertura dovrà cambiarla. Serve anche a chi ha dimenticato la propria password;
- **Togli l'accesso**: quella persona non apre più;
- **Sostituisci il codice (il vecchio non varrà più)**: il codice nuovo si vede una volta sola;
- **Sostituisci la chiave di recupero**: le copie fatte da quel momento si aprono solo con la chiave nuova, anch'essa
  mostrata una volta sola.

## Il riquadro «Copie dell'archivio»

DA-IPAM fa da solo una **copia cifrata** a ogni apertura e a ogni modifica, e tiene le ultime 30. La copia si apre
solo con la chiave di recupero, che non sta su questa macchina. Il riquadro dice quante sono e quando è stata fatta
l'ultima; la stessa cosa compare nella riga «Copia dell'archivio» di
[Stato della protezione](pagine/protezione.md).

- **Scarica una copia**: si sceglie una **Frase per questo file (14+)** e si dà il proprio codice a 6 cifre;
  **Scarica il file .kdbx** consegna un file KeePass normale, che si apre con KeePassXC e quella frase, senza DA-IPAM.
  Chi scarica resta scritto nel registro;
- **Importa un file KeePass (.kdbx)**: si sceglie il **File .kdbx da importare** (fino a 5 MB e 2000 voci) e la
  **Password di quel file**; le voci entrano nel gruppo «importati», coi loro gruppi sotto. Il cestino del file non
  viene importato. Gli allegati non si importano.

## Il riquadro «Registro dell'archivio»

**Mostra il registro** elenca le ultime 300 righe degli ultimi 60 giorni: chi ha aperto, letto, cambiato, da quale
indirizzo. Non contiene mai un segreto e dalla pagina non si cancella.

## Come si fa

**Dare l'accesso a un collega.** Riquadro «Accessi» → **Dai o ridai l'accesso** → scegli la persona, scrivi una
password provvisoria e il codice dell'amministratore → consegnale la password a voce. Deve avere la seconda verifica
attiva sul suo utente.

**Un collega ha dimenticato la password.** Stessa strada: **Dai o ridai l'accesso** con una password provvisoria nuova.
Le voci non si perdono.

**La macchina si è rotta.** Serve un file delle copie (cartella `archivio-utenti-copie` nei dati di DA-IPAM, o il suo
salvataggio) e la chiave di recupero. Il ripristino lo fa un tecnico: rimette archivio e serrature com'erano, e ognuno
riapre con la password che aveva.

## Cosa non c'è

Gli allegati alle voci non ci sono. Se si perdono insieme il codice dell'amministratore e tutte le password
principali, l'archivio si recupera solo da una copia con la chiave di recupero; persa anche quella, non si recupera.

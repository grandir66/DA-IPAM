---
percorso: /protezione/accessi
titolo: Chi può collegarsi — il filtro degli accessi alla macchina
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Decide **da quali indirizzi si arriva alle porte della macchina**, gruppo di porte per gruppo, e accende o spegne il
filtro che lo fa rispettare. È pensata per non chiudersi fuori: prima si osserva chi arriva, poi si prova per poco
tempo, poi si conferma.

Si arriva dalla scheda **Chi può collegarsi** di **Sicurezza › Protezione**. Solo amministratori. Nessuna schermata
nel manuale.

## Le voci della pagina

**Filtro degli accessi**: lo stato del filtro (spento, in osservazione, in prova, acceso) e l'indirizzo da cui stai
guardando. I pulsanti cambiano secondo lo stato:

- **Metti in osservazione**: il filtro conta chi arriva e non scarta nessuno.
- **Anteprima**: dice cosa cambierebbe applicando la bozza, senza toccare niente.
- **Applica in prova**: applica davvero le regole per un tempo breve, indicato sul pulsante.
- **Conferma: tieni il filtro acceso**: durante la prova, rende definitive le regole. **Annulla ora** torna subito
  alle regole di prima. Se non si conferma, alla scadenza tornano da sole le regole di prima.
- **Spegni il filtro**: chiede conferma (**Sì, spegni il filtro**).

Se all'accensione le regole sono state rifiutate, compare **Filtro in emergenza**: è caricata una politica minima, che
lascia passare solo il collegamento di gestione e gli indirizzi sempre ammessi. Si rimette in osservazione o si
applica di nuovo.

**Anteprima**: cosa cambia se applichi la bozza, e se fra gli indirizzi visti qualcuno resterebbe fuori. Avvisa
anche se resteresti fuori tu.

**Elenchi di indirizzi**: per ogni gruppo di porte, chi può arrivarci. Un elenco vuoto vuol dire nessuno, tranne i
**Sempre ammessi**. Per ogni gruppo:

- gli indirizzi o le reti ammesse, ognuno con la ✕ per toglierlo;
- il campo per aggiungerne uno (indirizzo singolo o rete) con **Aggiungi**, e il pulsante per aggiungere il tuo
  indirizzo;
- **Apri a tutti**, per i gruppi che devono restare pubblici.

Il collegamento di gestione (NetBird / DA-Link) passa sempre: è nel codice e non si toglie. Quando la bozza è diversa
dalla politica in vigore, la pagina lo dice con ▲.

**Chi resterebbe fuori**: gli indirizzi visti arrivare negli ultimi giorni che la bozza non ammette, con **Porta** e
**Gruppo**. **Ammetti in …** li aggiunge all'elenco di quel gruppo. Si riempie da quando il filtro è in osservazione o
acceso.

## Come si usa

1. Premi **Metti in osservazione**: da quel momento si vede chi arriva, senza scartare niente.
2. Dopo qualche giorno guarda **Chi resterebbe fuori** e premi **Ammetti** su chi deve entrare.
3. **Anteprima** dice cosa cambia e ti avvisa se resteresti fuori tu.
4. **Applica in prova**: se la pagina risponde ancora, premi **Conferma**; altrimenti alla scadenza tornano da sole le
   regole di prima.
5. Se resti chiuso fuori lo stesso, chiedi a chi gestisce l'appliance: dalla console della macchina il filtro si
   spegne.

## Cosa vogliono dire i segni

- ○ NetBird / DA-Link: passa sempre.
- ▲ gruppo aperto a tutti, oppure porta fuori dai gruppi, oppure bozza non ancora applicata.

## Da dove arrivano i dati

La politica scritta sulla macchina e gli indirizzi che il filtro ha visto arrivare negli ultimi giorni.

## Se la pagina è vuota

A filtro spento non si vede chi arriva: **Chi resterebbe fuori** si riempie da quando il filtro è in osservazione.
Se la pagina dice che il filtro non si può caricare da questa macchina, DA-IPAM non gira su un'appliance che lo
permette.

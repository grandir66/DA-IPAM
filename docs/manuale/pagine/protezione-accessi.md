---
percorso: /protezione/accessi
titolo: Chi può collegarsi — il filtro degli accessi alla macchina
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Decide **da quali indirizzi si arriva alle porte della macchina**, gruppo di porte per gruppo, e accende o spegne il
filtro che lo fa rispettare. È pensata per non chiudersi fuori: prima si osserva chi arriva, poi si prova per poco
tempo, poi si conferma.

Si arriva dalla scheda **Chi può collegarsi** di **Sicurezza › Protezione** (le schede sono descritte in
[Stato della protezione](pagine/protezione.md)). Solo amministratori. Nessuna schermata nel manuale.

Finché non si preme **Metti in osservazione** o **Applica in prova**, quello che si cambia nella pagina è una
**bozza**: sulla macchina non cambia niente.

## Il filtro degli accessi

La riga **Filtro degli accessi** dice lo stato del filtro (spento, in osservazione, in prova, acceso) e l'indirizzo da
cui stai guardando («tu arrivi da …»). I pulsanti cambiano secondo lo stato:

- **Anteprima**: dice cosa cambierebbe applicando la bozza, senza toccare niente.
- **Metti in osservazione**: il filtro conta chi arriva e non scarta nessuno.
- **Applica in prova (N minuti)**: applica davvero le regole per il tempo scritto sul pulsante.
- Durante la prova: **Conferma: tieni il filtro acceso** rende definitive le regole; **Annulla ora** torna subito alle
  regole di prima. Se non si conferma, alla scadenza tornano da sole le regole di prima.
- **Spegni il filtro**: chiede conferma con **Sì, spegni il filtro**.

Se all'accensione le regole sono state rifiutate, compare **Filtro in emergenza**: è caricata una politica minima, che
lascia passare solo il collegamento di gestione e gli indirizzi sempre ammessi. Si rimette in osservazione o si
applica di nuovo.

## Anteprima

Cosa cambia se applichi la bozza. Niente è ancora cambiato sulla macchina. Dice se fra gli indirizzi visti qualcuno
resterebbe fuori e avvisa se resteresti fuori tu. «La bozza è uguale alla politica in vigore» vuol dire che non c'è
niente da applicare.

## Elenchi di indirizzi

Per ogni gruppo di porte, chi può arrivarci. Un elenco vuoto vuol dire nessuno, tranne i **Sempre ammessi**. La prima
riga, **NetBird / DA-Link · nel codice, non si toglie**, ricorda che il collegamento di gestione passa sempre.

Per ogni gruppo:

- gli indirizzi o le reti ammesse, ognuno con **✕ Togli** per toglierlo;
- il campo per aggiungerne uno (un indirizzo singolo o una rete) con **Aggiungi**, e **Aggiungi il mio (…)** per
  aggiungere l'indirizzo da cui stai guardando;
- **Apri a tutti**, per i gruppi che devono restare pubblici, o **Chiudi: solo l'elenco** per tornare all'elenco.

Durante una prova gli elenchi non si cambiano. Quando la bozza è diversa dalla politica in vigore, la pagina lo dice
con ▲.

## Chi resterebbe fuori

Gli indirizzi visti arrivare negli ultimi 7 giorni che la bozza non ammette, con **Indirizzo**, **Porta** e
**Gruppo**. **Ammetti in …** li aggiunge all'elenco di quel gruppo. Si riempie da quando il filtro è in osservazione o
acceso; a filtro spento compare «Il filtro è spento: non si vede chi arriva». «Nessuno resterebbe fuori» è il caso
giusto prima di applicare.

## Come si fa

- **Accendere il filtro la prima volta senza chiudersi fuori**: **Metti in osservazione**; dopo qualche giorno guarda
  **Chi resterebbe fuori** e premi **Ammetti in …** su chi deve entrare; **Anteprima**; poi **Applica in prova**. Se la
  pagina risponde ancora, **Conferma: tieni il filtro acceso**.
- **Far entrare un nuovo ufficio**: nel gruppo giusto scrivi la rete dell'ufficio nel campo e premi **Aggiungi**, poi
  **Applica in prova** e **Conferma**.
- **Tornare indietro subito durante una prova**: **Annulla ora**.
- **Togliere un indirizzo che non serve più**: **✕ Togli** accanto all'indirizzo, poi **Anteprima** e **Applica in prova**.
- **Se resti chiuso fuori lo stesso**: aspetta la scadenza della prova; se il filtro era già confermato, chiedi a chi
  gestisce l'appliance: dalla console della macchina il filtro si spegne.

## Cosa vogliono dire i segni

- ○ NetBird / DA-Link: passa sempre.
- ▲ gruppo aperto a tutti, oppure porta fuori dai gruppi, oppure bozza non ancora applicata.

## Da dove arrivano i dati

La politica scritta sulla macchina e gli indirizzi che il filtro ha visto arrivare negli ultimi giorni.

## Se la pagina è vuota

A filtro spento non si vede chi arriva: **Chi resterebbe fuori** si riempie da quando il filtro è in osservazione. Se
la pagina dice **Il filtro non si può caricare da questa macchina**, DA-IPAM non gira su un'appliance che lo permette.

---
percorso: /settings/transfer
titolo: Trasferimento dati — esportare e importare un'istanza in un file cifrato
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Esporta la configurazione e i dati dell'istanza in un **file cifrato con estensione .dab**, e lo reimporta su
un'altra installazione o sulla stessa. Serve per spostare un cliente da un'appliance a un'altra o per tenere una
copia. Si arriva da **Config › Sistema › Trasferimento configurazione ›**. È per gli amministratori.

Per questa pagina non c'è una schermata nel manuale, per scelta. Le parti comuni sono nelle
[parti comuni dell'interfaccia](../INTERFACCIA.md). La pagina sta sotto la scheda Sistema di
[Impostazioni](pagine/settings.md#sistema).

## Le voci della pagina

`icona:download` **Export bundle**: crea il file.

- **Passphrase di cifratura**: la frase con cui il file viene cifrato (almeno 8 caratteri). Senza di lei il file non
  si riapre: va conservata a parte.
- **Livelli da esportare**: che cosa mettere nel file, a scelta:
  **Configurazione (reti, impostazioni)**, **Asset (host, device, subnet)**, **Storico (scan, log)**,
  **Mirror** (copie di DHCP, ARP, DNS). Si spuntano uno o più livelli.
- `tasto:download` **Esporta .dab** scarica il file. Il messaggio sotto dice il nome del file creato.

Un'installazione con una versione più vecchia del programma non accetta alcuni tipi di credenziali (SNMP v3,
UniFi, Omada, Active Directory) e annulla l'importazione: il file va importato su un'installazione aggiornata.

`icona:upload` **Import bundle**: carica un file.

- **File bundle (.dab)**: **Scegli file…** apre la scelta del file; accanto ne compare la dimensione.
- **Passphrase del bundle**: la stessa usata per l'esportazione.
- **Svuota il tenant prima di importare (wipe-and-load)**: cancella tutti i dati dell'istanza prima di caricare il
  file. Si usa solo per sostituire completamente l'istanza. Con questa spunta viene chiesto anche il **codice della
  verifica in due passaggi**.
- `tasto:upload` **Importa .dab** (o **Importa .dab (con wipe)**) avvia il caricamento. Alla fine un elenco dice che cosa è
  entrato; le righe segnate **Da controllare** vanno guardate a mano.

## Come si fa

- **Spostare un cliente su un'appliance nuova**: sulla vecchia spunta Configurazione e Asset, scrivi una passphrase,
  `tasto:download` **Esporta .dab**; sulla nuova, con l'istanza giusta scelta, **Scegli file…**, la stessa
  passphrase, `tasto:upload` **Importa .dab**.
- **Tenere una copia della sola configurazione**: spunta solo **Configurazione** ed esporta; conserva file e
  passphrase in posti diversi.
- **Sostituire del tutto un'istanza di prova**: importa con la casella **Svuota il tenant prima di importare**
  spuntata; ti verrà chiesto il codice della verifica in due passaggi.
- **Dopo un'importazione**: leggi il riepilogo e controlla a mano le righe **Da controllare** (per esempio
  credenziali convertite).
- **L'importazione è stata annullata**: aggiorna il programma sull'installazione di arrivo (la versione vecchia non
  accetta alcuni tipi di credenziali) e riprova.

## Da dove arrivano i dati

Dal database dell'istanza su cui stai lavorando: si esporta e si importa sempre l'istanza corrente.

## Se la pagina è vuota

La pagina ha sempre i due riquadri. Se l'importazione rifiuta il file, controlla la passphrase e la versione del
programma su cui stai importando.

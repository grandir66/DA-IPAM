---
percorso: /settings/transfer
titolo: Trasferimento dati — esportare e importare un'istanza in un file cifrato
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Esporta la configurazione e i dati dell'istanza in un **file cifrato con estensione .dab**, e lo reimporta su
un'altra installazione o sulla stessa. Serve per spostare un cliente da un'appliance a un'altra o per tenere una
copia. Si arriva da **Config › Sistema › Trasferimento configurazione ›**. È per gli amministratori.

Per questa pagina non c'è una schermata nel manuale.

## Le voci della pagina

**Export bundle**: crea il file.

- **Passphrase di cifratura**: la frase con cui il file viene cifrato (almeno 8 caratteri). Senza di lei il file non
  si riapre: va conservata a parte.
- **Livelli da esportare**: che cosa mettere nel file, a scelta:
  **Configurazione** (reti, impostazioni), **Asset** (host, apparati, subnet), **Storico** (scansioni, registri),
  **Mirror** (copie di DHCP, ARP, DNS).
- **Esporta .dab** scarica il file. Il messaggio sotto dice il nome del file creato.

Un'installazione con una versione più vecchia del programma non accetta alcuni tipi di credenziali (SNMP v3,
UniFi, Omada, Active Directory) e annulla l'importazione: il file va importato su un'installazione aggiornata.

**Import bundle**: carica un file.

- **File bundle (.dab)**: **Scegli file…** apre la scelta del file; accanto ne compare la dimensione.
- **Passphrase del bundle**: la stessa usata per l'esportazione.
- **Svuota il tenant prima di importare (wipe-and-load)**: cancella tutti i dati dell'istanza prima di caricare il
  file. Si usa solo per sostituire completamente l'istanza. Con questa spunta viene chiesto anche il **codice della
  verifica in due passaggi**.
- **Importa .dab** (o **Importa .dab (con wipe)**) avvia il caricamento. Alla fine un elenco dice che cosa è
  entrato; le righe segnate **Da controllare** vanno guardate a mano.

## Come si usa

1. Sull'installazione di partenza: scegli i livelli, scrivi una passphrase, **Esporta .dab**.
2. Sull'installazione di arrivo, con l'istanza giusta scelta: **Scegli file…**, scrivi la stessa passphrase,
   **Importa .dab**.
3. Leggi il riepilogo e controlla le righe **Da controllare**.

## Da dove arrivano i dati

Dal database dell'istanza su cui stai lavorando: si esporta e si importa sempre l'istanza corrente.

## Se la pagina è vuota

La pagina ha sempre i due riquadri. Se l'importazione rifiuta il file, controlla la passphrase e la versione del
programma su cui stai importando.

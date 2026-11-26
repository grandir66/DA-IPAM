---
percorso: /rmm/[hostId]/senza-agente
titolo: Desktop remoto senza agente (RDP o VNC)
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Apre il **desktop remoto di un computer che non ha l'agente MeshCentral**, usando RDP (Windows) o VNC. La sessione la
apre il server MeshCentral dell'appliance collegandosi lui all'indirizzo del computer; le credenziali del computer si
scrivono dentro la sessione, come in un normale desktop remoto.

Si arriva dal menu `icona:more-vertical` di una riga di [Apparati](pagine/discovery.md) (`icona:monitor` **Desktop
remoto (RDP)** o **VNC**), dall'icona `icona:monitor` della colonna Profilo, o dai pulsanti RDP/VNC nella
[scheda dell'host](pagine/objects-id.md). Queste voci ci sono solo se nelle impostazioni del modulo MeshCentral il
desktop remoto senza agente è acceso e il computer ha la porta giusta aperta.

Nessuna schermata: aprire la pagina avvia una sessione vera sul computer. Le parti che si ripetono in tutte le pagine
sono nelle [parti comuni dell'interfaccia](../INTERFACCIA.md).

## La barra in alto

- `tasto:arrow-left` **Torna all'host**: torna alla [scheda dell'host](pagine/objects-id.md).
- Il tipo di sessione, **Desktop remoto (RDP)** o **VNC**, con la nota «senza agente, le credenziali si inseriscono
  nella sessione».
- `tasto:refresh` **Riconnetti**: chiede una sessione nuova. Ogni connessione usa un accesso monouso.
- `tasto:external-link` **Apri in una scheda separata**: apre la sessione in una scheda nuova del browser.

Sotto, il riquadro con il desktop del computer.

## Se il riquadro resta vuoto

Sotto il riquadro compare «Il riquadro resta vuoto?»: quasi sempre il browser non ha ancora accettato il certificato di
MeshCentral. **Apri MeshCentral in una scheda**, accetta l'avviso del browser, torna qui e premi **Riconnetti**.

## Come si fa

- **Entrare su un server Windows senza agente**: in [Apparati](pagine/discovery.md), `icona:more-vertical` sulla riga ›
  **Desktop remoto (RDP)**, poi utente e password del server nella schermata di accesso.
- **Raggiungere un apparato con VNC** (un pannello, un vecchio PC): `icona:more-vertical` › **VNC**.
- **La sessione è caduta**: `tasto:refresh` **Riconnetti**.
- **Tenere la sessione aperta mentre lavori in DA-IPAM**: `tasto:external-link`.
- **Lavorarci spesso**: installa l'agente MeshCentral e usa la [sessione con l'agente](pagine/rmm-hostid.md), che non
  chiede credenziali.

## Da dove arrivano i dati

Dal server MeshCentral dell'appliance, che si collega all'indirizzo del computer con RDP o VNC.

## Se la pagina è vuota

Un messaggio d'errore con **Riprova** vuol dire che il server MeshCentral non è riuscito ad aprire la sessione: il
computer è spento, la porta RDP o VNC è chiusa, oppure il desktop remoto senza agente è spento nelle impostazioni.

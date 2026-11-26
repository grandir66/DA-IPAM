---
percorso: /rmm/[hostId]/senza-agente
titolo: Desktop remoto senza agente (RDP o VNC)
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Apre il **desktop remoto di un computer che non ha l'agente MeshCentral**, usando RDP (Windows) o VNC. La sessione la
apre il server MeshCentral dell'appliance collegandosi lui all'indirizzo del computer; le credenziali del computer si
scrivono dentro la sessione, come in un normale desktop remoto. Si arriva dal menu **⋮** di una riga di
[Apparati](pagine/discovery.md) (**Desktop remoto (RDP)** o **VNC**) o dai pulsanti RDP/VNC nella scheda dell'host.
Queste voci ci sono solo se nelle impostazioni del modulo MeshCentral il desktop remoto senza agente è acceso e il
computer ha la porta giusta aperta.

Nessuna schermata: aprire la pagina avvia una sessione vera sul computer.

## Le voci della pagina

- **Torna all'host**: torna alla scheda dell'host.
- Il tipo di sessione, **Desktop remoto (RDP)** o **VNC**, con la nota «senza agente, le credenziali si inseriscono
  nella sessione».
- **Le due frecce** (Riconnetti): chiedono una sessione nuova. Ogni connessione usa un accesso monouso.
- **La freccia che esce** (Apri in una scheda separata): apre la sessione in una scheda nuova del browser.
- Il riquadro con il desktop del computer.

## Se il riquadro resta vuoto

Quasi sempre il browser non ha ancora accettato il certificato di MeshCentral. **Apri MeshCentral in una scheda**,
accetta l'avviso del browser, torna qui e premi **Riconnetti**.

## Come si usa

1. Dal menu **⋮** dell'apparato scegli **Desktop remoto (RDP)** (per Windows) o **VNC**.
2. Quando compare la schermata di accesso del computer, scrivi utente e password del computer.
3. Se la sessione cade, premi le due frecce.

## Da dove arrivano i dati

Dal server MeshCentral dell'appliance, che si collega all'indirizzo del computer con RDP o VNC.

## Se la pagina è vuota

Un messaggio d'errore con **Riprova** vuol dire che il server MeshCentral non è riuscito ad aprire la sessione: il
computer è spento, la porta RDP o VNC è chiusa, oppure il desktop remoto senza agente è spento nelle impostazioni.

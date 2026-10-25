# Verifica della guida — 26/10/2026

- Fonte del prodotto invariata: commit `76b15198`, v0.9.913.
- Canvas: TypeScript strict senza errori (`tsc --noEmit --skipLibCheck --strict --jsx react-jsx --target ES2021 --module ESNext --moduleResolution bundler --lib ESNext,DOM <canvas>`).
- HTML autonomo generato dai contenuti condivisi: 17 capitoli, 10 immagini incorporate, font Signika incorporato, nessuna dipendenza di rete necessaria.
- Browser desktop 1280×960: aperti tutti i 17 capitoli, titoli corrispondenti, 10 immagini caricate a risoluzione originale 1440×1000, nessuna eccedenza orizzontale della pagina.
- Verificati ricerca «KeePass», selezione passaggio «Approfondire», selezione richiamo 2, apertura dell’immagine e chiusura con Escape.
- Osservata resa completa della pagina iniziale; controllate le 10 catture originali. Scartata la cattura dedicata VLAN/reti che mostrava la scheda sbagliata: capitolo conservato con schema e limite esplicito.
- Corretto nel generatore l’avvio di esbuild: nel repo è un binario nativo, non uno script da passare a Node. Rigenerazione e typecheck riusciti.
- Prime catture durante la compilazione potevano mostrare caricamenti o animazioni: quelle incluse sono state controllate e non presentano tali stati transitori. I dati vuoti per integrazioni scollegate sono reali stati di laboratorio, dichiarati.
- Nessun test applicativo o collaudo di rete dichiarato. Nessuna scansione, patch, migrazione o operazione su dati cliente. Nessun deploy.
- La pagina statica è stata servita solo per la verifica, senza riavviare Next. La consultazione dell’HTML è offline; il server di prova viene chiuso a fine verifica.

## Limiti della prima edizione

Le schermate coprono il nucleo e le nuove pagine disponibili nel laboratorio. Topologia popolata, AD, VA/SIEM, DNS/DHCP e patch/remoto sono spiegati con flussi e fonti, senza fingere un’integrazione attiva. Per un’edizione con schermate complete di tutti i moduli servono fixture dedicate e catture successive, dopo accordo sul lavoro. Le integrazioni e i sistemi del cliente non sono stati contattati.


## Rettifica della copertura — 26/10/2026

Il primo controllo dimostrava che i 17 capitoli iniziali erano navigabili, non la completezza dell’analisi o delle schermate. Non va usato per dichiarare la guida conclusa.

- Censite 66 pagine dashboard del commit, con 9 alias espliciti; pagine dinamiche, tab e varianti non si contano come immagini acquisite.
- Aggiunte 99 schede documentali selezionabili, incluse varianti per tipo, 13 configurazioni modulo, tab di impostazioni e accessi fuori dal gruppo dashboard. Ogni pagina del censimento ha un legame al dettaglio. I contenuti sono riscontri del sorgente, non altrettante prove runtime.
- Browser statico 1280×960: aperte tutte le 99 schede, titoli corrispondenti, immagini presenti decodificate, nessun overflow. Matrice: 66 righe, filtro immagini mancanti/parziali 47 percorsi. Verificato il salto dalla riga /inventory/[id] al dettaglio della scheda asset.
- TypeScript strict del canvas verde dopo le modifiche; HTML generato dagli stessi contenuti.
- Nuove catture controllate: dettaglio subnet, credenziali e controller. Totale 13 immagini, tutte dimostrative. Il controller è scollegato: la cattura non dimostra una sincronizzazione.
- Fixture estese solo nei database del laboratorio: software, CVE fittizia CVE-2099-0001, AD sintetica, servizi, licenze, storico patch. Nessuna scansione o modifica a sistemi cliente. Questi dati non sono attestazioni di operazioni realmente avvenute.
- Tentativi di laboratorio interrotti: heap 1536 MiB e 3072 MiB; entrambi raggiungono la soglia di riavvio automatico Next (80% dell’heap, start-server.js), provocando stream incompleti e connessioni rifiutate. Log nello scratchpad. Mac 24 GiB, 46% libero alla misura: non prova la causa del blocco precedente. Nessun terzo tentativo locale. Processi dimostrativi chiusi.
- Resta da scegliere un ambiente per le catture complete; richiesta a Riccardo via domanda, nessun lavoro remoto o altra sessione avviati.

La documentazione ampliata non chiude il lavoro delle immagini. Lo stato corrente nella guida è **in completamento**.

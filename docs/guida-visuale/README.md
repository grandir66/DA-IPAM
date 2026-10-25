# Guida visuale DA-IPAM — in completamento

**Rettifica del 26/10/2026:** la prima edizione era una panoramica, non la copertura completa richiesta. L’HTML corrente espone la matrice delle 66 pagine dashboard e 99 schede dedicate, con 13 catture. I 47 percorsi senza immagine completa restano aperti, oltre alle sottoviste da acquisire. Vedi `copertura.json`, la pagina «Copertura, lacune e stati» e `VERIFICA.md`.


Guida navigabile richiesta da Riccardo: percorsi di lavoro, schemi, schermate e spiegazione delle funzioni.

- **Apri `DA-IPAM-guida.html`**: file autonomo, immagini e font incorporati, utilizzabile offline e senza DA-IPAM acceso.
- Versione canvas: `/Users/riccardo/.cursor/projects/Users-riccardo-Progetti-Domarc/canvases/DA-IPAM-guida-funzionamento.canvas.tsx`.
- Contenuti modificabili: `contenuti.json`; dettaglio e fonti nel catalogo `../CATALOGO-FUNZIONALE.md`.
- Fonte del prodotto: `origin/dev` `76b15198`, versione 0.9.913, verificata il 25/10/2026. Composizione della guida 26/10/2026.
- Catture in `schermate/`: UI autentica, 1440×1000, dati sintetici (DEMO; indirizzi TEST-NET), nessun cliente collegato.
- Ambiente sorgente isolato: `/private/tmp/ipam-analisi-20261025`; avvio Next dev sulla 3187, senza scheduler. Server già spento dopo l’interruzione del 25/10. Non occorre riaccenderlo per consultare la guida.
- Trunk: osservazioni e rilievi sintetici inseriti nei DB; nessuna cattura da rete reale. Il sensore risulta scollegato. Vault e integrazioni restano spenti: le immagini non ne fingono attivazione o collaudo.
- Le prime catture con caricamenti/animazioni sono state sostituite dove verificato; i badge Next.js/feedback sono strumenti della modalità sviluppo.
- Rilevato avviso Base UI sul link usato come button nella pagina trunk: semantica `nativeButton`; nessuna correzione applicata in questo lavoro documentale.
- I flussi sono schemi esplicativi del codice, non tracciati di esecuzione né traffico misurato. La sezione evoluzioni contiene proposte, non attività autorizzate.

## Manutenzione

Prima di pubblicare una nuova edizione, aggiornare commit e copertura dal catalogo, rigenerare le catture interessate e verificare di nuovo navigazione e resa. Le immagini restano separate e l’HTML/canvas le incorpora per la consultazione offline. Sorgenti permanenti in `sorgenti/`: `template.txt` e `costruisci.py`. Modificare `contenuti.json`, poi eseguire `python3 sorgenti/costruisci.py` (richiede Node 22 e le dipendenze esbuild/react del repo). Il font è incluso in `assets/Signika.ttf`. Il generatore produce HTML autonomo e canvas senza avviare l’applicazione.

## Catture escluse

La prima cattura dedicata a VLAN/reti mostrava ancora la scheda sicurezza: scartata, senza ricostruirla artificialmente. La guida include 10 schermate controllate; il capitolo VLAN/reti usa lo schema esplicativo.

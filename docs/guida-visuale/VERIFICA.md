# Verifica della guida — 26/10/2026

Fonte applicativa congelata: `76b15198`, v0.9.913. Guida composta e controllata il 26/10. L’edizione corrente sostituisce la prima panoramica insufficiente di 17 capitoli e 10 immagini.

## Edizione con atlante — correzione della consultazione

Riccardo vedeva solo i capitoli e poche immagini: le aggiunte erano nascoste nei selettori e nelle gallerie chiuse. La pagina iniziale ora è un atlante con 175 miniature per area; ogni area espone i collegamenti alle schede, anche nell’indice, e le gallerie sono aperte. Dicitura iniziale «EDIZIONE CON ATLANTE · 26 OTTOBRE 2026». Aree ora 19, schede invariate 99.

Verifica della correzione: build HTML verde, TypeScript strict exit 0; rendering React lato server con 175 pulsanti miniatura nell’apertura, titoli, collegamenti diretti e gallerie AD aperte. Esito in `verifica-atlante.json`. Non è una nuova verifica interattiva del browser: lo strumento non consente di osservare la scheda file:// dell’utente. I risultati Chromium sottostanti si riferiscono all’edizione precedente di 18 aree.

## Esito attuale

- 18 aree, 99 schede, censimento di 66 file dashboard e 9 alias. 175 schermate originali, incluse tab e varianti, da dati sintetici. Matrice navigabile nel capitolo «Copertura, lacune e stati».
- Canvas TypeScript strict verde, exit 0: `tsc --noEmit --skipLibCheck --strict --jsx react-jsx --target ES2021 --module ESNext --moduleResolution bundler --lib ESNext,DOM <canvas>`.
- HTML offline verificato su Chromium del mini, 1280×960: aperte 18 aree e tutte le 99 schede, titoli corrispondenti, 175 immagini decodificate nelle schede; nessun errore JavaScript, nessun overflow della pagina. Matrice 66 righe, filtro parziali 10. Zoom galleria ed Escape verificati. Script: `scripts/guida-demo/verifica-guida.cjs`, exit 0. Risultati in `verifica-browser.json`.
- Screenshot finali della resa: `verifica-overview.png`, `verifica-trunk.png`, `verifica-copertura.png`. Immagini applicative 1440×1000, hash in `schermate/provenienza.json`; percorsi e testi osservati nei registri `*-catture.json`.
- Asset NIS2 e ITAM esteso, cinque tab AD, impostazioni, tredici configurazioni modulo e famiglie switch/router-MikroTik/NAS/hypervisor/Windows/Linux/generica acquisite. Le sezioni senza raccolta reale restano indicate come tali. La variante gestita generica è distinta dalla schermata dell’host non gestito.
- Trunk: acquisite entrambe le tab; osservazioni e rilievi sintetici, sonda scollegata. Nessuna analisi di pacchetti reali.
- Vault: creato archivio locale esclusivamente sintetico; sblocco via UI riuscito. API export KDBX 200, 1669 byte, 3 voci; key file 200, 277 byte. Registro acquisito. Non è una prova di apertura in tutti i client KeePass né di recupero, OpenBao o TPM. Metadati in `schermate/vault-demo-verifica.json`; file esportati e chiavi non pubblicati.
- Login e primo setup acquisiti; setup su un database dimostrativo separato, senza completare l’installazione o creare utenti reali.

## Limiti e correzioni

Dieci percorsi restano parziali/condizionali nella matrice: sensore trunk scollegato; DNS, DHCP e Network Services non collegati; RMM, SIEM e Zabbix senza servizio esterno; ramo legacy `/devices/[id]` non riprodotto (nella demo inoltra all’elenco). Questo limita l’evidenza visiva, non elimina le descrizioni dal sorgente. Le console di terze parti non sono schermate native di DA-IPAM.

Scartate le catture con caricamento, tab errata o chiave software non valida. Esclusa anche la cattura immediata dopo lo sblocco vault, che conservava il banner bloccato del layout: nella guida si usa la vista ricaricata con stato e registro coerenti. Il dettaglio software corretto usa `Editor Demo|1.0`. Le immagini storiche della prima edizione restano etichettate con la loro data; non sono prove aggiuntive di funzionamento.

Il laboratorio Next dev si riavviava alla soglia di memoria con heap 1536/3072 MiB sul MacBook; niente terzo tentativo locale. Sul mini anche Webpack dev a 6144 MiB accumulava memoria: la diagnosi ha portato a build ottimizzata (`next build`, exit 0) e `next start`, con acquisizione conclusa. Non si è modificato codice applicativo per aggirare il problema.

Nessuna scansione, patch, import distruttivo o modifica a sistemi cliente. Gli storici operativi sono fixture sintetiche, incluse la CVE fittizia `CVE-2099-0001` e l’operazione patch dimostrativa. Nessun scheduler avviato. Server demo 3187/3189 spenti e tunnel chiuso; nessun listener residuo verificato sul mini. Nessun deploy o push su dev/main.

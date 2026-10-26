# Guida visuale DA-IPAM

Apri `DA-IPAM-guida.html`: guida navigabile autonoma, utilizzabile offline, con immagini e font incorporati. Fonte applicativa congelata: `76b15198`, versione 0.9.913, esaminata il 25–26/10/2026.

La guida comprende 18 aree, 99 schede di dettaglio e la matrice delle 66 pagine dashboard. Le 175 immagini includono pagine, tab, configurazioni e varianti per tipo di apparato. Non sono 175 funzioni collaudate: alcune immagini mostrano stati vuoti o prerequisiti mancanti, dichiarati nella matrice.

## Cosa è stato acquisito

- Demo dedicata sul Mac mini, autorizzata da Riccardo, Node 22; dati TEST-NET e domini `.invalid`, nessun sistema cliente collegato.
- Active Directory con computer, utenti, gruppi, lease e Health; inventario NIS2 e ITAM esteso; servizi, licenze, patch con CVE fittizia, pagine di amministrazione e tredici configurazioni modulo.
- Schede switch, router/MikroTik, NAS, hypervisor, Windows, Linux e generica, con tab disponibili. Le raccolte hardware non eseguite restano visibili come mancanti.
- Trunk: entrambe le tab con osservazioni e rilievi sintetici; sensore scollegato, nessuna acquisizione da rete reale.
- Vault locale sintetico: bloccato, sblocco, export e registro. API KDBX e key file riuscite; non è un collaudo di OpenBao, TPM o ripristino su installazioni cliente.

## Limiti espliciti

DNS/DHCP gestiti, RMM e SIEM/Zabbix mostrano i rispettivi stati senza servizio esterno; il ramo legacy della vecchia scheda apparato non è stato riprodotto. Le console esterne non sono schermate native di DA-IPAM. Nessuna scansione o patch realmente eseguita; gli storici demo sono sintetici. I diagrammi spiegano il codice e i consigli restano proposte.

Il laboratorio dev Webpack si riavviava per accumulo di memoria, anche sul mini: acquisizione conclusa con build ottimizzata e `next start`, senza scheduler. Nessuna modifica al prodotto o deploy in esercizio. Le prime catture errate o in caricamento non sono usate come prova; la cattura software con chiave errata è esclusa.

## Manutenzione

Contenuti: `contenuti.json`; censimento: `copertura.json`; immagini e hash: `schermate/provenienza.json`; verifica: `VERIFICA.md`. Il catalogo testuale è `../CATALOGO-FUNZIONALE.md`. Per rigenerare: `python3 sorgenti/costruisci.py`, con Node 22 e dipendenze esbuild/react del repo. Il generatore scrive HTML e canvas usando lo stesso componente. Gli script `scripts/guida-demo/` lavorano esclusivamente sulla demo; database, chiavi ed env non sono in Git.

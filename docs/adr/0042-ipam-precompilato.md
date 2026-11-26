# ADR 0042 — Le appliance scaricano IPAM già compilato e firmato

**Stato:** Accepted
**Data:** 2026-11-26
**Autore:** Riccardo Grandi, con Claude

## Contesto

La ridotta (ADR 0035) gira su mini PC da 8 GB con Proxmox e una VM da 4 GB. Il 26/11, su `pxdown` limitato a 8 GB,
compilare IPAM 0.9.1261 dentro la VM ha portato la RAM disponibile a 104 MB e lo swap a 1,76 GB; compilare il `dev`
di quel giorno (0.9.1361) è fallito per memoria esaurita di Node. Al lavoro IPAM usa circa 1,1 GB: il picco viene solo
dalla compilazione.

## Decisione

Riccardo, 26/11: «IPAM precompilato»; compila GitHub Actions, il pacchetto sta in una Release GitHub, se manca si
compila come oggi.

- `scripts/rilascia-main.sh` spinge la fusione firmata su `rilascio/<versione>`; `.github/workflows/build-appliance.yml`
  la compila in `/opt/da-ipam` (Next scrive il percorso nella build) per `.next-a` e `.next-b`, senza `.map`, e allega
  due pacchetti da ~28 MB alla Release `pacchetto-<commit>`.
- Chi rilascia scarica i pacchetti e firma il tag `build-<commit>` con la chiave dei rilasci, con gli sha256 dentro.
  Solo dopo si muove `main`.
- `scripts/update.sh` chiama `scripts/lib/build-firmata.sh`: tag firmato da un firmatario del commit di prima, che punta
  al commit in arrivo, sha256 uguale → scompatta. Ogni altro caso compila come prima e lo scrive nello stato.
- Solo `main`; `dev` (hub e laboratorio) compila come prima.

## Alternative scartate

- **Firmare nel CI**: la chiave dei rilasci finirebbe su GitHub, contro l'ADR 0039.
- **Compilare sul Mac in un container**: emulazione amd64, 10-20 minuti a rilascio.
- **VM a 5 GB**: sposta il margine dalla VM all'host e non regge la crescita del codice.
- **Fermarsi se manca il pacchetto**: una Release mancata fermerebbe tutto il parco.

## Conseguenze

### Positive

- Aggiornamento in 24 s invece di 3-4 minuti, RAM disponibile mai sotto 2,9 GB nella VM da 4 GB (prova del 26/11).
- IPAM fermo meno a lungo: la scansione in corso si interrompe per secondi, non minuti.

### Negative

- Un rilascio dura ~5 minuti in più (CI) e chiede la passphrase due volte.
- La prima volta ogni appliance compila ancora: il vecchio `update.sh` non conosce il pacchetto.

## Cosa diventa difficile in futuro

- GitHub Actions entra nella catena di rilascio: se è giù si rilascia con `--senza-build` e le appliance compilano.
- Un'appliance fuori da `/opt/da-ipam` compila sempre; spostare il percorso vuol dire cambiare il workflow.
- Le VM da 4 GB già installate con un `update.sh` vecchio possono non riuscire a fare quel primo aggiornamento.

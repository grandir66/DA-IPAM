# Piano — IPAM precompilato e firmato per le appliance

**Data:** 2026-11-26 · **Livello:** completo (tocca come si aggiornano tutte le appliance dei clienti, zona rossa)
**Perché:** il 26/11 su `pxdown` limitato a 8 GB la compilazione di IPAM dentro la VM da 4 GB ha portato la RAM
disponibile a 104 MB e lo swap a 1,76 GB (TASKS, sezione «IPAM ridotto»). Senza compilazione la VM da 4 GB resta larga.
**Scelte di Riccardo (26/11):** compila GitHub Actions · pacchetto in una Release GitHub del repo (pubblico) ·
se manca o la firma non torna l'appliance compila come oggi.

## Come funziona

1. `rilascia-main.sh --applica` fa la fusione firmata come oggi, ma invece di spingerla subito su `main` la spinge
   su `rilascio/<versione>`. Le appliance non la vedono.
2. Il CI (`.github/workflows/build-appliance.yml`, su `rilascio/**`) la compila su Ubuntu 24.04 con Node 22
   **nel percorso `/opt/da-ipam`** (la build lo scrive dentro 20 file) due volte, `.next-a` e `.next-b` (la cartella
   è scritta dentro le rotte compilate), senza i `.map`, e allega i due `tar.zst` a una Release `build-<sha>`.
3. Lo script aspetta il CI (`gh run watch`), scarica i due pacchetti, ne calcola lo sha256 e crea il **tag firmato**
   `build-<sha>` (stessa chiave, stesso `git verify-tag` dei firmatari installati, nessun formato nuovo), con gli
   sha256 nel messaggio. Poi spinge tag e `main`. Se il CI fallisce: si ferma, `main` non si muove.
4. Sull'appliance `update.sh`, alla fase build, prova prima `scripts/lib/build-firmata.sh`: tag `build-<commit>`
   presente e firmato da un firmatario della copia installata, pacchetto scaricato, sha256 uguale, si scompatta
   nella cartella libera. Ogni «no» o «non so» → riga nella pagina Aggiornamenti e `npm run build` come oggi.
   Solo per `main`: hub e laboratorio su `dev` compilano come oggi.
5. La prima volta ogni appliance compila ancora (prende così il nuovo `update.sh`); dalla seconda scarica.

## Passi

- [x] 1. `scripts/lib/build-firmata.sh` + prove bash (tag mancante, firma sbagliata, sha diverso, pacchetto per
       l'altra cartella, rete giù → sempre «compila»; tutto giusto → scompattata)
- [x] 2. `update.sh`: aggancio alla fase build, `DA_COMMIT` scritto come oggi, esito nello stato
- [x] 3. Workflow CI `build-appliance.yml` e prova su un ramo `rilascio/prova` (senza tag firmato)
- [x] 4. `rilascia-main.sh`: ramo di passaggio, attesa del CI, tag firmato, poi `main`; prova a vuoto
- [x] 5. Prova vera sul laboratorio: VM `79993-ipam-11` su `pxdown` limitato a 8 GB, puntata a un ramo di prova
       con un tag firmato con una chiave di prova aggiunta solo lì. Misura: memoria, durata, un caso di ripiego
- [x] 6. CHANGELOG, CONTEXT, ADR breve (cosa diventa difficile: il CI diventa un pezzo della catena di rilascio)
- [ ] 7. Rilascio su `main`: **lo lancia Riccardo** (passphrase della chiave), dopo il suo sì

Fuori: il precompilato per il centrale e per `dev`; togliere le devDependencies dalle appliance.

## Consuntivo (26/11)

- **Fatto**: `scripts/lib/build-firmata.sh` (7 prove in `src/lib/__tests__/build-firmata.test.ts`, verdi), aggancio in
  `update.sh`, workflow `build-appliance.yml` (4 minuti, due pacchetti da 28 MB), `rilascia-main.sh` con `firma_build`
  e `--senza-build`, ADR 0042.
- **Prova sul laboratorio** (VM `79993-ipam-11` su `pxdown` limitato a 7,7 GB, snapshot prima e ritorno dopo): con il
  vecchio `update.sh` la compilazione del `dev` attuale è fallita per memoria esaurita di Node dopo 188 s ed è tornata
  indietro da sola; con lo `update.sh` nuovo (firmatari di prova al posto di quelli del commit di prima, unica
  differenza) build scaricata, firma buona, aggiornamento completo in 24 s, RAM disponibile minima 2,9 GB, `/login` 200.
  Rami, tag e Release di prova tolti.
- **Non verificato**: `rilascia-main.sh --applica` per intero (serve la tua chiave); il ripiego dello script intero
  (coperto dalle prove della funzione).
- **Scostamenti**: i pacchetti stanno nella Release `pacchetto-<commit>`, non `build-<commit>`, per non scontrarsi col
  tag firmato. Scoperto che il `dev` attuale non si compila più in 4 GB.
- **Consigli**: rifare l'immagine della ridotta dopo il prossimo rilascio, così le installazioni nuove partono con lo
  `update.sh` nuovo; sulle ridotte già installate il primo aggiornamento va accompagnato.

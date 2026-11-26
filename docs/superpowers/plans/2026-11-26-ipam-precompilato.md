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

- [ ] 1. `scripts/lib/build-firmata.sh` + prove bash (tag mancante, firma sbagliata, sha diverso, pacchetto per
       l'altra cartella, rete giù → sempre «compila»; tutto giusto → scompattata)
- [ ] 2. `update.sh`: aggancio alla fase build, `DA_COMMIT` scritto come oggi, esito nello stato
- [ ] 3. Workflow CI `build-appliance.yml` e prova su un ramo `rilascio/prova` (senza tag firmato)
- [ ] 4. `rilascia-main.sh`: ramo di passaggio, attesa del CI, tag firmato, poi `main`; prova a vuoto
- [ ] 5. Prova vera sul laboratorio: VM `79993-ipam-11` su `pxdown` limitato a 8 GB, puntata a un ramo di prova
       con un tag firmato con una chiave di prova aggiunta solo lì. Misura: memoria, durata, un caso di ripiego
- [ ] 6. CHANGELOG, CONTEXT, ADR breve (cosa diventa difficile: il CI diventa un pezzo della catena di rilascio)
- [ ] 7. Rilascio su `main`: **lo lancia Riccardo** (passphrase della chiave), dopo il suo sì

Fuori: il precompilato per il centrale e per `dev`; togliere le devDependencies dalle appliance.

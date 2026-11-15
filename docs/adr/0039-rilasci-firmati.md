# ADR 0039 — I rilasci su `main` sono firmati, dal Mac di chi rilascia

- **Data**: 2026-11-15
- **Stato**: accettato (Riccardo, 15/11/2026: «Dal Mac, firmato»; «Prima avvisa, poi blocca»)

## Contesto

Ogni appliance scarica `main` ogni 15 minuti e lo esegue da root (`scripts/auto-update.sh`). Niente controllava chi
avesse scritto quel commit: bastava l'account GitHub, un gettone, o il pulsante «Promuovi dev → main»
dell'installazione centrale, che pubblicava con un gettone GitHub custodito là. Volume cifrato e vault non fermano
un rilascio malevolo, perché il codice nuovo gira dove le password si usano.

## Decisione

- Un rilascio è la fusione di `origin/dev` in `origin/main`, **firmata con una chiave SSH dedicata** che sta solo sul
  Mac di chi rilascia (e in copia nel suo archivio di password). La fa `scripts/rilascia-main.sh`: a vuoto di serie,
  `--applica` pubblica dopo una conferma scritta.
- Le appliance controllano la firma del commit in punta (`scripts/lib/guardia-firma.sh`, chiamata da
  `auto-update.sh` e `update.sh` prima di ogni checkout o fusione) contro `deploy/firmatari-rilasci`, **letto dalla
  copia installata** e non dal commit in arrivo.
- Modo per installazione, `DA_INVENT_FIRMA_RILASCI`: `avvisa` (di serie: scrive e procede), `blocca`, `spenta`. Si
  controlla solo `main` (`DA_INVENT_FIRMA_RAMI`); `dev` lo seguono l'hub e il laboratorio.
- Il pulsante «Promuovi» e la rotta che pubblicava sono tolti; resta l'anteprima. Il gettone GitHub salvato
  sull'installazione centrale non serve più: va tolto e revocato.

## Conseguenze

- Chi prende l'installazione centrale o l'account GitHub non può più far installare codice alle appliance in modo
  `blocca`. In modo `avvisa` la protezione **non c'è ancora**: c'è solo la traccia.
- Si rilascia solo dal Mac che ha la chiave. Persa la chiave (e la copia), le appliance in `blocca` non si aggiornano
  più finché non ci si entra una per una a cambiare `deploy/firmatari-rilasci`.
- Cambio di chiave: un rilascio firmato con la vecchia che aggiunge la nuova, poi uno che toglie la vecchia.

## Cosa diventa difficile in futuro

- Un rilascio d'urgenza da un'altra macchina o da un agente senza la chiave: non si può, per scelta.
- Il ritorno indietro a un commit vecchio non firmato su un'appliance in `blocca`: va fatto a mano.
- Non copre `npm install`: le dipendenze si scaricano ancora senza altra verifica che il `package-lock.json` firmato.

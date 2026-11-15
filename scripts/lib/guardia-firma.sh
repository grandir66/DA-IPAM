#!/bin/bash
# DA-INVENT — un rilascio si installa solo se è firmato da chi può rilasciare.
#
# Analisi del 15/11/2026: ogni appliance scarica `main` ogni 15 minuti e lo esegue da root. Senza una firma, chi
# riesce a scrivere su `main` (account GitHub, un gettone, l'installazione centrale) comanda tutte le appliance.
# `guardia_firma <ramo>` controlla la firma SSH del commit in punta a `origin/<ramo>` (il fetch l'ha già fatto chi
# chiama) contro i firmatari di `deploy/firmatari-rilasci`, letti dalla copia INSTALLATA e non dal commit in arrivo.
# Si firma il commit di rilascio (la fusione di dev in main fatta da `scripts/rilascia-main.sh`): chi firma risponde
# di tutto l'albero, i commit sotto non devono essere firmati.
#
# Modo, da DA_INVENT_FIRMA_RILASCI:
#   avvisa  (di serie) la firma mancante o sbagliata si scrive e si va avanti: serve al passaggio delle appliance in uso
#   blocca  senza firma buona l'aggiornamento non parte (anche se la verifica stessa non si può fare: mai al buio)
#   spenta  nessun controllo
# Rami controllati, da DA_INVENT_FIRMA_RAMI (di serie «main»): `dev` lo seguono solo l'hub e il laboratorio.
# Risponde 0 = si procede, 1 = fermo. Stampa una riga che comincia con «firma: ». Si usa con `source` dalla cartella
# dell'app. Gira uguale su Linux e sul Mac (git >= 2.34 e ssh-keygen).

# Scrive l'ultimo esito dove la pagina Aggiornamenti lo legge. Non deve mai fermare l'aggiornamento.
_firma_scrivi_esito() {
  # Accanto al file di stato dell'aggiornamento (data/aggiornamento.json). La cartella non si crea: se non c'è,
  # non si scrive (una cartella `data` nata qui dentro l'albero farebbe fallire lo stash di update.sh).
  local file="${DA_INVENT_FIRMA_ESITO:-}"
  if [ -z "$file" ]; then
    if [ -n "${DA_INVENT_STATO_AGGIORNAMENTO:-}" ]; then file="$(dirname "$DA_INVENT_STATO_AGGIORNAMENTO")/firma-rilasci.json"
    else file="${DA_INVENT_DATA_DIR:-$PWD/data}/firma-rilasci.json"; fi
  fi
  [ -d "$(dirname "$file")" ] || return 0
  node -e '
    const [file, ramo, commit, esito, modo, motivo] = process.argv.slice(1);
    const fs = require("fs");
    try {
      fs.writeFileSync(file + ".tmp", JSON.stringify({ ramo, commit, esito, modo, motivo, quando: new Date().toISOString() }) + "\n");
      fs.renameSync(file + ".tmp", file);
    } catch {}
  ' "$file" "$@" 2>/dev/null || true
}

guardia_firma() {
  local ramo="$1" modo="${DA_INVENT_FIRMA_RILASCI:-avvisa}" rami="${DA_INVENT_FIRMA_RAMI:-main}"
  local firmatari="${DA_INVENT_FIRMATARI:-deploy/firmatari-rilasci}" commit r uscita motivo=""

  case "$modo" in
    spenta) return 0 ;;
    avvisa|blocca) ;;
    *) echo "firma: ERRORE: DA_INVENT_FIRMA_RILASCI=«$modo» non valido (avvisa, blocca, spenta): aggiornamento fermo"; return 1 ;;
  esac

  local controllato=0
  for r in $rami; do [ "$r" = "$ramo" ] && controllato=1; done
  [ "$controllato" = "1" ] || return 0

  commit="$(git rev-parse --short "origin/$ramo" 2>/dev/null || true)"
  if [ -z "$commit" ]; then
    motivo="origin/$ramo non si legge"
  elif ! grep -q -E '^[^#[:space:]]' "$firmatari" 2>/dev/null; then
    motivo="nessun firmatario in $firmatari"
  elif ! command -v ssh-keygen >/dev/null 2>&1; then
    motivo="manca ssh-keygen, la firma non si può controllare"
  elif uscita="$(git -c gpg.format=ssh -c "gpg.ssh.allowedSignersFile=$firmatari" verify-commit "origin/$ramo" 2>&1)"; then
    _firma_scrivi_esito "$ramo" "$commit" "buona" "$modo" ""
    echo "firma: buona su origin/$ramo ($commit)"
    return 0
  else
    # Una riga sola, senza andare a capo: finisce nel journal e nel file di stato.
    motivo="$(printf '%s' "$uscita" | tr '\n' ' ' | cut -c1-200)"
    [ -n "$motivo" ] || motivo="commit non firmato"
  fi

  if [ "$modo" = "blocca" ]; then
    _firma_scrivi_esito "$ramo" "$commit" "rifiutata" "$modo" "$motivo"
    echo "firma: ERRORE: origin/$ramo ($commit) non ha una firma valida di chi può rilasciare: aggiornamento fermo — $motivo"
    return 1
  fi
  _firma_scrivi_esito "$ramo" "$commit" "mancante" "$modo" "$motivo"
  echo "firma: AVVISO: origin/$ramo ($commit) non ha una firma valida di chi può rilasciare (modo «avvisa»: si procede) — $motivo"
  return 0
}

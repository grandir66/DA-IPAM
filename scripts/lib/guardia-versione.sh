#!/bin/bash
# DA-INVENT — l'aggiornamento non torna mai indietro.
#
# Incidente del 22/10/2026 (70151): l'installatore aveva messo il commit di `dev` (v0.9.813) chiamando «main» il ramo
# locale; il primo giro di auto-update puntava a `origin/main`, fermo a v0.3.322, e stava retrocedendo l'appliance.
# `guardia_versione <ramo>` confronta la versione di package.json dell'albero con quella di `origin/<ramo>` (il fetch
# l'ha già fatto chi chiama) e risponde 1 se il ramo bersaglio è più vecchio o se una delle due non si legge: mai un
# checkout al buio. Si usa con `source` dalla cartella dell'app. Gira uguale su Linux e sul Mac.

# La versione di un package.json letto da stdin, o niente. Con node, che sull'appliance c'è sempre: un JSON su una riga
# o indentato si legge uguale (una sed sulle righe sbagliava il primo).
versione_di() {
  node -e 'try { const v = JSON.parse(require("fs").readFileSync(0, "utf8")).version; if (typeof v === "string") process.stdout.write(v); } catch {}'
}

# confronta_versioni A B → stampa -1, 0 o 1 (A più vecchia, uguale, più nuova). Numerico per parte: 0.10.0 > 0.9.873.
confronta_versioni() {
  local a b i x y
  IFS=. read -r -a a <<< "$1"
  IFS=. read -r -a b <<< "$2"
  for i in 0 1 2 3; do
    x="${a[$i]:-0}"; y="${b[$i]:-0}"
    x="${x%%[!0-9]*}"; y="${y%%[!0-9]*}"
    x=$((10#${x:-0})); y=$((10#${y:-0}))
    if [ "$x" -lt "$y" ]; then echo -1; return 0; fi
    if [ "$x" -gt "$y" ]; then echo 1; return 0; fi
  done
  echo 0
}

guardia_versione() {
  local ramo="$1" installata remota
  installata="$(versione_di < package.json 2>/dev/null)"
  remota="$(git show "origin/$ramo:package.json" 2>/dev/null | versione_di)"
  if [ -z "$installata" ]; then
    echo "ERRORE: versione installata illeggibile (package.json): aggiornamento fermo"
    return 1
  fi
  if [ -z "$remota" ]; then
    echo "ERRORE: versione di origin/$ramo illeggibile: aggiornamento fermo"
    return 1
  fi
  if [ "$(confronta_versioni "$remota" "$installata")" = "-1" ]; then
    echo "ERRORE: retrocessione rifiutata: installata v$installata, origin/$ramo v$remota — scegli il canale giusto da Opzioni o allinea $ramo"
    return 1
  fi
  return 0
}

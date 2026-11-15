#!/bin/bash
# DA-IPAM — rilascio su main, firmato, dal Mac di chi rilascia.
#
# Analisi del 15/11/2026 (Riccardo: «Dal Mac, firmato»): le appliance dei clienti installano `main`. Il rilascio è
# la fusione di `origin/dev` in `origin/main`, FIRMATA con la chiave dei rilasci, che non sta su nessun server: né
# sull'installazione centrale né su GitHub. Le appliance controllano quella firma (scripts/lib/guardia-firma.sh).
# Sostituisce il pulsante «Promuovi dev → main» dell'installazione centrale.
#
# Uso (dal Mac, nella cartella del repository):
#   bash scripts/rilascia-main.sh            # prova a vuoto: fa la fusione firmata in una cartella a parte, la
#                                            # controlla, mostra cosa uscirebbe, non pubblica niente
#   bash scripts/rilascia-main.sh --applica  # come sopra, poi chiede «rilascia» e pubblica su origin/main
#
# Chiave: ~/.ssh/da-ipam-rilasci (o DA_CHIAVE_RILASCI). La passphrase la chiede ssh-keygen, qui non passa.
# Non tocca l'albero di lavoro né il ramo su cui sei: lavora in un worktree temporaneo di origin/main.
set -euo pipefail

APPLICA=false
for a in "$@"; do
  case "$a" in
    --applica) APPLICA=true ;;
    *) echo "Opzione sconosciuta: $a (solo --applica)" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

CHIAVE="${DA_CHIAVE_RILASCI:-$HOME/.ssh/da-ipam-rilasci}"
if [ ! -f "$CHIAVE" ] || [ ! -f "$CHIAVE.pub" ]; then
  echo "Errore: manca la chiave dei rilasci ($CHIAVE e $CHIAVE.pub)." >&2
  echo "        Si crea una volta sola: ssh-keygen -t ed25519 -C 'rilasci DA-IPAM' -f $CHIAVE" >&2
  exit 1
fi

echo ">>> scarico origin/main e origin/dev..."
git fetch --quiet origin main dev
MAIN="$(git rev-parse origin/main)"
DEV="$(git rev-parse origin/dev)"
AVANTI="$(git rev-list --count origin/main..origin/dev)"
if [ "$AVANTI" = "0" ]; then
  echo "Niente da rilasciare: dev coincide con main ($(git rev-parse --short "$MAIN"))."
  exit 0
fi

# La chiave deve essere fra i firmatari che le appliance conosceranno DOPO questo rilascio (quelli di dev).
FIRMATARI="$(mktemp "${TMPDIR:-/tmp}/firmatari.XXXXXX")"
LAVORO="$(mktemp -d "${TMPDIR:-/tmp}/rilascio-main.XXXXXX")"
pulisci() {
  git worktree remove --force "$LAVORO" >/dev/null 2>&1 || true
  rm -rf "$LAVORO" "$FIRMATARI"
}
trap pulisci EXIT
git show "origin/dev:deploy/firmatari-rilasci" > "$FIRMATARI" 2>/dev/null || true
MIA="$(awk '{print $2}' "$CHIAVE.pub")"
if ! grep -v '^#' "$FIRMATARI" | grep -q -F "$MIA"; then
  echo "Errore: la chiave $CHIAVE.pub non è in deploy/firmatari-rilasci di origin/dev." >&2
  echo "        Le appliance non riconoscerebbero la firma: aggiungi la riga, pubblica su dev e riprova." >&2
  exit 1
fi

# Dal file VERSION, senza node: nel Terminale del Mac node può non essere nel percorso (prova a vuoto del 15/11/2026).
VERSIONE="$(git show "origin/dev:VERSION" 2>/dev/null | tr -d '[:space:]')"
[ -n "$VERSIONE" ] || { echo "Errore: versione di origin/dev illeggibile (file VERSION)." >&2; exit 1; }
echo ">>> $AVANTI commit da rilasciare, versione $VERSIONE:"
# Senza paginatore (in un terminale git apriva «less» e lo script restava fermo su «(END)»). -n e non «| head»: con pipefail la pipe chiusa da head faceva uscire lo script in silenzio (15/11/2026).
git --no-pager log -n 40 --pretty='    %h %s' "origin/main..origin/dev"
[ "$AVANTI" -le 40 ] || echo "    … e altri $((AVANTI - 40))"

git worktree add --quiet --detach "$LAVORO" origin/main
echo ">>> fusione firmata (ssh-keygen chiede la passphrase della chiave)..."
git -C "$LAVORO" -c gpg.format=ssh -c "user.signingkey=$CHIAVE.pub" \
  merge --no-ff -S -m "promote: dev → main (v$VERSIONE)" "$DEV"

# Controllo com'è fatto sull'appliance: stessa regola, stessi firmatari.
if ! git -C "$LAVORO" -c gpg.format=ssh -c "gpg.ssh.allowedSignersFile=$FIRMATARI" verify-commit HEAD >/dev/null 2>&1; then
  echo "Errore: la firma appena fatta non passa il controllo delle appliance. Niente pubblicato." >&2
  exit 1
fi
NUOVO="$(git -C "$LAVORO" rev-parse HEAD)"
# L'albero rilasciato dev'essere quello di dev, riga per riga: una fusione che cambia qualcosa non si pubblica.
if [ -n "$(git diff --stat "$DEV" "$NUOVO")" ]; then
  echo "Errore: l'albero della fusione non è uguale a quello di dev (main aveva commit che dev non ha). Niente pubblicato." >&2
  git --no-pager diff --stat "$DEV" "$NUOVO" >&2
  exit 1
fi
echo ">>> firma buona. Commit di rilascio: $(git rev-parse --short "$NUOVO") (main era $(git rev-parse --short "$MAIN"))"

if [ "$APPLICA" != true ]; then
  echo ""
  echo "Prova a vuoto: niente pubblicato. Per rilasciare davvero: bash scripts/rilascia-main.sh --applica"
  exit 0
fi

echo ""
echo "Stai per pubblicare v$VERSIONE su origin/main: le appliance dei clienti la installano entro 15 minuti."
printf "Scrivi «rilascia» per confermare: "
read -r RISPOSTA
if [ "$RISPOSTA" != "rilascia" ]; then
  echo "Annullato: niente pubblicato."
  exit 1
fi
git -C "$LAVORO" push origin "$NUOVO:refs/heads/main"
echo ">>> pubblicato: origin/main = $(git rev-parse --short "$NUOVO")"

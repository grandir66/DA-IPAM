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
#   bash scripts/rilascia-main.sh --applica  # come sopra, poi chiede «rilascia», fa compilare e firma la build per le
#                                            # appliance (firma_build), poi pubblica su origin/main
#   bash scripts/rilascia-main.sh --applica --senza-build   # senza build pronta (GitHub Actions giù)
#
# Chiave: ~/.ssh/da-ipam-rilasci (o DA_CHIAVE_RILASCI). La passphrase la chiede ssh-keygen, qui non passa.
# Non tocca l'albero di lavoro né il ramo su cui sei: lavora in un worktree temporaneo di origin/main.
set -euo pipefail

APPLICA=false
SENZA_BUILD=false
for a in "$@"; do
  case "$a" in
    --applica) APPLICA=true ;;
    --senza-build) SENZA_BUILD=true ;;
    *) echo "Opzione sconosciuta: $a (--applica, --senza-build)" >&2; exit 2 ;;
  esac
done

# IPAM precompilato (piano del 26/11/2026). Prima di muovere main: la fusione firmata va su rilascio/<versione>, che
# le appliance non seguono; .github/workflows/build-appliance.yml la compila e allega i pacchetti alla Release
# pacchetto-<commit>; qui si scaricano, se ne calcola lo sha256 e si firma il tag build-<commit> che le appliance
# controllano (scripts/lib/build-firmata.sh). Se il CI fallisce main non si muove. --senza-build salta tutto questo
# (CI giù): le appliance compilano da sole, come prima.
firma_build() {
  local commit="$1" ramo="rilascio/v$VERSIONE" id="" pacchi righe f sha
  command -v gh >/dev/null 2>&1 || { echo "Errore: manca gh (GitHub CLI). Niente pubblicato. Oppure --senza-build." >&2; exit 1; }
  echo ">>> spingo $ramo per la build (le appliance non lo seguono)..."
  git -C "$LAVORO" push --quiet --force origin "$commit:refs/heads/$ramo"
  echo ">>> aspetto che GitHub Actions compili (10-15 minuti)..."
  for _ in $(seq 1 30); do
    id="$(gh run list --workflow build-appliance.yml --commit "$commit" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
    [ -n "$id" ] && break
    sleep 10
  done
  [ -n "$id" ] || { echo "Errore: GitHub Actions non ha avviato la build di $ramo. Niente pubblicato su main." >&2; exit 1; }
  if ! gh run watch "$id" --exit-status --interval 30 >/dev/null; then
    echo "Errore: la build di GitHub Actions è fallita (gh run view $id --log-failed). Niente pubblicato su main." >&2
    exit 1
  fi
  pacchi="$(mktemp -d "${TMPDIR:-/tmp}/pacchi.XXXXXX")"
  gh release download "pacchetto-$commit" --dir "$pacchi" --pattern 'ipam-build-*.tar.gz'
  righe=""
  for f in ipam-build-next-a.tar.gz ipam-build-next-b.tar.gz; do
    [ -s "$pacchi/$f" ] || { echo "Errore: nella Release manca $f. Niente pubblicato su main." >&2; rm -rf "$pacchi"; exit 1; }
    sha="$(shasum -a 256 "$pacchi/$f" | cut -d' ' -f1)"
    righe="${righe}sha256 $sha $f"$'\n'
    echo "    $f $(du -h "$pacchi/$f" | cut -f1) $sha"
  done
  rm -rf "$pacchi"
  echo ">>> tag build-$commit firmato (ssh-keygen chiede di nuovo la passphrase)..."
  git -C "$LAVORO" -c gpg.format=ssh -c "user.signingkey=$CHIAVE.pub" \
    tag -s -f "build-$commit" -m "build appliance $commit"$'\n\n'"$righe" "$commit"
  if ! git -C "$LAVORO" -c gpg.format=ssh -c "gpg.ssh.allowedSignersFile=$FIRMATARI" verify-tag "build-$commit" >/dev/null 2>&1; then
    echo "Errore: il tag build-$commit non passa il controllo delle appliance. Niente pubblicato su main." >&2
    exit 1
  fi
  git -C "$LAVORO" push --quiet --force origin "refs/tags/build-$commit"
  echo ">>> build pronta e firmata: le appliance la scaricano invece di compilare."
}

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
  merge --no-ff --no-stat -S -m "promote: dev → main (v$VERSIONE)" "$DEV"

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
if [ "$SENZA_BUILD" = true ]; then
  echo ">>> --senza-build: nessuna build pronta, le appliance compileranno da sole."
else
  firma_build "$NUOVO"
fi
git -C "$LAVORO" push origin "$NUOVO:refs/heads/main"
echo ">>> pubblicato: origin/main = $(git rev-parse --short "$NUOVO")"
git -C "$LAVORO" push --quiet origin --delete "refs/heads/rilascio/v$VERSIONE" 2>/dev/null || true

#!/bin/bash
# DA-INVENT — la build di IPAM scaricata già pronta invece di compilarla sull'appliance.
#
# Prova del 26/11/2026 su un HP EliteDesk G2 limitato a 8 GB: compilare IPAM dentro la VM da 4 GB porta la RAM
# disponibile a 104 MB e lo swap a 1,76 GB. Il piano docs/superpowers/plans/2026-11-26-ipam-precompilato.md sposta la
# compilazione in GitHub Actions; chi rilascia (scripts/rilascia-main.sh) firma con la chiave dei rilasci un tag
# `build-<commit>` che porta lo sha256 dei pacchetti. Qui si accetta un pacchetto solo se:
#   - il ramo è fra quelli coperti (DA_INVENT_BUILD_RAMI, di serie «main»: `dev` lo seguono hub e laboratorio);
#   - l'app sta nel percorso in cui è stata compilata (DA_INVENT_BUILD_PERCORSO, di serie /opt/da-ipam: Next scrive il
#     percorso dentro la build);
#   - il tag è firmato da uno dei firmatari passati (quelli della copia installata PRIMA dell'aggiornamento) e punta
#     proprio al commit in arrivo;
#   - lo sha256 del pacchetto scaricato è quello scritto nel tag.
# Ogni «no» o «non so» risponde 1 con una riga che comincia con «build-firmata: »: chi chiama compila come prima
# (Riccardo, 26/11: «compila come oggi»). Risponde 0 solo con la cartella scompattata e il suo BUILD_ID.
#
# Uso (dalla cartella dell'app, dopo il fetch): source scripts/lib/build-firmata.sh
#   build_firmata <ramo> <commit completo> <.next-a|.next-b> <file dei firmatari>
# DA_INVENT_BUILD_FIRMATA=spenta la salta sempre. I pacchetti stanno nella Release GitHub `pacchetto-<commit>` (la fa
# .github/workflows/build-appliance.yml); DA_INVENT_BUILD_URL cambia da dove si scaricano.

build_firmata() {
  local ramo="$1" commit="$2" cartella="$3" firmatari="$4"
  local rami="${DA_INVENT_BUILD_RAMI:-main}" percorso="${DA_INVENT_BUILD_PERCORSO:-/opt/da-ipam}"
  local base="${DA_INVENT_BUILD_URL:-https://github.com/grandir66/DA-IPAM/releases/download}"
  local tag="build-$commit" r coperto=0 file atteso uscita scarico

  if [ "${DA_INVENT_BUILD_FIRMATA:-accesa}" = "spenta" ]; then
    echo "build-firmata: spenta (DA_INVENT_BUILD_FIRMATA): si compila"; return 1
  fi
  for r in $rami; do [ "$r" = "$ramo" ] && coperto=1; done
  if [ "$coperto" != 1 ]; then
    echo "build-firmata: il ramo $ramo non ha build pronte: si compila"; return 1
  fi
  case "$cartella" in
    .next-a|.next-b) ;;
    *) echo "build-firmata: cartella «$cartella» non prevista: si compila"; return 1 ;;
  esac
  if [ "$(pwd -P)" != "$percorso" ]; then
    echo "build-firmata: l'app sta in $(pwd -P), la build pronta è fatta per $percorso: si compila"; return 1
  fi
  if ! grep -q -E '^[^#[:space:]]' "$firmatari" 2>/dev/null; then
    echo "build-firmata: nessun firmatario in $firmatari: si compila"; return 1
  fi
  local manca=""
  for r in curl sha256sum tar ssh-keygen; do command -v "$r" >/dev/null 2>&1 || manca="$manca $r"; done
  if [ -n "$manca" ]; then
    echo "build-firmata: mancano$manca: si compila"; return 1
  fi

  # Il tag si prende da origin ogni volta: uno locale vecchio non deve valere.
  git tag -d "$tag" >/dev/null 2>&1 || true
  if ! git fetch --quiet --no-tags origin "+refs/tags/$tag:refs/tags/$tag" 2>/dev/null; then
    echo "build-firmata: nessun tag $tag su origin: si compila"; return 1
  fi
  if ! uscita="$(git -c gpg.format=ssh -c "gpg.ssh.allowedSignersFile=$firmatari" verify-tag "$tag" 2>&1)"; then
    echo "build-firmata: il tag $tag non ha una firma valida di chi può rilasciare: si compila — $(printf '%s' "$uscita" | tr '\n' ' ' | cut -c1-160)"
    return 1
  fi
  if [ "$(git rev-parse "$tag^{commit}" 2>/dev/null)" != "$commit" ]; then
    echo "build-firmata: il tag $tag non punta a $commit: si compila"; return 1
  fi

  file="ipam-build-${cartella#.}.tar.gz"
  atteso="$(git cat-file tag "$tag" | sed -n -E "s/^sha256 ([0-9a-f]{64}) ${file//./\\.}\$/\\1/p" | head -n1)"
  if [ -z "$atteso" ]; then
    echo "build-firmata: il tag $tag non dice lo sha256 di $file: si compila"; return 1
  fi

  scarico="$cartella.scarico"
  rm -rf "$scarico" && mkdir -p "$scarico" || { echo "build-firmata: non riesco a preparare $scarico: si compila"; return 1; }
  if ! curl -fsSL --retry 2 --connect-timeout 20 --max-time "${DA_INVENT_BUILD_ATTESA:-900}" -o "$scarico/$file" "$base/pacchetto-$commit/$file"; then
    rm -rf "$scarico"; echo "build-firmata: scaricamento di $file non riuscito: si compila"; return 1
  fi
  if [ "$(sha256sum "$scarico/$file" | cut -d' ' -f1)" != "$atteso" ]; then
    rm -rf "$scarico"; echo "build-firmata: lo sha256 di $file non è quello firmato: si compila"; return 1
  fi
  if ! tar -xzf "$scarico/$file" --no-same-owner -C "$scarico" "$cartella" 2>/dev/null || [ ! -f "$scarico/$cartella/BUILD_ID" ]; then
    rm -rf "$scarico"; echo "build-firmata: $file non contiene $cartella/BUILD_ID: si compila"; return 1
  fi
  rm -rf "$cartella"
  if ! mv "$scarico/$cartella" "$cartella"; then
    rm -rf "$scarico" "$cartella"; echo "build-firmata: non riesco a spostare $cartella: si compila"; return 1
  fi
  rm -rf "$scarico"
  echo "build-firmata: usata la build pronta di ${commit:0:9} ($file, firma buona)"
  return 0
}

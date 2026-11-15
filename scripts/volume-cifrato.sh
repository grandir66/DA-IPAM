#!/bin/bash
# volume-cifrato.sh — la cartella dati dell'appliance su un contenitore LUKS2 (piano di sicurezza, P0-3, 15/11/2026).
#
# Dentro il volume: database, vault, file delle chiavi (.env.local). Fuori, in chiaro: il codice, il contenitore,
# la chiave di recupero cifrata verso Domarc e il segno `.volume-cifrato` (a volume chiuso l'app non parte).
#
#   volume-cifrato.sh stato
#   printf '%s\n' "$PASSPHRASE" | volume-cifrato.sh crea [--applica] [--sblocco tpm|chiave|frase]
#                                   [--dimensione 20G] [--chiave-esterna /percorso/sul/supporto/da-ipam.key]
#   printf '%s\n' "$PASSPHRASE" | volume-cifrato.sh apri        # sblocco a mano (livello «frase», o TPM cambiato)
#   volume-cifrato.sh pulisci [--applica]                        # toglie la copia in chiaro lasciata da `crea`
#
# Sblocco all'avvio: tpm = da solo col TPM di questa macchina; chiave = file su un supporto esterno;
# frase = nessuno, si apre a mano con `apri`. La passphrase (quella del vault, una sola) apre sempre.
# Senza --applica `crea` e `pulisci` dicono cosa farebbero e non toccano niente. La passphrase solo sullo stdin.
# Solo Linux, da root. Prima di `crea --applica` su una VM: snapshot.
set -u
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${DA_INVENT_DATA_DIR:-${APP_DIR}/data}"
SERVIZIO="${DA_IPAM_SERVIZIO:-da-ipam}"
DIR_VOLUME="${DA_VOLUME_DIR:-/var/lib/da-ipam-volume}"
CONTENITORE="${DIR_VOLUME}/dati.luks"
RECUPERO="${DIR_VOLUME}/dati.recupero-domarc.age"
NOME="da-ipam-dati"
SEGNO="${APP_DIR}/.volume-cifrato"
DROPIN="/etc/systemd/system/${SERVIZIO}.service.d/volume-cifrato.conf"

no() { echo "volume-cifrato: $*" >&2; exit 1; }
[ "$(uname -s)" = Linux ] || no "solo Linux"
[ "$(id -u)" = 0 ] || no "va lanciato da root"

COMANDO="${1:-}"; [ $# -gt 0 ] && shift
APPLICA=0; SBLOCCO=tpm; DIMENSIONE=20G; CHIAVE_ESTERNA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --applica) APPLICA=1 ;;
    --sblocco) SBLOCCO="${2:-}"; shift ;;
    --dimensione) DIMENSIONE="${2:-}"; shift ;;
    --chiave-esterna) CHIAVE_ESTERNA="${2:-}"; shift ;;
    *) no "argomento non previsto: $1 (la passphrase va solo sullo stdin)" ;;
  esac
  shift
done

montato() { mountpoint -q "${DATA_DIR}"; }
leggi_passphrase() {
  [ -t 0 ] && no "la passphrase va passata sullo stdin da un comando"
  IFS= read -r PASSPHRASE || true
  [ "${#PASSPHRASE}" -ge 14 ] || no "sullo stdin serve la passphrase (almeno 14 caratteri)"
}

if [ "${COMANDO}" = stato ]; then
  echo "Cartella dati: ${DATA_DIR}"
  if [ -f "${CONTENITORE}" ]; then
    echo "Contenitore: ${CONTENITORE} ($(du -h "${CONTENITORE}" | cut -f1) occupati di $(du -h --apparent-size "${CONTENITORE}" | cut -f1))"
    echo "Serrature: $(cryptsetup luksDump "${CONTENITORE}" 2>/dev/null | grep -cE '^ +[0-9]+: luks2') chiavi, TPM: $(cryptsetup luksDump "${CONTENITORE}" 2>/dev/null | grep -q systemd-tpm2 && echo sì || echo no)"
    echo "Recupero Domarc: $([ -f "${RECUPERO}" ] && echo sì || echo no)"
  else
    echo "Contenitore: non c'è (${CONTENITORE})"
  fi
  echo "Volume: $(montato && echo "aperto e montato" || echo "non montato")"
  echo "Segno ${SEGNO}: $([ -e "${SEGNO}" ] && echo "c'è (l'app parte solo a volume aperto)" || echo "non c'è")"
  grep -s "^${NOME} " /etc/crypttab | sed 's/^/crypttab: /'
  exit 0
fi

if [ "${COMANDO}" = apri ]; then
  [ -f "${CONTENITORE}" ] || no "il contenitore ${CONTENITORE} non c'è"
  montato && { echo "Già aperto e montato."; exit 0; }
  leggi_passphrase
  if [ ! -e "/dev/mapper/${NOME}" ]; then
    printf '%s' "${PASSPHRASE}" | cryptsetup open --key-file - "${CONTENITORE}" "${NOME}" || no "passphrase errata o contenitore rovinato"
  fi
  mount "/dev/mapper/${NOME}" "${DATA_DIR}" || no "il volume si è aperto ma non si monta su ${DATA_DIR}"
  # Se il TPM non c'è più o non è quello di prima, la serratura TPM del vault non si apre e systemd non avvia
  # nemmeno il servizio (LoadCredentialEncrypted è obbligatoria): la riga si mette da parte, il vault si sblocca
  # con la passphrase da Impostazioni › Vault. Trovato togliendo il TPM all'appliance di laboratorio (15/11/2026).
  SLOT_TPM="${DATA_DIR}/vault/slot-tpm.cred"
  if [ -f "${SLOT_TPM}" ] && ! systemd-creds decrypt --name=vault-key "${SLOT_TPM}" - >/dev/null 2>&1; then
    for f in "/etc/systemd/system/${SERVIZIO}.service.d"/*.conf; do
      [ -f "$f" ] && grep -q '^LoadCredentialEncrypted=vault-key' "$f" || continue
      mv "$f" "$f.senza-tpm" && echo "Il TPM non apre più la serratura del vault: messa da parte $f (il vault si sblocca con la passphrase dalla pagina)."
    done
    systemctl daemon-reload
  fi
  systemctl start "${SERVIZIO}" || no "volume aperto, ma il servizio ${SERVIZIO} non parte: journalctl -u ${SERVIZIO}"
  echo "Volume aperto, servizio ${SERVIZIO} avviato."
  exit 0
fi

if [ "${COMANDO}" = pulisci ]; then
  montato || no "il volume non è montato: non tolgo la copia in chiaro finché quella cifrata non è in uso"
  TROVATI=0
  for f in "${DATA_DIR}".in-chiaro-* "${APP_DIR}"/.env.local.in-chiaro-*; do
    [ -e "$f" ] || continue
    TROVATI=1
    if [ "${APPLICA}" = 1 ]; then rm -rf -- "$f" && echo "tolto: $f"; else echo "da togliere: $f ($(du -sh "$f" | cut -f1))"; fi
  done
  [ "${TROVATI}" = 1 ] || echo "Nessuna copia in chiaro."
  [ "${APPLICA}" = 1 ] || echo "A vuoto: per togliere davvero, --applica."
  echo "Nota: su SSD, ZFS e negli snapshot della VM i dati tolti non sono sovrascritti; gli snapshot vecchi li contengono ancora."
  exit 0
fi

[ "${COMANDO}" = crea ] || no "uso: volume-cifrato.sh stato | crea [--applica] [--sblocco tpm|chiave|frase] [--dimensione 20G] [--chiave-esterna <file>] | apri | pulisci [--applica]"

# ── crea: controlli (non toccano niente) ──
case "${SBLOCCO}" in tpm|chiave|frase) ;; *) no "--sblocco vuole tpm, chiave o frase" ;; esac
for c in cryptsetup mkfs.ext4 findmnt lsblk truncate openssl node; do command -v "$c" >/dev/null || no "manca il comando $c (cryptsetup: apt-get install cryptsetup-bin)"; done
[ -f "${DATA_DIR}/hub.db" ] || no "in ${DATA_DIR} non c'è hub.db: cartella dati sbagliata?"
montato && no "${DATA_DIR} è già un punto di montaggio"
[ -e "${CONTENITORE}" ] && no "il contenitore ${CONTENITORE} esiste già"
[ -e "${SEGNO}" ] && no "il segno ${SEGNO} c'è già"
ENV_VERO="$(readlink -f "${APP_DIR}/.env.local")"
[ -f "${ENV_VERO}" ] || no "non trovo ${APP_DIR}/.env.local"
DOMARC="$(grep -E '^DA_VAULT_CHIAVE_DOMARC=' "${ENV_VERO}" | tail -1 | cut -d= -f2- | tr -d "\"'[:space:]")"
[ -n "${DOMARC}" ] || no "in .env.local manca DA_VAULT_CHIAVE_DOMARC (la chiave pubblica Domarc per il recupero)"
if [ "${SBLOCCO}" = tpm ]; then
  command -v systemd-cryptenroll >/dev/null || no "manca systemd-cryptenroll"
  [ -e /dev/tpmrm0 ] || no "questa macchina non ha un TPM (/dev/tpmrm0): usa --sblocco chiave o frase"
  ldconfig -p | grep -q libtss2-esys || no "mancano le librerie del TPM: apt-get install libtss2-esys-3.0.2-0t64 libtss2-mu-4.0.1-0t64 libtss2-rc0t64"
fi
if [ "${SBLOCCO}" = chiave ]; then
  [ -n "${CHIAVE_ESTERNA}" ] || no "--sblocco chiave vuole --chiave-esterna <file sul supporto esterno>"
  [ -e "${CHIAVE_ESTERNA}" ] && no "${CHIAVE_ESTERNA} esiste già"
  [ -d "$(dirname "${CHIAVE_ESTERNA}")" ] || no "la cartella di ${CHIAVE_ESTERNA} non c'è (supporto non montato?)"
  [ "$(stat -c %d "$(dirname "${CHIAVE_ESTERNA}")")" != "$(stat -c %d /)" ] || no "${CHIAVE_ESTERNA} sta sullo stesso disco del sistema: non è un supporto esterno"
fi
DATI_KB="$(du -sk "${DATA_DIR}" | cut -f1)"
LIBERI_KB="$(df -k --output=avail "$(dirname "${DIR_VOLUME}")" | tail -1 | tr -d ' ')"
[ "${LIBERI_KB}" -gt $((DATI_KB * 2 + 1048576)) ] || no "spazio insufficiente: servono due volte i dati ($((DATI_KB / 1024)) MiB) più 1 GiB"

echo "Cartella dati: ${DATA_DIR} ($((DATI_KB / 1024)) MiB)  →  contenitore ${CONTENITORE} (${DIMENSIONE}, occupa solo quel che contiene)"
echo "Sblocco all'avvio: ${SBLOCCO}. Recupero: passphrase + chiave cifrata verso Domarc (${RECUPERO})."
echo "Passi: ferma ${SERVIZIO} → crea e formatta → copia e confronta → monta sul posto → .env.local dentro il volume → crypttab, fstab, servizio, segno → riavvia."
if [ "${APPLICA}" != 1 ]; then echo "A vuoto: niente è stato toccato (per farlo: --applica, dopo uno snapshot)."; exit 0; fi

leggi_passphrase
CHIAVE_TMP="$(mktemp /run/da-volume.XXXXXX)" || no "non riesco a scrivere in /run"
MNT_TMP="$(mktemp -d /run/da-volume-mnt.XXXXXX)"
FASE=prima
pulizia() {
  ESITO=$?
  [ -f "${CHIAVE_TMP}" ] && { shred -u "${CHIAVE_TMP}" 2>/dev/null || rm -f "${CHIAVE_TMP}"; }
  mountpoint -q "${MNT_TMP}" && umount "${MNT_TMP}"
  rmdir "${MNT_TMP}" 2>/dev/null
  if [ "${ESITO}" != 0 ] && [ "${FASE}" = prima ]; then
    # Niente di definitivo è stato toccato: si torna com'era.
    [ -e "/dev/mapper/${NOME}" ] && cryptsetup close "${NOME}"
    rm -f "${CONTENITORE}" "${RECUPERO}"
    systemctl start "${SERVIZIO}"
    echo "volume-cifrato: interrotto prima dello scambio, tutto com'era (servizio riavviato)." >&2
  elif [ "${ESITO}" != 0 ]; then
    echo "volume-cifrato: interrotto DOPO lo scambio (fase ${FASE}). La copia in chiaro è in ${DATA_DIR}.in-chiaro-*: non cancellarla." >&2
  fi
}
trap pulizia EXIT
set -e
systemctl stop "${SERVIZIO}"
mkdir -p "${DIR_VOLUME}"; chmod 700 "${DIR_VOLUME}"
truncate -s "${DIMENSIONE}" "${CONTENITORE}"; chmod 600 "${CONTENITORE}"
printf '%s' "${PASSPHRASE}" | cryptsetup luksFormat --type luks2 --batch-mode --key-file - "${CONTENITORE}"
( umask 077; printf '%s' "$(openssl rand -hex 32)" > "${CHIAVE_TMP}" )
printf '%s' "${PASSPHRASE}" | cryptsetup luksAddKey --batch-mode --key-file - "${CONTENITORE}" "${CHIAVE_TMP}"
( cd "${APP_DIR}" && DA_VAULT_CHIAVE_DOMARC="${DOMARC}" node --import tsx scripts/volume-recupero-domarc.ts "${RECUPERO}" < "${CHIAVE_TMP}" )
if [ "${SBLOCCO}" = tpm ]; then
  # Legata solo a «questo TPM», non allo stato di avvio: un aggiornamento del kernel non deve chiudere l'appliance.
  systemd-cryptenroll --unlock-key-file="${CHIAVE_TMP}" --tpm2-device=auto --tpm2-pcrs= "${CONTENITORE}"
fi
if [ "${SBLOCCO}" = chiave ]; then
  ( umask 077; printf '%s' "$(openssl rand -hex 32)" > "${CHIAVE_ESTERNA}" )
  cryptsetup luksAddKey --batch-mode --key-file "${CHIAVE_TMP}" "${CONTENITORE}" "${CHIAVE_ESTERNA}"
fi
cryptsetup open --key-file "${CHIAVE_TMP}" "${CONTENITORE}" "${NOME}"
mkfs.ext4 -q -L "${NOME}" "/dev/mapper/${NOME}"
mount "/dev/mapper/${NOME}" "${MNT_TMP}"
cp -a "${DATA_DIR}/." "${MNT_TMP}/"
diff -r "${DATA_DIR}" "${MNT_TMP}" -x lost+found >/dev/null || { echo "volume-cifrato: la copia non è uguale all'originale" >&2; exit 1; }
[ "${ENV_VERO}" = "${DATA_DIR}/.env.local" ] || cp -a "${ENV_VERO}" "${MNT_TMP}/.env.local"
chmod 600 "${MNT_TMP}/.env.local"
umount "${MNT_TMP}"

FASE=scambio
ORA="$(date +%Y%m%d-%H%M%S)"
mv "${DATA_DIR}" "${DATA_DIR}.in-chiaro-${ORA}"
mkdir -m 700 "${DATA_DIR}"
mount "/dev/mapper/${NOME}" "${DATA_DIR}"
if [ "${ENV_VERO}" != "${DATA_DIR}/.env.local" ]; then
  mv "${APP_DIR}/.env.local" "${APP_DIR}/.env.local.in-chiaro-${ORA}"
  ln -s "${DATA_DIR}/.env.local" "${APP_DIR}/.env.local"
fi

FASE=configurazione
case "${SBLOCCO}" in
  tpm)    RIGA="${NOME} ${CONTENITORE} none luks,nofail,tpm2-device=auto"; OPZ="defaults,noatime,nofail" ;;
  chiave) RIGA="${NOME} ${CONTENITORE} ${CHIAVE_ESTERNA} luks,nofail"; OPZ="defaults,noatime,nofail" ;;
  frase)  RIGA="${NOME} ${CONTENITORE} none luks,noauto"; OPZ="defaults,noatime,noauto" ;;
esac
touch /etc/crypttab
grep -q "^${NOME} " /etc/crypttab || echo "${RIGA}" >> /etc/crypttab
grep -q "^/dev/mapper/${NOME} " /etc/fstab || echo "/dev/mapper/${NOME} ${DATA_DIR} ext4 ${OPZ} 0 2" >> /etc/fstab
mkdir -p "$(dirname "${DROPIN}")"
printf '[Unit]\nRequiresMountsFor=%s\nAssertPathIsMountPoint=%s\n' "${DATA_DIR}" "${DATA_DIR}" > "${DROPIN}"
# Anche l'aggiornamento automatico scrive nella cartella dati: a volume chiuso non deve girare.
if systemctl cat "${SERVIZIO}-update.service" >/dev/null 2>&1; then
  mkdir -p "/etc/systemd/system/${SERVIZIO}-update.service.d"
  cp "${DROPIN}" "/etc/systemd/system/${SERVIZIO}-update.service.d/volume-cifrato.conf"
fi
date -u +%Y-%m-%dT%H:%M:%SZ > "${SEGNO}"
systemctl daemon-reload
FASE=avvio
systemctl start "${SERVIZIO}"
FASE=fatto
echo "Fatto. Volume montato su ${DATA_DIR}, servizio ${SERVIZIO} avviato."
echo "La copia in chiaro resta in ${DATA_DIR}.in-chiaro-${ORA}: dopo aver verificato (anche un riavvio), \`volume-cifrato.sh pulisci --applica\`."

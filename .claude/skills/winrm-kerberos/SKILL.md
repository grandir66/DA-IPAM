---
name: winrm-kerberos
description: Debug autenticazione WinRM/Kerberos verso Active Directory dal bridge Python
---

# WinRM / Kerberos verso Active Directory

Bridge: [src/lib/devices/winrm-bridge.py](../../../src/lib/devices/winrm-bridge.py).
Catena auth: **Kerberos → NTLM → CredSSP → Basic**. NTLM funziona quasi sempre via SPNEGO; Kerberos richiede ticket + SPN registrato.

## Tre regole inviolabili (errori storici, v0.2.413)

1. **Realm SEMPRE in UPPERCASE** nel principal Kerberos. AD rifiuta `user@dominio.it` con `KDC reply did not match expectations`. Normalizzare `user@realm` → `user_part + "@" + realm.upper()` prima di `kinit` e `winrm.Session(transport="kerberos")`.
2. **MAI scrivere `kdc = <host_target>` in `/etc/krb5.conf`.** Lo scanner si connette per IP a host diversi: quell'IP come KDC corrompe Kerberos per le scansioni successive. Il bridge genera krb5.conf SOLO con `[libdefaults]` + `dns_lookup_kdc = true` + `[domain_realm]`, senza `[realms]`. File marcato col commento `# DA-INVENT-KRB5-DNS-SRV`. La rete cliente DEVE avere SRV `_kerberos._tcp.<realm>`.
3. **Kerberos richiede FQDN, non IP.** AD registra SPN come `HTTP/da-rdh.domarc.it`. Il bridge fa reverse-DNS automatico quando transport=Kerberos e host è un IP; se fallisce → skip Kerberos e fallback a NTLM.

## Diagnosi rapida

```bash
# 1. Target risponde su 5985 con Negotiate?
curl -sk -o /dev/null -D - http://<ip>:5985/wsman -X POST  # atteso: 401 + WWW-Authenticate: Negotiate, Kerberos

# 2. DNS SRV per Kerberos esiste?
host -t SRV _kerberos._tcp.<realm>

# 3. krb5.conf del container è quello giusto?
ssh root@192.168.40.4 "pct exec 333 -- head -1 /etc/krb5.conf"   # atteso: '# DA-INVENT-KRB5-DNS-SRV'

# 4. kinit manuale (realm UPPERCASE)
ssh root@192.168.40.4 "pct exec 333 -- bash -lc 'echo \$PWD | kinit user@REALM.FQDN'"

# 5. Test bridge end-to-end con credenziali decrittate
echo '{"host":"...","port":5985,...}' | \
  /root/.da-invent-venv/bin/python3 /opt/da-invent/src/lib/devices/winrm-bridge.py
```

## Quando NON usare

- Non usare per ssh/snmp: hanno path diversi (`device-connection-test.ts`).
- Non modificare krb5.conf a mano se è già marcato `# DA-INVENT-KRB5-DNS-SRV`: lo rigenera il bridge.

## Anti-regressione

- Se NTLM funziona ma Kerberos no per host specifico → probabile SPN `HTTP/<fqdn>` non registrato in AD, o utente senza permessi `Remote Management Users`/`Administrators`. NON ricorrere ad alterazioni della realm config.
- Dipendenze sistema obbligatorie (`scripts/install.sh` ≥ v0.2.412): `libkrb5-dev krb5-config krb5-user libffi-dev` — senza queste `pip install gssapi` fallisce con `Command 'krb5-config --libs gssapi' returned non-zero exit status 127`.
- Realm uppercase è IRROGABILE in **ogni** punto del codice che costruisce un principal Kerberos. Test di regressione: principale con realm minuscolo → grep nei sorgenti prima di commit.

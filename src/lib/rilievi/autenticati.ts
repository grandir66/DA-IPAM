/**
 * Controlli con credenziali, solo dove la credenziale è GIÀ validata per quell'host.
 *
 * Regola di Riccardo (10/11/2026): «solo se validate (per evitare brute force su apparati
 * diversi), solo con la logica che già fa il discovery della subnet». Qui non si prova nessuna
 * credenziale: si usa la riga `host_credentials` con `validated = 1`, una sessione per host,
 * un solo comando di sola lettura. Funzioni pure: comando, lettura dell'uscita, rilievi.
 */

/** Un comando solo, di sola lettura. Le sezioni si riconoscono dai segni `##`. */
export const COMANDO_SSH = [
  "echo '##SSHD'",
  "(sshd -T 2>/dev/null || cat /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null) | grep -iE '^[[:space:]]*(permitrootlogin|permitemptypasswords)[[:space:]]'",
  "echo '##UID0'",
  "awk -F: '$3==0{print $1}' /etc/passwd 2>/dev/null",
  "echo '##RIAVVIO'",
  "test -f /var/run/reboot-required && echo si",
  "echo '##AGG'",
  "apt list --upgradable 2>/dev/null | grep -c -- '-security'",
  "echo '##FINE'",
].join("; ");

export interface InfoAuthSsh {
  /** Valore di PermitRootLogin se permette la password (`yes`). */
  root_password?: boolean;
  password_vuote?: boolean;
  /** Utenti con UID 0 oltre a root. */
  uid0?: string[];
  riavvio?: boolean;
  agg_sicurezza?: number;
}

/** Legge l'uscita di `COMANDO_SSH`. `null` se non è l'uscita attesa (shell diversa, apparato di rete). */
export function leggiUscitaSsh(stdout: string): InfoAuthSsh | null {
  if (!stdout.includes("##SSHD") || !stdout.includes("##FINE")) return null;
  const sezioni = new Map<string, string[]>();
  let corrente = "";
  for (const riga of stdout.split(/\r?\n/)) {
    const t = riga.trim();
    const m = /^##([A-Z0-9]+)$/.exec(t);
    if (m) {
      corrente = m[1]!;
      sezioni.set(corrente, []);
    } else if (corrente && t) sezioni.get(corrente)!.push(t);
  }
  const info: InfoAuthSsh = {};
  for (const r of sezioni.get("SSHD") ?? []) {
    const [chiave, valore] = r.toLowerCase().split(/\s+/);
    if (chiave === "permitrootlogin" && valore === "yes") info.root_password = true;
    if (chiave === "permitemptypasswords" && valore === "yes") info.password_vuote = true;
  }
  const uid0 = (sezioni.get("UID0") ?? []).filter((u) => u !== "root" && /^[a-z_][a-z0-9_.-]{0,31}$/i.test(u)).slice(0, 8);
  if (uid0.length) info.uid0 = uid0;
  if ((sezioni.get("RIAVVIO") ?? []).includes("si")) info.riavvio = true;
  const agg = Number((sezioni.get("AGG") ?? [])[0]);
  if (Number.isInteger(agg) && agg > 0) info.agg_sicurezza = agg;
  return info;
}

/** Solo OpenSSH: RouterOS, Comware e simili non hanno una shell POSIX e non si interrogano così. */
export function eShellPosix(banner: string | null | undefined): boolean {
  return typeof banner === "string" && /OpenSSH/i.test(banner);
}

/** Un rifiuto vero della credenziale, da distinguere da timeout e rete muta. */
export function eRifiutoSsh(messaggio: string): boolean {
  return /authentication failed|auth(entication)? fail|permission denied|bad authentication/i.test(messaggio);
}

/**
 * Gli argomenti liberi del profilo nmap, prima di arrivare a nmap (secondo giro di sicurezza, 16/11/2026).
 *
 * Il profilo accetta un testo libero (`nmap_profiles.args`) e nmap gira da root: con `--script`, `-oN`, `-iL`,
 * `--datadir` chi amministra l'interfaccia scriveva file o eseguiva codice sul sistema. Qui passa solo ciò che
 * regola una scansione: tipo, porte, tempi, ritmo. Tutto il resto è rifiutato, anche un bersaglio in più.
 * Gli argomenti che DA-IPAM costruisce da solo (`ports.ts`, `profili-giro.ts`, `discovery.ts`) stanno tutti
 * dentro questo elenco: lo tiene fermo la prova `__tests__/argomenti-nmap-ammessi.test.ts`.
 *
 * I profili con gli script (`profili/comando.ts`) non passano da qui: i loro nomi vengono dal codice.
 */

const SENZA_VALORE = new Set([
  "-sT", "-sS", "-sU", "-sV", "-sn", "-Pn", "-n", "-R", "-F", "-O", "-6", "-v", "-vv",
  "--open", "--reason", "--version-light", "--version-all", "--osscan-limit", "--osscan-guess", "--defeat-rst-ratelimit",
]);

const NUMERO = /^\d{1,7}$/;
const TEMPO = /^\d{1,9}(ms|s|m|h)?$/;
const PORTE = /^(?:[TU]:)?\d{1,5}(?:-\d{1,5})?(?:,(?:[TU]:)?\d{1,5}(?:-\d{1,5})?)*$/;

const CON_VALORE: Record<string, RegExp> = {
  "-p": PORTE,
  "--exclude-ports": PORTE,
  "--top-ports": NUMERO,
  "--max-retries": NUMERO,
  "--min-rate": NUMERO,
  "--max-rate": NUMERO,
  "--version-intensity": NUMERO,
  "--min-parallelism": NUMERO,
  "--max-parallelism": NUMERO,
  "--min-hostgroup": NUMERO,
  "--max-hostgroup": NUMERO,
  "--host-timeout": TEMPO,
  "--scan-delay": TEMPO,
  "--max-scan-delay": TEMPO,
  "--min-rtt-timeout": TEMPO,
  "--max-rtt-timeout": TEMPO,
  "--initial-rtt-timeout": TEMPO,
};

/** `null` = gli argomenti si possono passare a nmap. Altrimenti il motivo, da mostrare a chi li ha scritti. */
export function motivoArgomentiRifiutati(args: string): string | null {
  const parti = args.split(/\s+/).filter(Boolean);
  for (let i = 0; i < parti.length; i++) {
    const t = parti[i];
    if (SENZA_VALORE.has(t) || /^-T[0-5]$/.test(t) || t === "-p-") continue;

    const unito = t.match(/^(--[a-z-]+)=(.*)$/);
    if (unito && CON_VALORE[unito[1]]) {
      if (!CON_VALORE[unito[1]].test(unito[2])) return `valore non ammesso per ${unito[1]}`;
      continue;
    }
    if (CON_VALORE[t]) {
      const valore = parti[i + 1];
      if (valore === undefined || !CON_VALORE[t].test(valore)) return `valore mancante o non ammesso per ${t}`;
      i++;
      continue;
    }
    // `-p80,443` scritto attaccato.
    if (/^-p\d/.test(t) && PORTE.test(t.slice(2))) continue;

    return `opzione non ammessa: ${t.slice(0, 40)}`;
  }
  return null;
}

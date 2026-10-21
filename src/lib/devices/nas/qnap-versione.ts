/**
 * Versione del firmware QNAP (QTS / QuTS hero) dalle uscite della shell.
 * Puro. Fonti, in ordine: `getsysinfo firmver`, `/etc/version`; la build da `WEBAPP.build` o `getsysinfo build`.
 * Mai l'uscita di `uname`: quella è il kernel.
 */
export interface UsciteVersioneQnap {
  firmver: string;
  etcVersion: string;
  build: string;
}

const VERSIONE = /^\d+(?:\.\d+){1,3}$/;
const BUILD = /^\d{4,}$/;

function primaRiga(testo: string): string {
  return testo.split(/\r?\n/).map((r) => r.trim()).find((r) => r.length > 0) ?? "";
}

export function parseQnapVersione(o: UsciteVersioneQnap): { firmware: string | null; build: string | null } {
  const versione = [primaRiga(o.firmver), primaRiga(o.etcVersion)].find((v) => VERSIONE.test(v)) ?? null;
  const rigaBuild = primaRiga(o.build);
  const build = BUILD.test(rigaBuild) ? rigaBuild : null;
  if (!versione) return { firmware: null, build };
  return { firmware: build ? `${versione} build ${build}` : versione, build };
}

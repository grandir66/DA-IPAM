/**
 * Quanti giri stanno girando in questo processo, senza importare i motori: legge le stesse mappe
 * su `globalThis`. Serve a `/api/health`, e da lì a `scripts/auto-update.sh`, che non riavvia il
 * servizio sopra una scansione. Incidente del 10/11/2026: quattro Discovery lanciate a mano alle
 * 19:38 sull'hub sono morte alle 19:44 col riavvio dell'aggiornamento automatico, senza una riga
 * in cronologia; a schermo sembrava che di più reti ne partisse una sola.
 *
 * Il controllo veloce ogni 15 minuti (`fast`) non conta: dura pochi secondi e ripassa da solo.
 */
export function contaGiriInCorso(): number {
  const g = globalThis as Record<string, unknown>;
  let n = 0;
  const giri = g["__daipam_scan_progress__"];
  if (giri instanceof Map) {
    for (const p of giri.values() as Iterable<{ status?: string; scan_type?: string }>) {
      if (p?.status === "running" && p.scan_type !== "fast") n += 1;
    }
  }
  for (const chiave of ["__giriServiziRete", "__giriSegmentazione"]) {
    const m = g[chiave];
    if (m instanceof Map) for (const s of m.values() as Iterable<{ inCorso?: boolean }>) if (s?.inCorso) n += 1;
  }
  return n;
}

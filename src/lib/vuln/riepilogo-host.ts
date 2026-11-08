/**
 * Regole pure del riepilogo CVE per host della Discovery (colonne «CVE» e «CVE C/H/M»).
 *
 * Kernel superati (08/11/2026): Ubuntu lascia installato il kernel precedente accanto a quello nuovo, e Wazuh riporta le
 * CVE di tutti e due. Quello vecchio non è lo stato attuale dell'host: sull'hub 533 valeva 6.353 CVE per host in più
 * (da 58.278 a 51.925). Per ogni agente resta solo il `linux-image-*` con la versione più alta.
 */

export interface PacchettoKernel {
  agent_id: string;
  package_name: string;
  package_version: string | null;
}

/** Confronta due versioni a pezzi numerici («6.8.0-147.147» < «6.8.0-148.1»); i pezzi mancanti valgono 0. */
export function confrontaVersioni(a: string, b: string): number {
  const pa = a.split(/\D+/).filter(Boolean).map(Number);
  const pb = b.split(/\D+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Le coppie «agente|pacchetto» dei kernel superati: ogni `linux-image-*` di un agente che ne ha uno più recente.
 * Senza versione si legge quella nel nome del pacchetto.
 */
export function kernelSuperati(righe: PacchettoKernel[]): Set<string> {
  const perAgente = new Map<string, Array<{ nome: string; versione: string }>>();
  for (const r of righe) {
    if (!r.package_name.startsWith("linux-image-")) continue;
    const versione = r.package_version || r.package_name.slice("linux-image-".length);
    const lista = perAgente.get(r.agent_id) ?? [];
    lista.push({ nome: r.package_name, versione });
    perAgente.set(r.agent_id, lista);
  }
  const superati = new Set<string>();
  for (const [agente, lista] of perAgente) {
    if (lista.length < 2) continue;
    const ultimo = lista.reduce((m, k) => (confrontaVersioni(k.versione, m.versione) > 0 ? k : m));
    for (const k of lista) if (k.nome !== ultimo.nome) superati.add(`${agente}|${k.nome}`);
  }
  return superati;
}

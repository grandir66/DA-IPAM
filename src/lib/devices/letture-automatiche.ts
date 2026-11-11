/**
 * Chi legge gli apparati creati da soli (Riccardo, 11/11/2026: «Sì, tutti», 192.168.4.42 compresa).
 *
 * Misura sull'hub 533 il giorno dopo la prima creazione: 1 apparato letto su 19, 21 legami mai provati. Non era un
 * difetto della creazione: DA-IPAM legge un apparato solo a mano dalla scheda o se una persona lo mette in un job
 * «Lettura apparati» (`apparati_scelti`, elenco chiuso). Un apparato nato da solo non lo metteva nessuno.
 *
 * Qui: ogni apparato creato da `apparato-automatico.ts` entra in un job «Lettura apparati» suo, una volta al giorno,
 * con le sole informazioni (niente porte/MAC né VLAN: quelle le sceglie una persona). È un job come gli altri: si vede
 * nella pagina dei job, si sospende e si modifica da lì. Pieno a `MAX_APPARATI`, se ne apre un altro col numero.
 * Solo DB: chi gira nel server ricarica poi lo scheduler e lancia il primo giro (`cron/jobs.ts`).
 */
import type Database from "better-sqlite3";
import { MAX_APPARATI, leggiConfig, prossimaEsecuzione, type ConfigApparatiScelti } from "@/lib/apparati-scelti/regole";

export const NOME_JOB_LETTURE = "Apparati creati da soli";
export const ORA_JOB_LETTURE = "06:30";

const nomeNumero = (n: number): string => (n === 1 ? NOME_JOB_LETTURE : `${NOME_JOB_LETTURE} (${n})`);

/**
 * Mette gli apparati nel job delle letture automatiche (creandolo se manca). Un apparato già in un job «Lettura
 * apparati» qualunque non si aggiunge: qualcuno lo legge già. Restituisce gli id dei job toccati.
 */
export function aggiungiAlleLettureAutomatiche(db: Database.Database, deviceIds: readonly number[], adesso: Date = new Date()): number[] {
  if (deviceIds.length === 0) return [];
  const righe = db.prepare("SELECT id, config FROM scheduled_jobs WHERE job_type = 'apparati_scelti' ORDER BY id").all() as Array<{ id: number; config: string | null }>;
  const job = righe.map((r) => ({ id: r.id, config: leggiConfig(r.config) })).filter((j): j is { id: number; config: ConfigApparatiScelti } => j.config !== null);
  const giaLetti = new Set(job.flatMap((j) => j.config.device_ids));
  const nuovi = [...new Set(deviceIds)].filter((id) => !giaLetti.has(id));
  if (nuovi.length === 0) return [];

  const miei = job.filter((j) => j.config.nome === NOME_JOB_LETTURE || j.config.nome.startsWith(`${NOME_JOB_LETTURE} (`));
  const toccati = new Set<number>();
  const aggiorna = db.prepare("UPDATE scheduled_jobs SET config = ?, updated_at = datetime('now') WHERE id = ?");
  const crea = db.prepare(
    "INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config, next_run) VALUES (NULL, 'apparati_scelti', 1440, 1, ?, ?)",
  );
  const prossima = prossimaEsecuzione({ tipo: "giorno", ora: ORA_JOB_LETTURE }, adesso).toISOString().slice(0, 19).replace("T", " ");

  db.transaction(() => {
    let resto = nuovi;
    for (const j of miei) {
      const posto = MAX_APPARATI - j.config.device_ids.length;
      if (resto.length === 0 || posto <= 0) continue;
      const dentro = resto.slice(0, posto);
      resto = resto.slice(posto);
      j.config.device_ids = [...j.config.device_ids, ...dentro];
      aggiorna.run(JSON.stringify(j.config), j.id);
      toccati.add(j.id);
    }
    let numero = miei.length;
    while (resto.length > 0) {
      numero += 1;
      const config: ConfigApparatiScelti = {
        nome: nomeNumero(numero), device_ids: resto.slice(0, MAX_APPARATI),
        cosa: { info: true, porte_mac: false, vlan: false }, ora: ORA_JOB_LETTURE,
      };
      resto = resto.slice(MAX_APPARATI);
      toccati.add(Number(crea.run(JSON.stringify(config), prossima).lastInsertRowid));
    }
  })();
  return [...toccati];
}

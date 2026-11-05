/**
 * Persistenza di un giro di profilo: rilievi, campi dell'host, evidenze.
 *
 * Separata dal motore (`motore.ts`) di proposito: il motore resta provabile
 * senza database, e qui sta tutto cio' che scrive.
 *
 * **Regola di scrittura: si riempie, non si sovrascrive.** `model`,
 * `serial_number`, `firmware`, `os_info`, `hostname` si scrivono solo quando
 * sono vuoti. Il 04/11/2026 il problema delle stampanti era l'opposto — seriali
 * finti scritti sopra quelli buoni — e un profilo che sovrascrive a occhi chiusi
 * rifarebbe lo stesso danno. Il rilievo grezzo si salva **sempre** in
 * `host_profilo_rilievi`, quindi nulla va perduto e un confronto resta possibile.
 */
import { getDb } from "@/lib/db";
import { recordEvidence } from "@/lib/attribution/evidence";
import { recomputeAttributionSafe } from "@/lib/attribution/recompute";
import { evidenzeDaScript, evidenzaDaPortaOt } from "@/lib/attribution/profilo-evidence";
import type { EvidenceInput } from "@/lib/attribution/types";
import { propagaAllApparato, segnaDaRivedere } from "./propaga-apparato";
import type { EsitoHost, EsitoProfilo } from "./motore";

export interface EsitoSalvataggio {
  hostToccati: number;
  rilieviScritti: number;
  evidenzeScritte: number;
  campiRiempiti: number;
  /** Apparati dell'host toccati dalla propagazione e colonne scritte su di loro. */
  apparatiToccati: number;
  campiApparato: number;
  /** IP che non corrispondono a nessun host della rete: si contano, non si inventano. */
  ipSenzaHost: string[];
}

/** I campi dell'host che un profilo puo' riempire, con il valore trovato. */
function campiDaRiempire(esito: EsitoHost): Array<[colonna: string, valore: string]> {
  const f = esito.fatti;
  const out: Array<[string, string]> = [];
  if (f.hostname) out.push(["hostname", f.hostname]);
  if (f.osInfo) out.push(["os_info", f.osInfo]);
  if (f.modello) out.push(["model", f.modello]);
  if (f.seriale) out.push(["serial_number", f.seriale]);
  if (f.firmware) out.push(["firmware", f.firmware]);
  if (f.produttore) out.push(["device_manufacturer", f.produttore]);
  return out;
}

/**
 * @param hostPerIp IP -> id dell'host, costruita dal chiamante dagli host_ids
 *   GIA' verificati come appartenenti alla rete. Non si risolve l'IP qui:
 *   `getHostByIp` fa `WHERE ip = ? LIMIT 1` senza guardare la rete, e due reti
 *   dello stesso cliente possono avere lo stesso indirizzo — si scriverebbe
 *   sull'host sbagliato.
 */
export function salvaEsitoProfilo(esito: EsitoProfilo, hostPerIp: ReadonlyMap<string, number>): EsitoSalvataggio {
  const db = getDb();
  const out: EsitoSalvataggio = {
    hostToccati: 0,
    rilieviScritti: 0,
    evidenzeScritte: 0,
    campiRiempiti: 0,
    apparatiToccati: 0,
    campiApparato: 0,
    ipSenzaHost: [],
  };

  const scriviRilievo = db.prepare(
    `INSERT INTO host_profilo_rilievi (host_id, profilo, porta, protocollo, script, elems_json, output, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(host_id, profilo, porta, protocollo, script)
     DO UPDATE SET elems_json = excluded.elems_json, output = excluded.output, at = datetime('now')`
  );

  for (const h of esito.host) {
    const hostId = hostPerIp.get(h.ip);
    if (hostId === undefined) {
      out.ipSenzaHost.push(h.ip);
      continue;
    }
    out.hostToccati++;

    /* I nomi delle colonne riempite su questo host: vanno nel segno «da rivedere»,
     * che e' come Riccardo guarda il lavoro del profilo dalla tabella di Discovery. */
    const riempiteSuHost: string[] = [];

    const scrivi = db.transaction(() => {
      for (const r of h.rilievi) {
        scriviRilievo.run(
          hostId,
          r.profilo,
          r.porta,
          r.protocollo,
          r.script,
          JSON.stringify(r.elems),
          r.output
        );
        out.rilieviScritti++;
      }

      /* Solo le colonne vuote. `TRIM` perche' in archivio ci sono stringhe di
       * spazi, che non sono NULL ma non sono un dato. */
      for (const [colonna, valore] of campiDaRiempire(h)) {
        const res = db
          .prepare(
            `UPDATE hosts SET ${colonna} = ?, updated_at = datetime('now')
             WHERE id = ? AND (${colonna} IS NULL OR TRIM(${colonna}) = '')`
          )
          .run(valore, hostId);
        if (res.changes > 0) {
          out.campiRiempiti++;
          riempiteSuHost.push(colonna);
          /* Chi ha messo il nome va detto, altrimenti un enrich successivo non
           * sa se puo' correggerlo. */
          if (colonna === "hostname") {
            db.prepare("UPDATE hosts SET hostname_source = 'scan' WHERE id = ? AND (hostname_source IS NULL OR TRIM(hostname_source) = '')").run(hostId);
          }
        }
      }
    });
    scrivi();

    /* Segno e propagazione fuori dalla transazione dei rilievi: se l'apparato non
     * c'e' o un suo campo e' gia' pieno non deve succedere niente al resto. */
    if (riempiteSuHost.length > 0) {
      try {
        segnaDaRivedere(db, "hosts", hostId, riempiteSuHost);
      } catch (e) {
        console.error(`[profilo] segno «da rivedere» sull'host ${hostId} non scritto:`, e);
      }
    }
    try {
      const prop = propagaAllApparato(db, hostId, h.fatti);
      if (prop.scritte.length > 0) {
        out.apparatiToccati++;
        out.campiApparato += prop.scritte.length;
      }
    } catch (e) {
      console.error(`[profilo] propagazione all'apparato dell'host ${hostId} non riuscita:`, e);
    }

    // --- evidenze per l'attribuzione v2 ---
    const evidenze: EvidenceInput[] = [];
    for (const r of h.rilievi) {
      evidenze.push(...evidenzeDaScript({ id: r.script, output: r.output, elems: r.elems }));
    }
    /* Porta di campo aperta e nessuno script di campo che abbia risposto: lo si
     * dice, con confidenza sotto la soglia dichiarativa. */
    const nessunoScriptOt = !h.rilievi.some((r) =>
      ["s7-info", "enip-info", "bacnet-info", "omron-info"].includes(r.script)
    );
    if (nessunoScriptOt && h.risultato) {
      const aperteTcp = h.risultato.ports.filter((p) => p.protocol !== "udp").map((p) => p.port);
      const ev = evidenzaDaPortaOt(aperteTcp);
      if (ev) evidenze.push(ev);
    }
    if (evidenze.length > 0) {
      const esitoEv = recordEvidence(db, hostId, evidenze);
      out.evidenzeScritte += esitoEv.inserted + esitoEv.refreshed;
      /* Rifusione: senza questa la classe non cambia. Dal Fix C1 l'unico motore
       * che scrive `hosts.classification` e' l'attribuzione v2. */
      recomputeAttributionSafe(hostId, "scan");
    }
  }

  return out;
}

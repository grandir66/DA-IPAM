/**
 * Lo stato del riquadro «Acquisizione modulare (anteprima)» (GET /api/devices/[id]/acquisizione), fuori dalla rotta per
 * provarlo senza sessione (`mock.module` non gira sotto Node 22 con tsx; la guardia la prova il censimento delle rotte).
 * Va chiamato dentro il contesto del tenant. Nessun segreto: credenziali per nome, snapshot già ripuliti.
 */
import { descrittore } from "@/lib/acquisition";
import { acquisizioneModulareAccesa, elencoSnapshotAcquisizione, getNetworkDeviceById, modificheSnapshotAcquisizione } from "@/lib/db-tenant";
import { leggiPayload } from "./archivio";
import { acquisizioneInCorso } from "./esegui";
import { collectorInParole, dipendenzeDb, valutaFonte, type ValutazioneFonte } from "./fonte";
import { sezioniPerScheda } from "./scheda";

export const PER_PAGINA = 20;
const MODIFICHE_MOSTRATE = 200;

function credenzialiInChiaro(v: ValutazioneFonte): Record<string, string> {
  return v.esito === "pronta" ? Object.fromEntries(Object.entries(v.credenziali).map(([p, c]) => [p, c.nome])) : {};
}

export function statoRiquadro(deviceId: number, chiesto: number | null, pagina: number): { status: number; body: Record<string, unknown> } {
  const device = getNetworkDeviceById(deviceId);
  if (!device) return { status: 404, body: { error: "Dispositivo non trovato" } };
  const accesa = acquisizioneModulareAccesa();
  // Con l'interruttore spento la fonte si valuta lo stesso «come se fosse acceso», per dire nel riquadro che cosa
  // succederebbe (collector proposto, credenziali): è una lettura, l'acquisizione resta quella di sempre.
  const fonte = valutaFonte(device, { ...dipendenzeDb(), accesa: () => true });
  const collector = fonte.esito === "pronta" || (fonte.esito === "dubbio" && fonte.motivo === "credenziali") ? fonte.collector : null;
  const d = collector ? descrittore(collector) : null;
  const storico = elencoSnapshotAcquisizione(deviceId, PER_PAGINA, (pagina - 1) * PER_PAGINA);
  const idInVista = chiesto ?? (pagina === 1 ? storico.righe[0]?.id : elencoSnapshotAcquisizione(deviceId, 1, 0).righe[0]?.id) ?? null;
  let inVista: Record<string, unknown> | null = null;
  if (idInVista !== null) {
    const l = leggiPayload(deviceId, idInVista);
    if (!l.ok) return { status: l.status, body: { error: l.motivo } };
    let credenziali: Record<string, { nome: string }> = {};
    try { credenziali = JSON.parse(l.riga.credenziali) as Record<string, { nome: string }>; } catch (e) {
      console.error(`[acquisizione] snapshot #${l.riga.id}: colonna credenziali illeggibile (${e instanceof Error ? e.message : "errore"})`);
    }
    inVista = {
      id: l.riga.id, collector: l.riga.collector, collector_version: l.riga.collector_version, status: l.riga.status,
      finished_at: l.riga.finished_at, duration_ms: l.riga.duration_ms, requested_by_name: l.riga.requested_by_name,
      credenziali: Object.fromEntries(Object.entries(credenziali).map(([p, c]) => [p, c.nome])),
      sezioni: sezioniPerScheda(l.snapshot),
      modifiche: modificheSnapshotAcquisizione(l.riga.id, MODIFICHE_MOSTRATE),
    };
  }
  return {
    status: 200,
    body: {
      accesa,
      in_corso: acquisizioneInCorso(deviceId),
      fonte: {
        esito: fonte.esito,
        collector,
        possibili: "possibili" in fonte ? fonte.possibili : [],
        credenziali: credenzialiInChiaro(fonte),
        scelta: fonte.esito === "pronta" ? (fonte.scelta?.scelta ?? null) : fonte.esito === "classica_scelta" ? "classica" : null,
        richieste: fonte.esito === "dubbio" && fonte.motivo === "credenziali" ? fonte.richieste : [],
      },
      descrittore: d ? { id: d.id, versione: d.versione, prodotti: d.prodotti, collaudo: d.collaudo, collaudati: d.collaudati } : null,
      disponibili: collectorInParole(),
      snapshot: inVista,
      storico: {
        righe: storico.righe.map((r) => ({ id: r.id, status: r.status, finished_at: r.finished_at, duration_ms: r.duration_ms, payload_bytes: r.payload_bytes, sha256: r.sha256.slice(0, 6), collector: r.collector })),
        totale: storico.totale, pagina, per_pagina: PER_PAGINA,
      },
    },
  };
}

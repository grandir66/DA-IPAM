/**
 * Grafico "Stato host nel tempo" (dashboard). Su DTS (ottobre 2026) la curva
 * andava su e giù ogni 3 ore: picchi all'ora del controllo degli host, e in
 * mezzo quasi tutti "Sconosciuti" con Health al 3%. Gli host non cambiavano
 * stato: il grafico contava, ora per ora, solo gli host controllati IN QUELL'ORA.
 * `buildStatusSeries` porta avanti l'ultimo stato noto di ogni host (per 24 ore)
 * e calcola la salute sugli host di stato noto.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStatusSeries, type StatusObservation } from "../status-over-time";

const H = 3600_000;
const sql = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
// "adesso": 12/10/2026 16:30 UTC
const NOW = Date.UTC(2026, 9, 12, 16, 30, 0);

/** 10 host controllati tutti insieme ogni 3 ore (alle 0, 3, 6, ... UTC): 7 online, 3 offline. */
function ogniTreOre(daOre: number): StatusObservation[] {
  const obs: StatusObservation[] = [];
  const primo = Math.ceil((NOW - daOre * H) / (3 * H)) * 3 * H;
  for (let t = primo; t <= NOW; t += 3 * H) {
    for (let id = 1; id <= 10; id++) {
      obs.push({ host_id: id, status: id <= 7 ? "online" : "offline", checked_at: sql(t + 2 * 60_000) });
    }
  }
  return obs;
}

describe("buildStatusSeries", () => {
  it("con controlli ogni 3 ore la curva NON oscilla: le ore in mezzo portano avanti lo stato", () => {
    const serie = buildStatusSeries({ hours: 24, nowMs: NOW, totalHosts: 10, observations: ogniTreOre(48) });
    assert.ok(serie.length >= 24, `serie continua, ${serie.length} punti`);
    for (const p of serie) {
      assert.equal(p.online, 7, `ore ${p.time}: online`);
      assert.equal(p.offline, 3, `ore ${p.time}: offline`);
      assert.equal(p.unknown, 0, `ore ${p.time}: sconosciuti`);
      assert.equal(p.health_pct, 70);
    }
  });

  it("uno stato più vecchio di 24 ore non vale più: sconosciuto", () => {
    const obs: StatusObservation[] = [
      { host_id: 1, status: "online", checked_at: sql(NOW - 30 * H) },
      { host_id: 2, status: "online", checked_at: sql(NOW - 2 * H) },
    ];
    const ultimo = buildStatusSeries({ hours: 24, nowMs: NOW, totalHosts: 2, observations: obs }).at(-1)!;
    assert.equal(ultimo.online, 1);
    assert.equal(ultimo.unknown, 1);
  });

  it("vale l'ultimo controllo: un host che passa da online a offline", () => {
    const obs: StatusObservation[] = [
      { host_id: 1, status: "online", checked_at: sql(NOW - 5 * H) },
      { host_id: 1, status: "offline", checked_at: sql(NOW - 1 * H) },
    ];
    const serie = buildStatusSeries({ hours: 6, nowMs: NOW, totalHosts: 1, observations: obs });
    assert.equal(serie.at(-1)!.offline, 1);
    assert.equal(serie.at(-1)!.online, 0);
    assert.equal(serie.find((p) => p.time === "2026-10-12T13:00:00")!.online, 1);
  });

  it("etichette: ore UTC per 24h, giorni UTC oltre le 48 ore", () => {
    const uno: StatusObservation[] = [{ host_id: 1, status: "online", checked_at: sql(NOW - H) }];
    const ore = buildStatusSeries({ hours: 24, nowMs: NOW, totalHosts: 1, observations: uno });
    assert.equal(ore.at(-1)!.time, "2026-10-12T16:00:00");
    const giorni = buildStatusSeries({ hours: 168, nowMs: NOW, totalHosts: 1, observations: uno });
    assert.equal(giorni.at(-1)!.time, "2026-10-12T00:00:00");
    assert.ok(giorni.length >= 7 && giorni.length <= 8);
  });

  it("nessun controllo: serie vuota, così il grafico dice «Nessun dato disponibile»", () => {
    assert.deepEqual(buildStatusSeries({ hours: 24, nowMs: NOW, totalHosts: 5, observations: [] }), []);
  });

  it("periodi senza nessuno stato noto: salute vuota (buco nella linea), non 0%", () => {
    // controlli fermi da 30 ore: lo stato è scaduto, non "tutto giù"
    const obs: StatusObservation[] = [{ host_id: 1, status: "online", checked_at: sql(NOW - 30 * H) }];
    const p = buildStatusSeries({ hours: 24, nowMs: NOW, totalHosts: 5, observations: obs }).at(-1)!;
    assert.deepEqual([p.online, p.offline, p.unknown, p.health_pct], [0, 0, 5, null]);
  });
});

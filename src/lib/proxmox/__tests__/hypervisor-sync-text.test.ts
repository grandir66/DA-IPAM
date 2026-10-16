// Lo stato della lettura degli hypervisor in parole (pagina «Dati della mappa»).
import { test } from "node:test";
import assert from "node:assert/strict";
import { statoLetturaHypervisor } from "@/lib/proxmox/hypervisor-sync-text";

const base = { enabled: false, jobId: null, lastRun: null, hypervisors: 0, lastScanAt: null };

test("spenta senza hypervisor: lo dice, e non parla di letture", () => {
  assert.deepEqual(statoLetturaHypervisor(base), ["Spenta. Nessun hypervisor ha la scansione Proxmox configurata."]);
});

test("spenta con hypervisor: come si aggiornano e quando sono stati letti (ora italiana)", () => {
  assert.deepEqual(statoLetturaHypervisor({ ...base, hypervisors: 4, lastScanAt: "2026-10-13T22:51:06.323Z" }), [
    "Spenta: VM e schede dei 4 hypervisor si aggiornano solo a mano, con la scansione Proxmox dell'apparato.",
    "Ultima lettura degli hypervisor: 14/10/2026, 00:51.",
  ]);
});

test("accesa: ogni giorno alle 3; mai letti", () => {
  assert.deepEqual(statoLetturaHypervisor({ ...base, enabled: true, jobId: 5, hypervisors: 1 }), [
    "Accesa: ogni giorno alle 3:00 legge 1 hypervisor (VM e schede).",
    "L'hypervisor non è mai stato letto.",
  ]);
  assert.match(statoLetturaHypervisor({ ...base, enabled: true, jobId: 5 })[0], /niente da leggere/);
});

// Revisione finale M-4: con un solo hypervisor il testo diceva «dei 1 hypervisor».
test("un solo hypervisor: singolare in ogni frase", () => {
  assert.deepEqual(statoLetturaHypervisor({ ...base, hypervisors: 1, lastScanAt: "2026-10-13T22:51:06.323Z" }), [
    "Spenta: VM e schede dell'unico hypervisor si aggiornano solo a mano, con la scansione Proxmox dell'apparato.",
    "Ultima lettura dell'hypervisor: 14/10/2026, 00:51.",
  ]);
  for (const frase of statoLetturaHypervisor({ ...base, hypervisors: 1 })) assert.doesNotMatch(frase, /dei 1|gli hypervisor/i);
});

// Revisione finale (minor del Task 4): il job dei client UniFi aveva nella
// pagina dei job la stessa etichetta di quello degli apparati: due righe
// uguali, modificabili a mano. L'etichetta si ricava da config.cosa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduledJobLabel } from "@/lib/scheduled-job-types";

const LABELS = { unifi_sync: "Sincronizzazione controller UniFi", arp_poll: "ARP Poll" };

test("il job dei client UniFi ha la sua etichetta; gli altri quella del tipo", () => {
  assert.equal(scheduledJobLabel({ job_type: "unifi_sync", config: '{"controller_id":1,"cosa":"client"}' }, LABELS), "Lettura client UniFi (7–20)");
  assert.equal(scheduledJobLabel({ job_type: "unifi_sync", config: '{"controller_id":1}' }, LABELS), "Sincronizzazione controller UniFi");
  assert.equal(scheduledJobLabel({ job_type: "unifi_sync", config: "non json" }, LABELS), "Sincronizzazione controller UniFi");
  assert.equal(scheduledJobLabel({ job_type: "arp_poll", config: "{}" }, LABELS), "ARP Poll");
  assert.equal(scheduledJobLabel({ job_type: "mdm_sync", config: "{}" }, LABELS), "mdm_sync");
});

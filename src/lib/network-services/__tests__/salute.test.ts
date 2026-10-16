/**
 * Passo 4 del piano di solidità (16/10): Network Services giudicato dal contenuto di
 * `/api/v1/status`, un verdetto per servizio (Unbound, AdGuard, PowerDNS, Kea).
 * Le voci hanno la forma che scrive il bridge (Deploy-Appliance
 * `modules/net-services-bridge/main.py`, `status_all`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  leggiServiziBridge,
  verdettoBridge,
  verdettoServizio,
  type VerdettoServizio,
} from "../salute";

const voce = (active: string, enabled: string) => ({ active, enabled, units: "x.service" });

test("verdetto di un servizio: tabella dei casi", () => {
  const casi: Array<[string, unknown, VerdettoServizio, string]> = [
    ["acceso e abilitato", voce("active", "enabled"), "ok", "attivo"],
    ["acceso ma non abilitato all'avvio", voce("active", "disabled"), "ok", "attivo"],
    ["fermo ma abilitato: doveva girare", voce("inactive", "enabled"), "fail", "fermo ma abilitato"],
    ["fermo e disabilitato: spento a mano", voce("inactive", "disabled"), "off", "spento"],
    ["voce assente", undefined, "non_so", "assente dalla risposta del bridge"],
    ["voce senza active", { enabled: "enabled" }, "non_so", "assente dalla risposta del bridge"],
    ["voce non oggetto", "active", "non_so", "assente dalla risposta del bridge"],
  ];
  for (const [nome, v, verdetto, stato] of casi) {
    const r = verdettoServizio("resolver", v);
    assert.equal(r.verdetto, verdetto, nome);
    assert.equal(r.stato, stato, nome);
    assert.equal(r.nome, "Unbound", nome);
  }
});

test("i quattro servizi col nome del programma, nell'ordine della pagina", () => {
  const r = leggiServiziBridge({
    bridge: "active",
    services: {
      resolver: voce("active", "enabled"),
      adblock: voce("inactive", "disabled"),
      dns: voce("active", "enabled"),
      dhcp: voce("inactive", "enabled"),
    },
  });
  assert.ok(r);
  assert.deepEqual(
    r.map((s) => [s.nome, s.verdetto]),
    [
      ["Unbound", "ok"],
      ["AdGuard", "off"],
      ["PowerDNS", "ok"],
      ["Kea", "fail"],
    ],
  );
});

test("risposta senza `services`: non si leggono i servizi", () => {
  for (const corpo of [null, {}, { services: null }, "testo", 42]) {
    assert.equal(leggiServiziBridge(corpo), null, JSON.stringify(corpo));
  }
});

test("verdetto del modulo dai servizi: tabella dei casi", () => {
  const tutti = (a: string, e: string) => ({
    services: { resolver: voce(a, e), adblock: voce(a, e), dns: voce(a, e), dhcp: voce(a, e) },
  });
  const casi: Array<[string, unknown, "ok" | "degraded" | "fail"]> = [
    ["tutti accesi", tutti("active", "enabled"), "ok"],
    ["tutti spenti a mano: niente di guasto", tutti("inactive", "disabled"), "ok"],
    ["tutti fermi ma abilitati", tutti("inactive", "enabled"), "fail"],
    [
      "uno fermo ma abilitato, gli altri accesi",
      { services: { ...tutti("active", "enabled").services, dhcp: voce("inactive", "enabled") } },
      "degraded",
    ],
    [
      "uno spento a mano, gli altri accesi",
      { services: { ...tutti("active", "enabled").services, adblock: voce("inactive", "disabled") } },
      "ok",
    ],
    [
      "uno assente dalla risposta",
      { services: { resolver: voce("active", "enabled"), adblock: voce("active", "enabled"), dns: voce("active", "enabled") } },
      "degraded",
    ],
    [
      "uno guasto e gli altri spenti: nessuno acceso",
      { services: { ...tutti("inactive", "disabled").services, dns: voce("inactive", "enabled") } },
      "fail",
    ],
    ["risposta senza servizi", { bridge: "active" }, "degraded"],
  ];
  for (const [nome, corpo, atteso] of casi) {
    assert.equal(verdettoBridge(leggiServiziBridge(corpo)).verdict, atteso, nome);
  }
});

test("il dettaglio elenca ogni servizio col suo stato", () => {
  const r = verdettoBridge(
    leggiServiziBridge({
      services: {
        resolver: voce("active", "enabled"),
        adblock: voce("inactive", "disabled"),
        dns: voce("inactive", "enabled"),
        dhcp: voce("active", "enabled"),
      },
    }),
  );
  assert.equal(r.detail, "Unbound attivo · AdGuard spento · PowerDNS fermo ma abilitato · Kea attivo");
});

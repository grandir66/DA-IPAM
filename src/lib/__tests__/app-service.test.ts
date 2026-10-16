/**
 * Il riavvio dall'interfaccia: sotto systemd si riavvia la PROPRIA unità (INS-1).
 *
 * Run: node --import tsx --test src/lib/__tests__/app-service.test.ts
 *
 * Nessuna prova lancia systemctl o pm2 veri: /proc/self/cgroup e l'ambiente si
 * passano a mano, il processo figlio è finto, i timer sono finti.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { type ChildProcess, type SpawnOptions } from "node:child_process";

import {
  APP_SERVICE_NAMES,
  RESTART_SAFETY_NET_MS,
  exitForSystemd,
  pickPm2Process,
  planRestart,
  pm2HasProcess,
  readPm2Ids,
  readRestartContext,
  restartWithSystemd,
  scheduleUnref,
  systemdRestartArgs,
  systemdUnitFromCgroup,
  type SystemdRestartDeps,
} from "../app-service";

// --- /proc/self/cgroup -------------------------------------------------------

test("cgroup v2: l'unità è l'ultimo tratto del percorso", () => {
  assert.equal(systemdUnitFromCgroup("0::/system.slice/da-ipam.service\n"), "da-ipam.service");
  assert.equal(systemdUnitFromCgroup("0::/system.slice/da-invent.service\n"), "da-invent.service");
});

test("cgroup v1 (e ibrido): si legge la gerarchia name=systemd, non quelle dei controller", () => {
  const v1 = [
    "12:pids:/system.slice/da-invent.service",
    "11:memory:/system.slice/da-invent.service",
    "4:cpu,cpuacct:/",
    "1:name=systemd:/system.slice/da-invent.service",
    "",
  ].join("\n");
  assert.equal(systemdUnitFromCgroup(v1), "da-invent.service");

  const ibrido = [
    "10:devices:/system.slice/da-ipam.service",
    "1:name=systemd:/system.slice/da-ipam.service",
    "0::/system.slice/da-ipam.service",
  ].join("\n");
  assert.equal(systemdUnitFromCgroup(ibrido), "da-ipam.service");

  // un controller da solo non basta: dice dove sta il processo per quel
  // controller, non quale unità lo gestisce
  assert.equal(systemdUnitFromCgroup("12:pids:/system.slice/da-invent.service\n"), null);
});

test("un nome d'unità diverso da da-invent e da-ipam si riconosce lo stesso", () => {
  /*
   * Il difetto trovato in revisione: si chiedeva `systemctl is-active` per i due
   * nomi noti, e un'unità con un altro nome risultava «nessun servizio». La
   * rotta ripiegava sul rilancio di sé con uscita 0, e il servizio restava spento.
   */
  assert.equal(
    systemdUnitFromCgroup("0::/system.slice/da-ipam-cliente-a.service\n"),
    "da-ipam-cliente-a.service",
  );
  assert.equal(systemdUnitFromCgroup("0::/apps.slice/ipam@hub.service\n"), "ipam@hub.service");
});

test("fuori da un servizio di sistema: nessuna unità", () => {
  // terminale di una sessione: uno scope, non un servizio
  assert.equal(systemdUnitFromCgroup("0::/user.slice/user-1000.slice/session-3.scope\n"), null);
  // servizio del gestore di un utente: systemctl di sistema non lo vede, e
  // user@1000.service non va MAI riavviato
  assert.equal(
    systemdUnitFromCgroup(
      "0::/user.slice/user-1000.slice/user@1000.service/app.slice/da-invent.service\n",
    ),
    null,
  );
  assert.equal(systemdUnitFromCgroup("0::/user.slice/user-1000.slice/user@1000.service\n"), null);
  // container con namespace dei cgroup, Docker su v1, file vuoto
  assert.equal(systemdUnitFromCgroup("0::/\n"), null);
  assert.equal(systemdUnitFromCgroup("1:name=systemd:/docker/0123abcd\n"), null);
  assert.equal(systemdUnitFromCgroup(""), null);
});

test("readRestartContext: legge cgroup e INVOCATION_ID; /proc assente non è un errore fatale", () => {
  const sotto = readRestartContext(() => "0::/system.slice/da-ipam.service\n", {
    INVOCATION_ID: "4f1c3c6a2b9e4d0f8a7b6c5d4e3f2a1b",
  });
  assert.equal(sotto.unit, "da-ipam.service");
  assert.equal(sotto.invocationId, "4f1c3c6a2b9e4d0f8a7b6c5d4e3f2a1b");
  assert.equal(sotto.cgroupError, null);

  const mac = readRestartContext(
    () => {
      throw Object.assign(new Error("ENOENT: no such file or directory, open '/proc/self/cgroup'"), {
        code: "ENOENT",
      });
    },
    {},
  );
  assert.equal(mac.unit, null);
  assert.equal(mac.invocationId, null);
  assert.match(mac.cgroupError ?? "", /ENOENT/);

  // INVOCATION_ID vuota vale "assente"
  assert.equal(readRestartContext(() => "0::/\n", { INVOCATION_ID: "  " }).invocationId, null);
});

// --- la decisione --------------------------------------------------------------

test("sotto systemd con l'unità nota: si riavvia QUELLA unità", () => {
  /*
   * Risolve anche «due servizi attivi, si riavvia quello sbagliato»: il primo
   * attivo fra da-invent e da-ipam poteva non essere questo processo.
   */
  assert.deepEqual(
    planRestart({ unit: "da-ipam.service", invocationId: "abc", cgroupError: null }),
    { mode: "unit", unit: "da-ipam.service" },
  );
  // l'unità dal cgroup basta anche senza INVOCATION_ID
  assert.deepEqual(
    planRestart({ unit: "da-invent.service", invocationId: null, cgroupError: null }),
    { mode: "unit", unit: "da-invent.service" },
  );
});

test("sotto systemd ma l'unità non si capisce: si esce con 1, MAI il rilancio di sé", () => {
  const piano = planRestart({ unit: null, invocationId: "abc", cgroupError: null });
  assert.equal(piano.mode, "exit-1");
  const illeggibile = planRestart({ unit: null, invocationId: "abc", cgroupError: "EACCES" });
  assert.equal(illeggibile.mode, "exit-1");
  assert.match(illeggibile.mode === "exit-1" ? illeggibile.reason : "", /EACCES/);
});

test("né unità né INVOCATION_ID: fuori da systemd (sviluppo, PM2)", () => {
  assert.deepEqual(planRestart({ unit: null, invocationId: null, cgroupError: null }), {
    mode: "not-systemd",
  });
  assert.deepEqual(planRestart({ unit: null, invocationId: null, cgroupError: "ENOENT" }), {
    mode: "not-systemd",
  });
});

test("exitForSystemd: esce con 1 e scrive il motivo nel log", (t) => {
  const errore = t.mock.method(console, "error", () => {});
  const uscite: number[] = [];
  exitForSystemd("unità non riconosciuta", (code) => uscite.push(code));
  assert.deepEqual(uscite, [1]);
  assert.match(String(errore.mock.calls[0].arguments[0]), /unità non riconosciuta/);
});

// --- PM2 (fuori da systemd) ----------------------------------------------------

test("pm2 id: «[]» o niente → assente; «[ 0 ]» → presente", () => {
  assert.equal(pm2HasProcess("[]\n"), false);
  assert.equal(pm2HasProcess(""), false);
  assert.equal(pm2HasProcess("[ 0 ]\n"), true);
});

test("PM2: il primo nome che PM2 conosce, nell'ordine da-invent, da-ipam", () => {
  assert.deepEqual([...APP_SERVICE_NAMES], ["da-invent", "da-ipam"]);
  assert.equal(pickPm2Process({ "da-invent": "[]", "da-ipam": "[ 2 ]" }), "da-ipam");
  assert.equal(pickPm2Process({ "da-invent": "[ 0 ]", "da-ipam": "[ 2 ]" }), "da-invent");
  assert.equal(pickPm2Process({ "da-invent": "", "da-ipam": "" }), null);

  const chiesti: string[] = [];
  readPm2Ids((nome) => {
    chiesti.push(nome);
    return "[]";
  });
  assert.deepEqual(chiesti, ["da-invent", "da-ipam"]);
});

// --- systemctl restart ---------------------------------------------------------

class FiglioFinto extends EventEmitter {
  readonly stderr = new EventEmitter();
}

function avvia(unit: string, schedule?: SystemdRestartDeps["schedule"]) {
  const figlio = new FiglioFinto();
  const lanci: { command: string; args: string[]; options: SpawnOptions }[] = [];
  const uscite: number[] = [];
  const pianificati: { fn: () => void; ms: number }[] = [];
  restartWithSystemd(unit, {
    spawn: (command, args, options) => {
      lanci.push({ command, args, options });
      return figlio as unknown as ChildProcess;
    },
    exit: (code) => {
      uscite.push(code);
    },
    schedule: schedule ?? ((fn, ms) => pianificati.push({ fn, ms })),
  });
  return { figlio, lanci, uscite, pianificati };
}

test("riavvio: systemctl --no-block restart sull'unità del proprio cgroup, con un tempo massimo", (t) => {
  t.mock.method(console, "info", () => {});
  const { lanci } = avvia("da-ipam.service");
  assert.equal(lanci.length, 1);
  assert.equal(lanci[0].command, "systemctl");
  assert.deepEqual(lanci[0].args, ["--no-block", "restart", "da-ipam.service"]);
  assert.equal(typeof lanci[0].options.timeout, "number");
  assert.deepEqual(systemdRestartArgs("da-invent.service"), [
    "--no-block",
    "restart",
    "da-invent.service",
  ]);
});

test("riavvio accodato: il processo NON esce da solo, lo ferma systemd", (t) => {
  /*
   * Prima si usciva con 0 subito dopo aver lanciato systemctl. Le unità
   * da-invent e da-ipam hanno Restart=on-failure, che dopo un'uscita con 0 non
   * riavvia: se systemd chiudeva systemctl (che sta nel gruppo di processi del
   * servizio) prima che la richiesta arrivasse, il servizio restava spento.
   */
  const info = t.mock.method(console, "info", () => {});
  const { figlio, uscite } = avvia("da-ipam.service");
  assert.deepEqual(uscite, [], "nessuna uscita prima dell'esito di systemctl");
  figlio.emit("close", 0, null);
  assert.deepEqual(uscite, [], "riavvio accodato: è systemd a fermare il processo");
  assert.equal(info.mock.callCount(), 1);
  assert.match(String(info.mock.calls[0].arguments[0]), /da-ipam/);
});

test("rete di sicurezza: accodato il riavvio, se dopo 90 s il processo è vivo esce con 1", (t) => {
  t.mock.method(console, "info", () => {});
  const errore = t.mock.method(console, "error", () => {});
  const { figlio, uscite, pianificati } = avvia("da-ipam.service");
  assert.equal(pianificati.length, 0, "la rete si tende solo dopo l'esito di systemctl");
  figlio.emit("close", 0, null);
  assert.equal(pianificati.length, 1);
  assert.equal(pianificati[0].ms, 90_000);
  assert.equal(RESTART_SAFETY_NET_MS, 90_000);
  assert.deepEqual(uscite, []);
  pianificati[0].fn();
  assert.deepEqual(uscite, [1], "Restart=on-failure fa ripartire il servizio");
  assert.match(String(errore.mock.calls[0].arguments[0]), /ancora vivo/);
});

test("rete di sicurezza con timer finti: niente prima dei 90 s, uscita con 1 allo scadere", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "error", () => {});
  const { figlio, uscite } = avvia("da-invent.service", scheduleUnref);
  figlio.emit("close", 0, null);
  t.mock.timers.tick(RESTART_SAFETY_NET_MS - 1);
  assert.deepEqual(uscite, []);
  t.mock.timers.tick(1);
  assert.deepEqual(uscite, [1]);
});

test("scheduleUnref: il timer non trattiene il processo (unref)", (t) => {
  const timer = { unref: t.mock.fn() };
  const originale = globalThis.setTimeout;
  const finto = t.mock.fn<(fn: () => void, ms: number) => typeof timer>(() => timer);
  globalThis.setTimeout = finto as unknown as typeof setTimeout;
  try {
    scheduleUnref(() => {}, 1234);
  } finally {
    globalThis.setTimeout = originale;
  }
  assert.equal(finto.mock.callCount(), 1);
  assert.equal(finto.mock.calls[0].arguments[1], 1234);
  assert.equal(timer.unref.mock.callCount(), 1);
});

test("systemctl rifiuta (permessi): si esce con 1, il motivo nel log, nessuna rete", (t) => {
  const errore = t.mock.method(console, "error", () => {});
  const { figlio, uscite, pianificati } = avvia("da-invent.service");
  figlio.stderr.emit(
    "data",
    Buffer.from("Failed to restart da-invent.service: Interactive authentication required.\n"),
  );
  figlio.emit("close", 1, null);
  // Restart=on-failure fa ripartire il servizio dopo un'uscita con 1
  assert.deepEqual(uscite, [1]);
  assert.equal(pianificati.length, 0);
  assert.equal(errore.mock.callCount(), 1);
  assert.match(String(errore.mock.calls[0].arguments[0]), /Interactive authentication required/);
});

test("systemctl non parte o scade: si esce con 1, una volta sola", (t) => {
  t.mock.method(console, "error", () => {});
  const { figlio, uscite } = avvia("da-ipam.service");
  figlio.emit("error", Object.assign(new Error("spawn systemctl ENOENT"), { code: "ENOENT" }));
  figlio.emit("close", null, "SIGTERM");
  assert.deepEqual(uscite, [1]);
});

test("spawn che lancia un'eccezione: si esce con 1", (t) => {
  t.mock.method(console, "error", () => {});
  const uscite: number[] = [];
  restartWithSystemd("da-ipam.service", {
    spawn: () => {
      throw new Error("spawn EAGAIN");
    },
    exit: (code) => {
      uscite.push(code);
    },
    schedule: () => {},
  });
  assert.deepEqual(uscite, [1]);
});

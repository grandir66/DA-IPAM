/**
 * Il servizio che fa girare DA-IPAM e il riavvio dall'interfaccia (INS-1).
 *
 * Run: node --import tsx --test src/lib/__tests__/app-service.test.ts
 *
 * Nessuna prova lancia systemctl o pm2 veri: gli esiti si passano a mano e il
 * processo figlio è finto. exitStatusOf si prova con node stesso, che c'è
 * ovunque giri la prova.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFileSync, type ChildProcess, type SpawnOptions } from "node:child_process";

import {
  APP_SERVICE_NAMES,
  exitStatusOf,
  pickPm2Process,
  pickServiceToRestart,
  pm2HasProcess,
  readPm2Ids,
  readServiceStates,
  restartWithSystemd,
  systemdRestartArgs,
  type AppServiceName,
} from "../app-service";

// Codici di `systemctl is-active`: 0 attivo, 3 inattivo, 4 unità inesistente.
const ATTIVO = 0;
const INATTIVO = 3;
const INESISTENTE = 4;

test("DTS: da-invent non esiste, da-ipam è attivo → si riavvia da-ipam", () => {
  /*
   * Il caso che il pulsante «Riavvia» sbagliava: cercava solo da-invent, e
   * sulle appliance installate con Deploy-Appliance il servizio si chiama
   * da-ipam. Saltato systemd, ripiegava sul rilancio da sé.
   */
  assert.equal(pickServiceToRestart({ "da-invent": INESISTENTE, "da-ipam": ATTIVO }), "da-ipam");
});

test("installazione classica: da-invent attivo → si riavvia da-invent", () => {
  assert.equal(pickServiceToRestart({ "da-invent": ATTIVO, "da-ipam": INESISTENTE }), "da-invent");
});

test("tutti e due attivi → da-invent, nello stesso ordine di scripts/update.sh", () => {
  assert.deepEqual([...APP_SERVICE_NAMES], ["da-invent", "da-ipam"]);
  assert.equal(pickServiceToRestart({ "da-invent": ATTIVO, "da-ipam": ATTIVO }), "da-invent");
});

test("nessuno attivo, o systemctl assente → nessun servizio da riavviare", () => {
  assert.equal(pickServiceToRestart({ "da-invent": INATTIVO, "da-ipam": INATTIVO }), null);
  // systemctl assente (Mac di sviluppo, container): nessun codice
  assert.equal(pickServiceToRestart({ "da-invent": null, "da-ipam": null }), null);
  // qualunque codice diverso da 0 vuol dire "non attivo"
  assert.equal(pickServiceToRestart({ "da-invent": 1, "da-ipam": INESISTENTE }), null);
});

test("readServiceStates chiede lo stato di tutti e due i nomi, in ordine", () => {
  const chiesti: string[] = [];
  const stati = readServiceStates((nome) => {
    chiesti.push(nome);
    return nome === "da-ipam" ? ATTIVO : INESISTENTE;
  });
  assert.deepEqual(chiesti, ["da-invent", "da-ipam"]);
  assert.deepEqual(stati, { "da-invent": INESISTENTE, "da-ipam": ATTIVO });
  assert.equal(pickServiceToRestart(stati), "da-ipam");
});

test("exitStatusOf: 0, il codice d'uscita, null se il comando non dà un codice", () => {
  const node = process.execPath;
  assert.equal(exitStatusOf(() => execFileSync(node, ["-e", ""], { stdio: "ignore" })), 0);
  assert.equal(
    exitStatusOf(() => execFileSync(node, ["-e", "process.exit(3)"], { stdio: "ignore" })),
    3,
  );
  // comando assente (ENOENT)
  assert.equal(
    exitStatusOf(() => execFileSync("comando-inesistente-da-ipam-prova", [], { stdio: "ignore" })),
    null,
  );
  // scaduto: ucciso da un segnale, nessun codice
  assert.equal(
    exitStatusOf(() =>
      execFileSync(node, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore", timeout: 200 }),
    ),
    null,
  );
});

test("pm2 id: «[]» o niente → assente; «[ 0 ]» → presente", () => {
  assert.equal(pm2HasProcess("[]\n"), false);
  assert.equal(pm2HasProcess(""), false);
  assert.equal(pm2HasProcess("[ 0 ]\n"), true);
});

test("PM2: stesso criterio, il primo nome che PM2 conosce", () => {
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

class FiglioFinto extends EventEmitter {
  readonly stderr = new EventEmitter();
}

function avvia(nome: AppServiceName) {
  const figlio = new FiglioFinto();
  const lanci: { command: string; args: string[]; options: SpawnOptions }[] = [];
  const uscite: number[] = [];
  restartWithSystemd(nome, {
    spawn: (command, args, options) => {
      lanci.push({ command, args, options });
      return figlio as unknown as ChildProcess;
    },
    exit: (code) => {
      uscite.push(code);
    },
  });
  return { figlio, lanci, uscite };
}

test("riavvio: systemctl --no-block restart sul servizio scelto, con un tempo massimo", (t) => {
  t.mock.method(console, "info", () => {});
  const { lanci } = avvia("da-ipam");
  assert.equal(lanci.length, 1);
  assert.equal(lanci[0].command, "systemctl");
  assert.deepEqual(lanci[0].args, ["--no-block", "restart", "da-ipam"]);
  assert.equal(typeof lanci[0].options.timeout, "number");
  assert.deepEqual(systemdRestartArgs("da-invent"), ["--no-block", "restart", "da-invent"]);
});

test("riavvio accodato: il processo NON esce da solo, lo ferma systemd", (t) => {
  /*
   * Prima si usciva con 0 subito dopo aver lanciato systemctl. Le unità
   * da-invent e da-ipam hanno Restart=on-failure, che dopo un'uscita con 0 non
   * riavvia: se systemd chiudeva systemctl (che sta nel gruppo di processi del
   * servizio) prima che la richiesta arrivasse, il servizio restava spento.
   */
  const info = t.mock.method(console, "info", () => {});
  const { figlio, uscite } = avvia("da-ipam");
  assert.deepEqual(uscite, [], "nessuna uscita prima dell'esito di systemctl");
  figlio.emit("close", 0, null);
  assert.deepEqual(uscite, [], "riavvio accodato: è systemd a fermare il processo");
  assert.equal(info.mock.callCount(), 1);
  assert.match(String(info.mock.calls[0].arguments[0]), /da-ipam/);
});

test("systemctl rifiuta (permessi): si esce con 1 e il motivo finisce nel log", (t) => {
  const errore = t.mock.method(console, "error", () => {});
  const { figlio, uscite } = avvia("da-invent");
  figlio.stderr.emit(
    "data",
    Buffer.from("Failed to restart da-invent.service: Interactive authentication required.\n"),
  );
  figlio.emit("close", 1, null);
  // Restart=on-failure fa ripartire il servizio dopo un'uscita con 1
  assert.deepEqual(uscite, [1]);
  assert.equal(errore.mock.callCount(), 1);
  assert.match(String(errore.mock.calls[0].arguments[0]), /Interactive authentication required/);
});

test("systemctl non parte o scade: si esce con 1, una volta sola", (t) => {
  t.mock.method(console, "error", () => {});
  const { figlio, uscite } = avvia("da-ipam");
  figlio.emit("error", Object.assign(new Error("spawn systemctl ENOENT"), { code: "ENOENT" }));
  figlio.emit("close", null, "SIGTERM");
  assert.deepEqual(uscite, [1]);
});

test("spawn che lancia un'eccezione: si esce con 1", (t) => {
  t.mock.method(console, "error", () => {});
  const uscite: number[] = [];
  restartWithSystemd("da-ipam", {
    spawn: () => {
      throw new Error("spawn EAGAIN");
    },
    exit: (code) => {
      uscite.push(code);
    },
  });
  assert.deepEqual(uscite, [1]);
});

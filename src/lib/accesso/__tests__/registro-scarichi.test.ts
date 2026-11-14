import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { HUB_SCHEMA_SQL } from "@/lib/db-hub-schema";
import { registraScarico, ultimoScarico } from "../registro-scarichi";

test("il registro tiene l'ultimo scarico per tipo, con chi l'ha fatto", () => {
  const db = new Database(":memory:");
  db.exec(HUB_SCHEMA_SQL);
  assert.equal(ultimoScarico(db, "hub_db"), null);
  registraScarico(db, { cosa: "hub_db", utenteId: "1", utenteNome: "anna", ruolo: "admin" });
  registraScarico(db, { cosa: "pacchetto", utenteNome: "bruno", dettaglio: "X, vault escluso" });
  registraScarico(db, { cosa: "hub_db", utenteId: "2", utenteNome: "carla", ruolo: "superadmin" });
  const u = ultimoScarico(db, "hub_db");
  assert.equal(u?.utente, "carla");
  assert.ok(!Number.isNaN(new Date(u!.quando).getTime()));
  assert.equal(ultimoScarico(db, "pacchetto")?.utente, "bruno");
});

test("un registro che non si scrive non lancia", () => {
  const db = new Database(":memory:");
  assert.doesNotThrow(() => registraScarico(db, { cosa: "hub_db" }));
});

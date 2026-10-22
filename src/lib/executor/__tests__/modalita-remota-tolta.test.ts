/**
 * Agente Python remoto tolto (20/10/2026, decisione 26 della spec NetBird: nessuno lo
 * usava, una sola riga sull'hub mai collegata). Restano nel DB `tenants.agent_mode` e la
 * tabella `tenant_agents`, senza uso: niente DROP.
 *
 * Un cliente con `agent_mode='remote'` rimasto nel DB non fa cadere l'app e non ripiega
 * in silenzio sull'esecuzione locale (scansionare dall'hub reti che l'hub non vede manda
 * offline gli host del cliente): il giro si ferma con un errore che dice cosa fare.
 * Il cliente sconosciuto resta come prima (esecuzione locale, avviso nel log).
 *
 * Hub DB isolato: `support/hub-isolato` va importato PER PRIMO (il perché sta lì).
 */
import { removeTestHubDb } from "../../integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, getHubDb } from "@/lib/db-hub";
import { encrypt } from "@/lib/crypto";
import { ExecutorNotConfiguredError, esecutorePerGiro, getExecutor } from "@/lib/executor";

after(() => {
  closeHubDb();
  removeTestHubDb();
});

function cliente(codice: string, modo: "local" | "remote"): number {
  const db = getHubDb();
  const id = Number(
    db.prepare("INSERT INTO tenants (codice_cliente, ragione_sociale, active, agent_mode) VALUES (?, ?, 1, ?)").run(codice, `Cliente ${codice}`, modo)
      .lastInsertRowid,
  );
  return id;
}

test("cliente rimasto in modalità remota, con la sua riga d'agente e il token: errore che lo dice, niente esecutore remoto", () => {
  const id = cliente("RMT1", "remote");
  getHubDb()
    .prepare("INSERT INTO tenant_agents (tenant_id, label, hostname, port, token_hash, token_encrypted) VALUES (?, 'Sede', 'nodo-vecchio', 8443, 'h', ?)")
    .run(id, encrypt("token-finto"));
  assert.throws(
    () => getExecutor("RMT1"),
    (e: unknown) => e instanceof ExecutorNotConfiguredError && /agente remoto/i.test(e.message) && /locale/i.test(e.message),
  );
});

test("il giro di un cliente in modalità remota si ferma con l'errore, non ripiega sull'hub", () => {
  cliente("RMT2", "remote");
  assert.throws(() => esecutorePerGiro("RMT2"), ExecutorNotConfiguredError);
});

test("cliente in modalità locale: esecutore locale; cliente sconosciuto o assente: esecuzione locale come prima", () => {
  cliente("LOC1", "local");
  assert.equal(esecutorePerGiro("LOC1")?.mode, "local");
  assert.equal(esecutorePerGiro("NON-ESISTE"), null);
  assert.equal(esecutorePerGiro(null), null);
});

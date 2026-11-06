/**
 * Le credenziali registrate arrivano allo scanner (Riccardo, 05-06/11/2026: «le credenziali
 * registrate potranno essere usate per la scansione», «anche ssh se presente»).
 *
 * Sul 72729 l'account AD non partiva: il tipo `ad` non vale per nessun protocollo e non può stare
 * nella lista della rete (D7: mai nelle prove in sequenza). Si prende dall'integrazione, solo per
 * lo scanner. La catena della discovery non deve vederlo.
 *
 * Run: node --import tsx --test src/lib/vuln/__tests__/edge-credenziali-scanner.test.ts
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
import "@/lib/__tests__/support/data-dir-isolata";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { getOrderedDetectCredentialIds } from "@/lib/db";
import { collectEdgeCredentialsForNetwork } from "../edge-credentials-bridge";

const T = "TESTEDGEAD";
const AD = 701;
const SPENTA = 702;
const CHIAVE = 703;
const WIN = 704;
const RETE = 1;
const RETE_WIN = 2;

before(() => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    d.prepare(`INSERT INTO networks (id, cidr, name) VALUES (?, '10.82.0.0/24', 'solo ad')`).run(RETE);
    d.prepare(`INSERT INTO networks (id, cidr, name) VALUES (?, '10.82.1.0/24', 'con windows')`).run(RETE_WIN);
    const voce = d.prepare(
      `INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?, ?)`,
    );
    voce.run(AD, "ad", "ad", encrypt("mario"), encrypt("pw-ad"));
    voce.run(SPENTA, "ad spento", "ad", encrypt("luigi"), encrypt("pw-spento"));
    voce.run(WIN, "win", "windows", encrypt("locale"), encrypt("pw-win"));
    d.prepare(
      `INSERT INTO credentials (id, name, credential_type, auth_method, encrypted_username, encrypted_private_key, encrypted_key_passphrase)
       VALUES (?, 'chiave', 'ssh', 'chiave', ?, ?, ?)`,
    ).run(CHIAVE, encrypt("root"), encrypt("TESTO-CHIAVE"), encrypt("frase"));
    const integ = d.prepare(
      `INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, enabled, credential_id)
       VALUES (?, '10.82.0.10', ?, 'DC=x', '', '', ?, ?)`,
    );
    integ.run("acceso", "sanfrancesco.local", 1, AD);
    integ.run("spento", "altro.local", 0, SPENTA);
    d.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, 0)`).run(RETE, CHIAVE);
    d.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, 0)`).run(RETE_WIN, WIN);
  });
});

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

describe("credenziali verso lo scanner", () => {
  it("l'account AD dell'integrazione va negli slot smb e ad, col dominio", () => {
    const { transfer } = withTenant(T, () => collectEdgeCredentialsForNetwork(RETE, { registra: false }));
    const smb = transfer.find((t) => t.slot === "smb");
    assert.equal(smb?.ipam_credential_id, AD);
    assert.equal(smb?.login, "mario");
    assert.equal(smb?.password, "pw-ad");
    assert.equal(smb?.domain, "sanfrancesco.local");
    assert.equal(transfer.find((t) => t.slot === "ad")?.login, "mario");
  });

  it("un'integrazione spenta non manda niente", () => {
    const { transfer } = withTenant(T, () => collectEdgeCredentialsForNetwork(RETE, { registra: false }));
    assert.ok(!transfer.some((t) => t.ipam_credential_id === SPENTA));
  });

  it("una voce Windows della rete viene prima dell'account AD", () => {
    const { transfer } = withTenant(T, () => collectEdgeCredentialsForNetwork(RETE_WIN, { registra: false }));
    assert.equal(transfer.find((t) => t.slot === "smb")?.ipam_credential_id, WIN);
  });

  it("l'account AD resta fuori dalle prove in sequenza (D7)", () => {
    const catena = withTenant(T, () => getOrderedDetectCredentialIds(RETE, "windows", { registra: false }));
    assert.ok(!catena.includes(AD));
  });

  it("la voce SSH a chiave parte con chiave e frase", () => {
    const { preview, transfer } = withTenant(T, () => collectEdgeCredentialsForNetwork(RETE, { registra: false }));
    const ssh = transfer.find((t) => t.slot === "ssh");
    assert.equal(ssh?.cred_type, "usk");
    assert.equal(ssh?.login, "root");
    assert.equal(ssh?.private_key, "TESTO-CHIAVE");
    assert.equal(ssh?.passphrase, "frase");
    assert.equal(preview.find((p) => p.credential_id === CHIAVE)?.selected_for_scan, true);
  });
});

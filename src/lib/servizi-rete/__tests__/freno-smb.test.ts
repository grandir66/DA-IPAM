process.env.ENCRYPTION_KEY ||= "test-encryption-key-freno-smb";

/**
 * Freno sulla prova SMB anonima e «Guest» (10/11/2026): una volta ogni SMB_ANONIMO_OGNI_GIORNI per
 * host. Sull'hub il giro ripartiva dopo ogni Discovery e in un giorno ha lasciato 196 accessi
 * «Guest» rifiutati sui due DC, che la sera hanno smesso di rispondere all'hub.
 * Run: node --import tsx --test src/lib/servizi-rete/__tests__/freno-smb.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { SMB_ANONIMO_OGNI_GIORNI, smbProvatoDiRecente } from "../giro";

const T = "PROVAFRENOSMB";
after(() => {
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
});

test("la prova SMB si rifà solo dopo i giorni stabiliti", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const n = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.8.0.0/24', 'lan')").run().lastInsertRowid);
    const h = Number(d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, '10.8.0.1', 'online')").run(n).lastInsertRowid);
    const ins = d.prepare("INSERT INTO servizi_rete (host_id, porta, protocollo, metodo, controllo_json) VALUES (?, ?, 'tcp', 'ntlm', ?)");
    const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();
    ins.run(h, 445, JSON.stringify({ smb_signing: false, _smb_provato_il: giorniFa(1) }));
    ins.run(h, 139, JSON.stringify({ _smb_provato_il: giorniFa(SMB_ANONIMO_OGNI_GIORNI + 1) }));
    ins.run(h, 3389, null);
    assert.equal(smbProvatoDiRecente(T, h, 445), true, "provato ieri: non si rifà");
    assert.equal(smbProvatoDiRecente(T, h, 139), false, "provato più di una settimana fa: si rifà");
    assert.equal(smbProvatoDiRecente(T, h, 3389), false, "mai provato");
    assert.equal(smbProvatoDiRecente(T, 9999, 445), false, "host che non c'è");
  });
});

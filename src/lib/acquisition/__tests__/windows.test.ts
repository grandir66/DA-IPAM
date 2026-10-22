/**
 * Collector `windows` (non collaudato): script a id fisso nell'allowlist WinRM, mai `Win32_Product`, busta JSON letta per
 * nome nelle tre forme di PowerShell 5.1, Hyper-V col GUID, Defender e firewall senza riassunti.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./contratto-fixture";
import { descrittore } from "../catalogo";
import { SCRIPT_WINDOWS } from "../windows-script";
import { leggiBusta, lista, parseHyperv, parseReteWindows } from "../windows-parsers";
import { createWinrmReader } from "../transports";
import { acquisitionInputSchema } from "../schema";

test("windows: non collaudato; gli script sono quelli del descrittore, solo letture, mai Win32_Product", () => {
    const d = descrittore("windows");
    assert.equal(d.collaudo, "non_collaudato");
    assert.equal(d.comandi, null);
    assert.deepEqual(d.script_winrm, SCRIPT_WINDOWS);
    for (const [id, script] of Object.entries(SCRIPT_WINDOWS)) {
        assert.ok(!/Win32_Product/i.test(script), `${id} usa Win32_Product`);
        assert.ok(!/\b(Set|New|Remove|Stop|Start|Restart|Invoke|Install|Uninstall|Enable|Disable)-[A-Z]/.test(script), `${id} scrive`);
        assert.ok(/ConvertTo-Json/.test(script), `${id} senza busta JSON`);
    }
});

test("windows: un id fuori dall'allowlist non raggiunge WinRM", async () => {
    const input = acquisitionInputSchema.parse(FIXTURE.windows.richiesta);
    let chiamate = 0;
    const read = createWinrmReader(input, SCRIPT_WINDOWS, async () => { chiamate++; return "{}"; });
    await assert.rejects(() => read(["Get-Process"]), /COMMAND_NOT_ALLOWED/);
    assert.equal(chiamate, 0);
});

test("windows: snapshot dalla fixture", async () => {
    const { snapshot: s } = await FIXTURE.windows.normale();
    assert.equal(s.identity.data?.firmware, "Microsoft Windows Server 2022 Standard (build 20348)");
    assert.equal(s.identity.data?.serial_number, "LABW0001");
    assert.equal(s.system?.data.timezone, "W. Europe Standard Time");
    assert.deepEqual(s.interfaces.data.map(i => [i.name, i.mac, i.speed_bps, i.oper_status]), [["Ethernet0", "02:00:00:00:50:01", 1e10, "up"]]);
    assert.equal(s.network.data.ipv4_addresses[0].netmask, "255.255.255.0");
    assert.equal(s.host_storage?.data.filesystems[0].used_bytes, "300000000000", "volumi letti anche nella forma { value, Count }");
    assert.deepEqual(s.software?.data.map(x => [x.name, x.source]), [["Lab Agent", "registry"], ["Hyper-V", "windows-feature"]]);
    assert.deepEqual(s.services?.data[0], { name: "W32Time", display_name: "Ora di Windows", state: "running", start_mode: "auto", account: "NT AUTHORITY\\LocalService" });
    assert.deepEqual(s.security?.data.firewall_profiles, [{ name: "Domain", enabled: true, default_inbound: "Block", default_outbound: "Allow" }]);
    assert.equal(s.security?.data.antivirus[0].signatures_up_to_date, null, "nessun riassunto ricavato dall'età delle firme");
    assert.deepEqual(s.guests?.data, [{ id: "0e3b3a3c-1111-2222-3333-444455556666", name: "vm-lab", power_state: "running", platform: "hyper-v" }]);
    assert.equal(s.poe.status, "unsupported");
});

test("windows: Hyper-V assente (busta UNSUPPORTED) è unsupported, non una lista vuota ok", async () => {
    const { collectDevice } = await import("../index");
    const t = {
        get: async () => { throw Error("x"); }, walk: async () => { throw Error("x"); }, shell: async () => { throw Error("x"); },
        winrm: async (ids: readonly string[]) => Object.fromEntries(ids.map(id => [id, { status: "ok" as const, data: id === "hyperv" ? '{"ok":false,"code":"UNSUPPORTED"}' : (id === "identita" ? JSON.stringify({ ok: true, data: { os_caption: "Windows 11 Pro", hostname: "pc-lab" } }) : '{"ok":true,"data":[]}'), warnings: [] }])),
    };
    const s = await collectDevice(FIXTURE.windows.richiesta, t);
    assert.equal(s.guests?.status, "unsupported");
    assert.deepEqual(s.guests?.data, []);
});

test("parser: busta, liste di PowerShell 5.1, MAC coi trattini, GUID obbligatorio", () => {
    assert.deepEqual(leggiBusta('{"ok":true,"data":1}'), { ok: true, data: 1 });
    assert.deepEqual(leggiBusta('{"ok":false,"code":"SCRIPT_FAILED"}'), { ok: false, code: "SCRIPT_FAILED" });
    assert.equal(leggiBusta("Get-Foo : errore"), null);
    assert.equal(leggiBusta('{"ok":false,"code":"messaggio libero con spazi"}'), null, "il codice è un codice, non un messaggio");
    assert.deepEqual(lista({ a: 1 }), [{ a: 1 }]);
    assert.deepEqual(lista({ value: [{ a: 1 }], Count: 1 }), [{ a: 1 }]);
    assert.equal(parseReteWindows({ adapters: { name: "NIC", mac: "02-00-00-00-00-0A", status: "Disconnected" } })?.interfacce[0].mac, "02:00:00:00:00:0a");
    assert.deepEqual(parseHyperv([{ id: "non-un-guid", name: "x", enabled_state: 2 }]), []);
    assert.equal(parseHyperv([{ id: "0E3B3A3C-1111-2222-3333-444455556666", enabled_state: 6 }])[0].power_state, "other");
});

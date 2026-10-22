import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotSchema } from "../schema";
import { systemSchema, hostStorageSchema, softwareSchema, servicesSchema, securitySchema } from "../sistema-schema";
import { redactSnapshot } from "../redact";
import { acquisitionInputSchema } from "../schema";
import { collectHpProcurve } from "../hp-procurve";

const at = new Date().toISOString();
const sec = <T>(data: T, status: "ok" | "partial" = "ok") => ({ status, collected_at: at, sources: ["test"], warnings: [], data });
const ok = <T>(data: T) => ({ status: "ok" as const, data, warnings: [] });
async function base() {
    return collectHpProcurve({ host: "192.0.2.1", collector: "hp-procurve", ssh: { username: "u", password: "p" } }, { get: async () => ok([]), walk: async () => ok([]), shell: async c => Object.fromEntries(c.map(x => [x, { status: "error" as const, data: "", warnings: ["TEST"] }])) });
}
const sistema = { os_name: "Linux", os_version: "12", os_build: null, kernel: "6.1.0", architecture: "x86_64", timezone: "Europe/Rome", boot_time: at, uptime_seconds: 3600, ntp: { enabled: true, synchronized: false, servers: ["192.0.2.123"] }, mandatory_access_control: { selinux: "disabled", apparmor: null } };
const storage = { disks: [{ name: "sda", model: "LAB", serial_number: null, size_bytes: "9007199254740993", rotational: false, transport: "sata" }], physical_volumes: [{ name: "/dev/sda2", volume_group: "vg0", size_bytes: "100", free_bytes: "0" }], volume_groups: [{ name: "vg0", size_bytes: "100", free_bytes: "0", logical_volume_count: 1 }], logical_volumes: [{ name: "root", volume_group: "vg0", size_bytes: "100", path: "/dev/vg0/root" }], filesystems: [{ device: "/dev/mapper/vg0-root", mount_point: "/", type: "ext4", size_bytes: "100", used_bytes: "40", available_bytes: "60", inodes_total: "1000", inodes_used: "10", inodes_free: "990" }] };

test("sezioni opzionali di sistema: dati validi passano; zero e false restano dati", () => {
    assert.equal(systemSchema.safeParse(sistema).success, true);
    assert.equal(hostStorageSchema.safeParse(storage).success, true);
    assert.equal(softwareSchema.safeParse([{ name: "demo", version: "1.0", publisher: null, install_date: null, source: "registry" }]).success, true);
    assert.equal(servicesSchema.safeParse([{ name: "svc", display_name: null, state: "running", start_mode: "auto", account: null }]).success, true);
    assert.equal(securitySchema.safeParse({ antivirus: [{ product: "Defender", enabled: false, real_time_protection: false, signatures_up_to_date: null }], firewall_profiles: [{ name: "Domain", enabled: false, default_inbound: null, default_outbound: null }] }).success, true);
});
test("capacità come stringhe decimali: un numero JS o un testo non numerico sono rifiutati", () => {
    assert.equal(hostStorageSchema.safeParse({ ...storage, disks: [{ ...storage.disks[0], size_bytes: 9007199254740993 }] }).success, false);
    assert.equal(hostStorageSchema.safeParse({ ...storage, disks: [{ ...storage.disks[0], size_bytes: "1TB" }] }).success, false);
    assert.equal(hostStorageSchema.safeParse({ ...storage, filesystems: [{ ...storage.filesystems[0], inodes_total: -1 }] }).success, false);
});
test("uno snapshot senza le sezioni nuove (1.0 già prodotto) resta valido; con le sezioni nuove pure", async () => {
    const snap = await base();
    assert.equal(snapshotSchema.safeParse(snap).success, true);
    const esteso = { ...snap, system: sec(sistema), host_storage: sec(storage, "partial"), software: sec([]), services: sec([]), security: sec({ antivirus: [], firewall_profiles: [] }) };
    const r = snapshotSchema.safeParse(esteso);
    assert.equal(r.success, true);
    assert.equal(r.success && r.data.host_storage?.data.disks[0].size_bytes, "9007199254740993");
});
test("la redazione non altera i conteggi in stringa decimale anche se coincidono col segreto", () => {
    const input = acquisitionInputSchema.parse({ host: "192.0.2.1", collector: "hp-procurve", ssh: { username: "u", password: "100" } });
    const snap = { schema_version: "1.0", collector: "hp-procurve", collector_version: "1.0.0", target: "x", collected_at: at, duration_ms: 1, status: "ok", host_storage: sec(storage) } as unknown as Parameters<typeof redactSnapshot>[0];
    const out = redactSnapshot(snap, input);
    const fs = out.host_storage?.data.filesystems[0];
    assert.equal(fs?.size_bytes, "100");
    assert.equal(fs?.inodes_total, "1000");
    assert.equal(out.host_storage?.data.logical_volumes[0].size_bytes, "100");
});

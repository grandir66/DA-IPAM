/**
 * Fixture di `device_info.nas_inventory` con la forma VERA scritta da `nas-acquisition.ts`, valori anonimizzati
 * (nessun NAS di cliente è stato interrogato: l'hub di sviluppo non ne ha). Stringhe SNMP come le scrive il
 * parser: codici numerici per Synology, testo per QNAP.
 */
import type { NasInventorySnapshot } from "@/lib/devices/device-info";

const disco = (n: number, extra: Record<string, unknown> = {}) => ({
  index: String(n - 1), id: `Disk ${n}`, model: "WD40EFRX-68N32N0", type: "SATA", status: "1",
  temperature_c: 34 + n, smart_health: "1", ...extra,
});

/** Synology a 8 baie (7 dischi + 1 vuoto), pool con volume quasi pieno, un disco con SMART in avviso. */
export const NAS_SYNOLOGY: NasInventorySnapshot = {
  vendor: "synology",
  sources: ["snmp", "ssh"],
  snmp: {
    temperature_c: 41,
    disks: [
      disco(3), disco(1), disco(2), disco(4), disco(5, { smart_health: "2" }), disco(6), disco(8),
    ],
    raids: [{ index: "0", name: "Storage Pool 1", status: "1", free_gb: 6120.4, total_gb: 21800.9 }],
    storage_pools: [{ name: "Storage Pool 1", status: "1", total_gb: 21800.9, used_gb: 15680.5 }],
    volume_io: [{ name: "volume1", read_bps: "48234496", write_bps: "9123" }, { name: "volume2", read_bps: "0", write_bps: "512000" }],
    ups: { status: "1", battery_pct: "100" },
    services: [{ name: "SMB", state: "running" }, { name: "NFS", state: "running" }, { name: "rsync", state: "stopped" }],
  },
  ssh: {
    mdstat_summary: "md2 : active raid6 sda5[0] sdb5[1] sdc5[2] sdd5[3] sde5[4] sdf5[5] sdh5[6]\nmd1 : active raid1 sda2[0] sdb2[1]\nmd0 : active raid1 sda1[0] sdb1[1]",
    cpu_model: "Intel(R) Xeon(R) CPU D-1521 @ 2.40GHz",
    kernel: "4.4.302+",
    synology_shares_preview: "backup\nvideo\nhome",
    synology_packages_count: 18,
    synology_storage_lines: "Pool 1 | RAID 6 | 21.3 TB",
    synology_temperature_lines: "Disk 5: 39 C",
  },
};

const dq = (n: number, extra: Record<string, unknown> = {}) => ({
  index: String(n), model: "WD121KFBX-68", serial: `ANON${n}XQ`, capacity_gb: 11176, temperature_c: 36 + n, status: "0", smart_health: "GOOD", ...extra,
});

/** QNAP a 8 baie: disco 5 con SMART «Warning», baia 7 senza disco, tre volumi RAID 6. */
export const NAS_QNAP: NasInventorySnapshot = {
  vendor: "qnap",
  sources: ["snmp"],
  snmp: {
    temperature_c: 41,
    disks: [dq(1), dq(2), dq(3), dq(4), dq(5, { smart_health: "Warning" }), dq(6), dq(7, { status: "-5", model: "", serial: "", capacity_gb: null, temperature_c: null, smart_health: "" }), dq(8)],
    volumes_snmp: [
      { name: "Backup", size_gb: 40960, free_gb: 3686.4, status: "Ready", raid_type: "RAID 6" },
      { name: "Dati", size_gb: 25600, free_gb: 15104, status: "Ready", raid_type: "RAID 6" },
    ],
    qts5_pool_rows: 12,
  },
};

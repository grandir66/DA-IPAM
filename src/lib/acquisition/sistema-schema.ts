/**
 * Sezioni opzionali per i sistemi (server, NAS, host): sistema operativo, storage dell'host, software, servizi,
 * sicurezza. Opzionali nello snapshot, come `storage` e `virtualization`: gli snapshot 1.0 già prodotti restano
 * validi. `null` = ignoto; zero e `false` sono dati. Capacità e conteggi come stringhe decimali (oltre 2^53),
 * unità nel nome del campo (`_bytes`, `_seconds`).
 */
import { z } from "zod";
const s = z.string().nullable(), n = z.number().finite().nullable(), b = z.boolean().nullable(), count = z.string().regex(/^\d+$/).nullable();
export const systemSchema = z.object({
    os_name: s, os_version: s, os_build: s, kernel: s, architecture: s, timezone: s, boot_time: s, uptime_seconds: n,
    ntp: z.object({ enabled: b, synchronized: b, servers: z.array(z.string()) }),
    mandatory_access_control: z.object({ selinux: z.enum(["enforcing", "permissive", "disabled"]).nullable(), apparmor: z.enum(["enabled", "disabled"]).nullable() }),
});
export const hostStorageSchema = z.object({
    disks: z.array(z.object({ name: z.string(), model: s, serial_number: s, size_bytes: count, rotational: b, transport: s })),
    physical_volumes: z.array(z.object({ name: z.string(), volume_group: s, size_bytes: count, free_bytes: count })),
    volume_groups: z.array(z.object({ name: z.string(), size_bytes: count, free_bytes: count, logical_volume_count: n })),
    logical_volumes: z.array(z.object({ name: z.string(), volume_group: s, size_bytes: count, path: s })),
    filesystems: z.array(z.object({ device: s, mount_point: z.string(), type: s, size_bytes: count, used_bytes: count, available_bytes: count, inodes_total: count, inodes_used: count, inodes_free: count })),
});
export const softwareSchema = z.array(z.object({ name: z.string(), version: s, publisher: s, install_date: s, source: s }));
export const servicesSchema = z.array(z.object({ name: z.string(), display_name: s, state: z.enum(["running", "stopped", "other"]).nullable(), start_mode: z.enum(["auto", "manual", "disabled", "other"]).nullable(), account: s }));
export const securitySchema = z.object({
    antivirus: z.array(z.object({ product: z.string(), enabled: b, real_time_protection: b, signatures_up_to_date: b })),
    firewall_profiles: z.array(z.object({ name: z.string(), enabled: b, default_inbound: s, default_outbound: s })),
});
/** Cartelle condivise di un NAS o di un server (SMB, NFS...). `path` è il percorso sul sistema, non un URL. */
export const sharesSchema = z.array(z.object({ name: z.string(), path: s, protocols: z.array(z.enum(["smb", "nfs", "afp", "ftp", "other"])), comment: s, public: b }));

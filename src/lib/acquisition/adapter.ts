import type { DeviceInfo } from "../devices/device-info";
import type { AcquisitionRequest, AcquisitionSnapshot, AcquisitionTransports } from "./schema";
import { collectDevice } from "./index";
/** Explicitly invoked adapter. No database, scheduler, UI, credential search or implicit fallback. */
export function toDeviceInfo(snapshot: AcquisitionSnapshot): DeviceInfo | null {
    const id = snapshot.identity.data;
    if (!id || !['ok', 'partial'].includes(snapshot.identity.status))
        return null;
    return { sysname: id.hostname, sysdescr: id.model, model: id.model, firmware: id.firmware, serial_number: id.serial_number, part_number: id.part_number ?? null, manufacturer: id.manufacturer, hostname: id.hostname ?? undefined };
}
export async function acquireForIpam(request: AcquisitionRequest, transports?: AcquisitionTransports) { const snapshot = await collectDevice(request, transports); return { snapshot, deviceInfo: toDeviceInfo(snapshot) }; }

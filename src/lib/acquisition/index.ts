import { collectNetappOntap } from "./netapp-ontap";
import { collectVmwareEsxi } from "./vmware-esxi";
import { collectInventoryDevice } from "./inventory-collector";
import { collectUnifiController } from "./unifi-controller";
import { acquisitionInputSchema } from "./schema";
import type { AcquisitionInput, AcquisitionRequest, AcquisitionSnapshot, AcquisitionTransports } from "./schema";
import { collectHpComware } from "./hp-comware";
import { collectHpProcurve } from "./hp-procurve";
import { collectQnapSwitch } from "./qnap-switch";
import { collectWindows } from "./windows";
import { collectLinux } from "./linux";
import { CATALOGO, versioneCollector } from "./catalogo";
import type { CollectorId } from "./catalogo";
type Collect = (request: AcquisitionInput, transports?: AcquisitionTransports) => Promise<AcquisitionSnapshot>;
/** Implementazioni per id: il tipo `Record<CollectorId, …>` fa fallire `tsc` se il catalogo ha un id senza collector. */
const IMPLEMENTAZIONI: Record<CollectorId, Collect> = {
    "netapp-ontap": (request: AcquisitionRequest) => collectNetappOntap(request),
    "vmware-esxi": (request: AcquisitionRequest) => collectVmwareEsxi(request),
    "hp-comware": collectHpComware,
    "hp-procurve": collectHpProcurve,
    "qnap-switch": collectQnapSwitch,
    "qnap-nas": collectInventoryDevice,
    "mikrotik-routeros": collectInventoryDevice,
    "synology-dsm": collectInventoryDevice,
    "ubiquiti-device": collectInventoryDevice,
    "proxmox-ve": collectInventoryDevice,
    "unifi-controller": (request: AcquisitionRequest) => collectUnifiController(request),
    "windows": collectWindows,
    "linux": collectLinux,
};
/** Registry statico derivato dal catalogo: nessun codice caricato a runtime. Una famiglia nuova: vedi `catalogo.ts`. */
export const COLLECTORS = Object.freeze(Object.fromEntries(CATALOGO.map(d => [d.id, { version: versioneCollector(d.id), collect: IMPLEMENTAZIONI[d.id] }])) as Record<CollectorId, { version: string; collect: Collect }>);
export async function collectDevice(request: AcquisitionRequest, transports?: AcquisitionTransports) { const input = acquisitionInputSchema.parse(request); return COLLECTORS[input.collector].collect(input, transports); }
export { acquisitionInputSchema, snapshotSchema } from "./schema";
export { CATALOGO, COLLECTOR_IDS, descrittore } from "./catalogo";
export type { CollectorId, DescrittoreCollector } from "./catalogo";
export type { AcquisitionRequest, AcquisitionInput, AcquisitionSnapshot, AcquisitionTransports } from "./schema";

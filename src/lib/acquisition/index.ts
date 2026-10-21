import {collectNetappOntap} from "./netapp-ontap";
import {collectVmwareEsxi} from "./vmware-esxi";
import { acquisitionInputSchema } from "./schema";
import type { AcquisitionRequest, AcquisitionTransports } from "./schema";
import { collectHpComware } from "./hp-comware";
import { collectHpProcurve } from "./hp-procurve";
import { collectQnapSwitch } from "./qnap-switch";
/** Static registry: a new family adds a collector and its validated request variant. No runtime code upload. */
export const COLLECTORS = Object.freeze({ "netapp-ontap":{version:"1.0.0",collect:(request:AcquisitionRequest)=>collectNetappOntap(request)}, "vmware-esxi": {version:"1.0.0",collect:(request: AcquisitionRequest)=>collectVmwareEsxi(request)}, "hp-comware": { version: "1.0.0", collect: collectHpComware }, "hp-procurve": { version: "1.0.0", collect: collectHpProcurve }, "qnap-switch": { version: "1.0.0", collect: collectQnapSwitch } });
export async function collectDevice(request: AcquisitionRequest, transports?: AcquisitionTransports) { const input = acquisitionInputSchema.parse(request); return COLLECTORS[input.collector].collect(input, transports); }
export { acquisitionInputSchema, snapshotSchema } from "./schema";
export type { AcquisitionRequest, AcquisitionInput, AcquisitionSnapshot, AcquisitionTransports } from "./schema";

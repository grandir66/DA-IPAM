import { acquisitionInputSchema } from "./schema";
import type { AcquisitionRequest, AcquisitionTransports } from "./schema";
import { collectHpProcurve } from "./hp-procurve";
import { collectQnapSwitch } from "./qnap-switch";
/** Static registry: a new family adds a collector and its validated request variant. No runtime code upload. */
export const COLLECTORS = Object.freeze({ "hp-procurve": {version:"1.0.0", collect:collectHpProcurve}, "qnap-switch": { version: "1.0.0", collect: collectQnapSwitch } });
export async function collectDevice(request: AcquisitionRequest, transports?: AcquisitionTransports) { const input = acquisitionInputSchema.parse(request); return COLLECTORS[input.collector].collect(input, transports); }
export { acquisitionInputSchema, snapshotSchema } from "./schema";
export type { AcquisitionRequest, AcquisitionInput, AcquisitionSnapshot, AcquisitionTransports } from "./schema";

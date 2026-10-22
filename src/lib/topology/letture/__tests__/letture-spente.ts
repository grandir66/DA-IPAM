/**
 * Per le prove che partono «a letture spente»: dal 22/10 (ADR 0031) una chiave assente vale ACCESA, quindi la partenza spenta
 * si dichiara. Da mettere subito dopo il `DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%'` del `beforeEach`.
 */
import { LETTURE, chiaveLettura } from "@/lib/topology/letture/interruttori";

export const LETTURE_SPENTE_SQL = LETTURE
  .map((l) => `INSERT INTO tenant_settings (key, value) VALUES ('${chiaveLettura(l)}', '{"acceso":false,"da":null,"il":null}');`)
  .join("\n");

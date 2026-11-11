import { CATEGORY_TAXONOMY } from "@/lib/attribution/taxonomy";

/** Parola semplice per le foglie che il cliente riconosce. Le altre di iot.* e ot.* sono «dispositivo». */
const NOMI: Record<string, string> = {
  "network.router": "router",
  "network.switch": "switch",
  "network.access_point": "punto Wi-Fi",
  "network.firewall": "firewall",
  "network.controller": "controllo Wi-Fi",
  "network.modem": "modem",
  "compute.server": "server",
  "compute.workstation": "computer fisso",
  "compute.laptop": "portatile",
  "compute.hypervisor": "server di virtualizzazione",
  "compute.vm": "macchina virtuale",
  "storage.nas": "archivio di rete",
  "storage.san": "archivio di rete",
  "storage.tape": "unità a nastro",
  "peripheral.printer": "stampante",
  "peripheral.scanner": "scanner",
  "peripheral.mfp": "multifunzione",
  "av.camera": "telecamera",
  "av.nvr": "videoregistratore",
  "av.display": "schermo",
  "av.speaker": "altoparlante",
  "voip.phone": "telefono",
  "voip.pbx": "centralino",
  "voip.gateway": "adattatore telefonico",
  "power.ups": "gruppo di continuità",
  "power.pdu": "presa comandata",
  "mobile.phone": "cellulare",
  "mobile.tablet": "tablet",
};

/** attr_category ("network.switch", "compute.workstation", …) → parola semplice. Sconosciuta o null → null. */
export function nomeCategoria(categoria: string | null): string | null {
  if (!categoria) return null;
  const noto = NOMI[categoria];
  if (noto) return noto;
  const [radice, foglia] = categoria.split(".");
  if (!foglia || (radice !== "iot" && radice !== "ot")) return null;
  const foglie = CATEGORY_TAXONOMY[radice];
  return (foglie as readonly string[]).includes(foglia) ? "dispositivo" : null;
}

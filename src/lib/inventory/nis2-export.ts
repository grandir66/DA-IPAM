import { joinCsvRow } from "@/lib/csv-utils";
import { NIS2_EXPORT_KEYS } from "@/lib/inventory/nis2-fields";

type AssetRow = Record<string, unknown> & {
  network_device_name?: string;
  host_ip?: string;
  assignee_name?: string;
};

const DERIVED_EXPORT: { key: string; label: string; pick: (a: AssetRow) => string }[] = [
  { key: "assignee_name", label: "proprietario_business", pick: (a) => String(a.assignee_name ?? "") },
  { key: "network_device_name", label: "device_collegato", pick: (a) => String(a.network_device_name ?? "") },
  { key: "host_ip", label: "host_collegato", pick: (a) => String(a.host_ip ?? "") },
];

function formatCell(key: string, value: unknown): string {
  if (value == null || value === "") return "";
  if (key === "in_scope_nis2" || key === "crittografia_disco" || key === "gestito_da_mdr") {
    return Number(value) === 1 ? "Si" : "No";
  }
  return String(value);
}

/** Genera CSV UTF-8 BOM con soli campi NIS2. */
export function buildNis2InventoryCsv(assets: AssetRow[]): string {
  const derivedKeys = new Set(DERIVED_EXPORT.map((d) => d.key));
  const headers = [
    ...NIS2_EXPORT_KEYS.filter((k) => !derivedKeys.has(k)),
    ...DERIVED_EXPORT.map((d) => d.label),
  ];

  const rows = assets.map((asset) => {
    const base = NIS2_EXPORT_KEYS
      .filter((k) => !derivedKeys.has(k))
      .map((key) => formatCell(key, asset[key]));
    const derived = DERIVED_EXPORT.map((d) => d.pick(asset));
    return joinCsvRow([...base, ...derived]);
  });

  return "\uFEFF" + joinCsvRow(headers) + "\n" + rows.join("\n");
}

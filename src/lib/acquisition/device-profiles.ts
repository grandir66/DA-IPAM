/** Famiglie lette dal motore d'inventario: elenco e allowlist derivano dal catalogo (`motore: "inventario"`), non da una copia. */
import { CATALOGO } from "./catalogo";
export type InventoryProfile = Extract<(typeof CATALOGO)[number], { motore: "inventario" }>["id"];
export const INVENTORY_COMMANDS = Object.fromEntries(CATALOGO.filter(d => "motore" in d && d.motore === "inventario").map(d => [d.id, d.comandi])) as unknown as Record<InventoryProfile, readonly string[]>;
export const isInventoryProfile = (name: string): name is InventoryProfile => Object.hasOwn(INVENTORY_COMMANDS, name);

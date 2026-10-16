/**
 * Cancellazione dei dati storici di un modulo alla disinstallazione
 * (casella «Elimina anche i dati storici»).
 *
 * Estratta da /api/features/[key]/uninstall senza cambiarne il comportamento,
 * perché le prove di MOD-19 la eseguano davvero e la confrontino con il testo
 * della conferma (src/lib/modules/uninstall-copy.ts).
 */
import type { Database } from "better-sqlite3";
import { dropPatchModuleSchema, patchModuleTablesExist } from "@/lib/patch/schema";
import { dropInventoryAgentSchema, INVENTORY_AGENT_TABLES } from "@/lib/inventory-agent/schema";
import { dropMcSchema } from "@/lib/integrations/meshcentral/schema";
import type { UninstallableFeature } from "@/lib/modules/uninstall-copy";

/**
 * Cancella le tabelle del modulo dal DB del cliente. Ritorna true se ha
 * cancellato qualcosa (è il `dataDropped` della risposta della rotta).
 *
 * Patch Management cancella solo se tutte e quattro le tabelle esistono: con
 * lo schema assente o incompleto non tocca niente e ritorna false.
 */
export function dropFeatureData(db: Database, key: UninstallableFeature): boolean {
  switch (key) {
    case "patch_management":
      if (!patchModuleTablesExist(db)) return false;
      return dropPatchModuleSchema(db).tablesDropped.length > 0;
    case "inventory_agent":
      dropInventoryAgentSchema(db);
      return INVENTORY_AGENT_TABLES.length > 0;
    case "meshcentral":
      dropMcSchema(db);
      return true;
  }
}

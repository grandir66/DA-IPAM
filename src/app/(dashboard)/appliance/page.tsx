import { redirect } from "next/navigation";

/**
 * Il catalogo moduli appliance è stato assorbito dalla Launchpad (tile moduli
 * con stato + Apri + Configura). Redirect per compatibilità link.
 */
export default function AppliancePage() {
  redirect("/launchpad");
}

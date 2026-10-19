import { redirect } from "next/navigation";

/**
 * Il Launchpad a tessere non c'è più (Riccardo, 19/10): era un doppione delle voci del
 * menu. Gli applicativi stanno nel gruppo «Applicativi» del menu; stato e salute dei
 * moduli in Impostazioni → Moduli, dove porta chi aveva questo indirizzo.
 */
export default function LaunchpadPage() {
  redirect("/settings?tab=moduli");
}

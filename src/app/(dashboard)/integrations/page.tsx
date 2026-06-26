import { redirect } from "next/navigation";

/**
 * La vista integrazioni in-app è stata assorbita dalla Launchpad (unico punto
 * di accesso). Manteniamo il redirect così i deep-link esistenti continuano a
 * funzionare.
 */
export default function IntegrationsPage() {
  redirect("/launchpad");
}

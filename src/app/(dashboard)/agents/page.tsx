import { redirect } from "next/navigation";

/** L'URL pubblico dell'hub sta in Impostazioni → Sistema dal 23/10: qui resta il rimando per i link vecchi. */
export default function AgentsPage() {
  redirect("/settings?tab=sistema#hub-url-config");
}

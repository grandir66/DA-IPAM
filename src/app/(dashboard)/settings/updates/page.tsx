import { redirect } from "next/navigation";

export const metadata = {
  title: "Aggiornamenti — DA-IPAM",
};

export default function UpdatesRedirectPage() {
  redirect("/settings?tab=aggiornamenti");
}

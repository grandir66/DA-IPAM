import { redirect } from "next/navigation";

export default function SettingsFeaturesRedirectPage() {
  redirect("/settings?tab=moduli");
}

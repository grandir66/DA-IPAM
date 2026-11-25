import { SoloAdmin } from "@/components/protezione/pezzi";
import { leggiProtezione } from "../leggi";
import { ChiPuoCollegarsi } from "./chi-puo-collegarsi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chi può collegarsi — DA-IPAM" };

export default async function ChiPuoCollegarsiPage() {
  const quadro = await leggiProtezione();
  if (!quadro) return <SoloAdmin />;
  return (
    <div className="space-y-3">
      <h1 className="sr-only">Chi può collegarsi</h1>
      <ChiPuoCollegarsi />
    </div>
  );
}

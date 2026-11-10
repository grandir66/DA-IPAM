import { ScansClient } from "./scans-client";

export const metadata = {
  title: "Scansioni di rete — DA-IPAM",
};

export default function ScansPage() {
  return (
    <div className="p-4 sm:p-6">
      <ScansClient />
    </div>
  );
}

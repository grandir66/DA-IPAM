"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OnlineChart } from "@/components/shared/online-chart";

export function DashboardClient() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stato Host nel Tempo</CardTitle>
      </CardHeader>
      <CardContent>
        <OnlineChart />
      </CardContent>
    </Card>
  );
}

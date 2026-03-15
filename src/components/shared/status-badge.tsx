"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "online" | "offline" | "unknown";
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-medium",
        status === "online" && "border-success/30 bg-success/10 text-success",
        status === "offline" && "border-destructive/30 bg-destructive/10 text-destructive",
        status === "unknown" && "border-muted-foreground/30 bg-muted text-muted-foreground",
        className
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          status === "online" && "bg-success animate-pulse",
          status === "offline" && "bg-destructive",
          status === "unknown" && "bg-muted-foreground"
        )}
      />
      {status === "online" ? "Online" : status === "offline" ? "Offline" : "Sconosciuto"}
    </Badge>
  );
}

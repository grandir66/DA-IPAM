"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Search, Monitor, Network } from "lucide-react";
import type { Host, Network as NetworkType } from "@/types";

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ hosts: Host[]; networks: NetworkType[] }>({
    hosts: [],
    networks: [],
  });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults({ hosts: [], networks: [] });
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then(setResults)
        .catch(() => setResults({ hosts: [], networks: [] }));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const hasResults = results.hosts.length > 0 || results.networks.length > 0;

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Cerca IP, hostname, MAC, rete..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="pl-9"
        />
      </div>

      {open && query.length >= 2 && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-card border border-border rounded-lg shadow-lg z-50 max-h-80 overflow-auto">
          {!hasResults ? (
            <p className="p-4 text-sm text-muted-foreground text-center">Nessun risultato</p>
          ) : (
            <>
              {results.networks.length > 0 && (
                <div>
                  <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50">Reti</p>
                  {results.networks.map((net) => (
                    <button
                      key={`net-${net.id}`}
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
                      onClick={() => {
                        router.push(`/networks/${net.id}`);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <Network className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium">{net.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{net.cidr}</span>
                    </button>
                  ))}
                </div>
              )}
              {results.hosts.length > 0 && (
                <div>
                  <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50">Host</p>
                  {results.hosts.map((host) => (
                    <button
                      key={`host-${host.id}`}
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
                      onClick={() => {
                        router.push(`/hosts/${host.id}`);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-mono font-medium">{host.ip}</span>
                      <span className="text-muted-foreground truncate">
                        {host.custom_name || host.hostname || host.mac || ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

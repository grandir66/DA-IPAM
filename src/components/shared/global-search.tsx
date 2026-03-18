"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Search, Monitor, Network } from "lucide-react";
import type { Host, Network as NetworkType } from "@/types";

interface SearchResult {
  type: "network" | "host";
  id: number;
  href: string;
  label: string;
  sublabel: string;
}

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ hosts: Host[]; networks: NetworkType[] }>({
    hosts: [],
    networks: [],
  });
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = "global-search-listbox";

  // Build flat list of results for keyboard navigation
  const flatResults = useMemo<SearchResult[]>(() => {
    const items: SearchResult[] = [];
    for (const net of results.networks) {
      items.push({
        type: "network",
        id: net.id,
        href: `/networks/${net.id}`,
        label: net.name,
        sublabel: net.cidr,
      });
    }
    for (const host of results.hosts) {
      items.push({
        type: "host",
        id: host.id,
        href: `/hosts/${host.id}`,
        label: host.ip,
        sublabel: host.custom_name || host.hostname || host.mac || "",
      });
    }
    return items;
  }, [results]);

  // Reset selectedIndex when results change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [flatResults]);

  // Fetch search results with debounce
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

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    function handleGlobalKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", handleGlobalKeydown);
    return () => document.removeEventListener("keydown", handleGlobalKeydown);
  }, []);

  const navigateToResult = useCallback(
    (result: SearchResult) => {
      router.push(result.href);
      setOpen(false);
      setQuery("");
      setSelectedIndex(-1);
    },
    [router]
  );

  // Keyboard navigation in results
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open || flatResults.length === 0) {
        if (e.key === "Escape") {
          setOpen(false);
          inputRef.current?.blur();
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < flatResults.length - 1 ? prev + 1 : 0
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : flatResults.length - 1
          );
          break;
        case "Enter":
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < flatResults.length) {
            navigateToResult(flatResults[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          setSelectedIndex(-1);
          break;
      }
    },
    [open, flatResults, selectedIndex, navigateToResult]
  );

  const hasResults = flatResults.length > 0;
  const activeDescendant =
    selectedIndex >= 0 ? `search-result-${selectedIndex}` : undefined;

  // Track which index each network/host maps to
  let itemIndex = 0;

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="Cerca IP, hostname, MAC, rete..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="pl-9 pr-12"
          role="combobox"
          aria-expanded={open && query.length >= 2}
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
          aria-autocomplete="list"
          aria-label="Ricerca globale"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden h-5 select-none items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </div>

      {open && query.length >= 2 && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Risultati ricerca"
          className="absolute top-full mt-1 left-0 right-0 bg-card border border-border rounded-lg shadow-lg z-50 max-h-80 overflow-auto"
        >
          {!hasResults ? (
            <p className="p-4 text-sm text-muted-foreground text-center" role="status">
              Nessun risultato
            </p>
          ) : (
            <>
              {results.networks.length > 0 && (
                <div role="group" aria-label="Subnet">
                  <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50">
                    Subnet
                  </p>
                  {results.networks.map((net) => {
                    const idx = itemIndex++;
                    return (
                      <button
                        key={`net-${net.id}`}
                        id={`search-result-${idx}`}
                        role="option"
                        aria-selected={selectedIndex === idx}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors text-left ${
                          selectedIndex === idx
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-muted"
                        }`}
                        onClick={() =>
                          navigateToResult({
                            type: "network",
                            id: net.id,
                            href: `/networks/${net.id}`,
                            label: net.name,
                            sublabel: net.cidr,
                          })
                        }
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <Network className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-medium">{net.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {net.cidr}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {results.hosts.length > 0 && (
                <div role="group" aria-label="Host">
                  <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50">
                    Host
                  </p>
                  {results.hosts.map((host) => {
                    const idx = itemIndex++;
                    return (
                      <button
                        key={`host-${host.id}`}
                        id={`search-result-${idx}`}
                        role="option"
                        aria-selected={selectedIndex === idx}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors text-left ${
                          selectedIndex === idx
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-muted"
                        }`}
                        onClick={() =>
                          navigateToResult({
                            type: "host",
                            id: host.id,
                            href: `/hosts/${host.id}`,
                            label: host.ip,
                            sublabel:
                              host.custom_name || host.hostname || host.mac || "",
                          })
                        }
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-mono font-medium">{host.ip}</span>
                        <span className="text-muted-foreground truncate">
                          {host.custom_name || host.hostname || host.mac || ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

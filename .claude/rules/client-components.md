---
scope: React client components
paths:
  - "src/components/**"
  - "src/app/**/page.tsx"
  - "src/app/**/*.tsx"
---

# Client components — regole

## Cleanup OBBLIGATORIO per setInterval / setTimeout

Memory leak garantito al cambio pagina senza cleanup:

```tsx
"use client";
import { useEffect, useRef } from "react";

export function MyComponent() {
  const idRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    idRef.current = setInterval(() => { /* ... */ }, 5000);
    return () => { if (idRef.current) clearInterval(idRef.current); };
  }, []);
}
```

Lo stesso vale per `AbortController` su `fetch` lunghi e per `EventSource` / WebSocket.

## shadcn/ui v4 (@base-ui/react)

NON usare `asChild`:

```tsx
// SBAGLIATO
<DialogTrigger asChild><Button>Apri</Button></DialogTrigger>
// CORRETTO
<DialogTrigger render={<Button>Apri</Button>} />
```

## Date dal database, errori di caricamento, Select (2026-10-12)

- **Date del DB → `parseDbDate(x)`** da `@/lib/db-date`, mai `new Date(x)`: SQLite
  scrive UTC senza fuso (`2026-10-12 08:00:00`) e `new Date` lo legge come ora
  locale (orari indietro di 1-2 ore, «Invalid Date» su Safari). Nelle pagine rese
  sul server: `toLocaleString("it-IT", { timeZone: FUSO_UTENTI })`, la VM è in UTC.
- **Caricare dati → `fetchJson`** (`@/lib/fetch-json`) e, se `!ok`, il riquadro
  `LoadError` con «Riprova». Mai `if (!res.ok) return` né `catch { setX([]) }`:
  un errore mostrato come lista vuota fa credere che i dati non ci siano.
- **`<Select>`**: l'etichetta nel trigger la ricava il wrapper dalle `<SelectItem>`
  figlie. Se le voci le genera un componente proprio, passare `items` a mano.

## Fetch + refresh

Per mutazioni: dopo la fetch chiamare `router.refresh()` (Server Components re-render). NON chiamare `revalidatePath` da client.

```tsx
const router = useRouter();
await fetch("/api/...", { method: "POST", body: JSON.stringify(payload) });
router.refresh();
```

## i18n

UI/errori → italiano. Niente `toast.error("Error")`; usare `toast.error("Errore: ...")`.

## Performance

- Liste lunghe (>100 elementi) → paginazione client o virtual list. Mai render full table.
- `useMemo`/`useCallback` SOLO quando profilato un re-render costoso. Default: no.
- Immagini: `next/image`, non `<img>`.

## Anti-pattern

- `console.log` lasciato nel codice committato → no. Usare `console.warn("[DEBUG]")` temporaneo, rimuovere prima del commit.
- State derivato da props con `useState` → meglio calcolarlo durante il render.
- `fetch` in loop senza `AbortController` → cancellare al unmount.

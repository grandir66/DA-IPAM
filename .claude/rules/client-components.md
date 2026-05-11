---
scope: React client components
applies_to: src/components/**, src/app/**/page.tsx, src/app/**/*.tsx (con "use client")
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

/** Barra orizzontale. La larghezza è valore/massimo, fra 0 e 100%. */
export function Barra({ valore, massimo }: { valore: number; massimo: number }) {
  const rapporto = massimo > 0 ? valore / massimo : 0;
  const percentuale = Math.min(100, Math.max(0, rapporto * 100));
  return (
    <div className="h-1.5 w-full rounded-sm bg-[var(--vc-barra-fondo)]">
      <div className="h-full rounded-sm bg-[var(--vc-cian)]" style={{ width: `${percentuale}%` }} />
    </div>
  );
}

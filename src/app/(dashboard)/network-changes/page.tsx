import { IntestazionePagina, Pannello, Vuoto } from "@/components/shared/console";

export default function NetworkChangesPage() {
  return (
    <div className="space-y-4">
      <IntestazionePagina
        titolo="Network Changes"
        sottotitolo="Cambiamenti tra giri di Discovery per tutte le subnet."
      />
      <Pannello titolo="Cambiamenti">
        <Vuoto
          titolo="Confronto in preparazione"
          testo="I cambiamenti compariranno qui quando Discovery inizierà a salvare i risultati dei confronti."
        />
      </Pannello>
    </div>
  );
}

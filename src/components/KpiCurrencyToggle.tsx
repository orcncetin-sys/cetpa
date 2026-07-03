// App.tsx'ten tasindi - satin-alma/IK sayfa ayrimlari sirasinda paylasilan
// kucuk bir toggle oldugu icin ortak componente cikarildi.
export default function KpiCurrencyToggle({ kpiCurrency, setKpiCurrency }: { kpiCurrency: 'TRY'|'USD'|'EUR'; setKpiCurrency: (c: 'TRY'|'USD'|'EUR') => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
      {(['TRY','USD','EUR'] as const).map(c => (
        <button key={c} onClick={() => setKpiCurrency(c)}
          className={`text-[11px] font-bold px-2 py-1 rounded-md transition-all ${kpiCurrency===c ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
          {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
        </button>
      ))}
    </div>
  );
}

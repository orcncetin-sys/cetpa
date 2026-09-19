/**
 * SevkDeposuSecici — "Sevk Deposu (Mikro)" seçicisi. Sipariş EKLE ve DÜZENLE formlarının TEK bileşeni
 * (2026-09-19, Faz 3 3/n kapanışı).
 *
 * NEDEN: Mikro'ya yazan her gövde (`sip_depono`, `sth_giris/cikis_depo_no`) depo numarasını ZORUNLU kılar ve
 * sunucu bilinmiyorsa 400 döner — VARSAYILAN YOK (2026-09-05: sabit `1` her kaydı HAVALİMANI deposuna yazıyordu,
 * stok depo 2'deydi). Seçici ilk hâlinde yalnız yeni sipariş formundaydı; ESKİ siparişe depo eklemenin hiçbir yolu
 * yoktu, yani o siparişler Mikro'ya kalıcı olarak yazılamıyordu (kapanış incelemesi — regresyon).
 *
 * Seçenek listesi tek kaynaktan: `utils/muhasebe/depoNo.mikroDepoSecenekleri` (yalnız dep_no'su ÇÖZÜLEBİLEN depolar).
 * Liste boşsa bileşen seçici yerine NEDENİNİ söyler ("Depo Tanımları" importu koşmamış) — sessizce kaybolmaz.
 */
import { useMemo } from 'react';
import type { Warehouse } from '../types';
import { mikroDepoSecenekleri } from '../utils/muhasebe/depoNo';

interface SevkDeposuSeciciProps {
  warehouses: Warehouse[];
  /** Seçili Mikro depo numarası; seçilmemişse undefined. */
  deger: number | undefined;
  /** Boş seçimde `undefined` — çağıran alanı state'ten KALDIRMALI (Firestore `undefined` alanı reddeder; 0 sahte depo). */
  onDegis: (depoNo: number | undefined) => void;
  currentLanguage: string;
  /** Sipariş kaydedilince Mikro'ya yazılacaksa (faturalı + carisi seçili) seçim zorunlu. */
  zorunlu?: boolean;
  /** Düzenlemede: depo bir kez seçildiyse "seçilmedi"ye dönülemez (PATCH-merge eski değeri korurdu — sessiz no-op). */
  bosSecenekYok?: boolean;
}

export default function SevkDeposuSecici({ warehouses, deger, onDegis, currentLanguage, zorunlu = false, bosSecenekYok = false }: SevkDeposuSeciciProps) {
  const tr = currentLanguage === 'tr';
  const secenekler = useMemo(() => mikroDepoSecenekleri(warehouses), [warehouses]);

  // Kayıtlı depo LİSTEDE YOKSA (depo silinmiş / Mikro tanımı değişmiş): kontrollü <select> eşleşen <option>
  // bulamayınca İLK seçeneği seçili GÖSTERİR ama state eski numarada kalır — ekranda görünen depo ile kaydedilen
  // depo ayrışırdı (2026-09-19 son parti incelemesi). Değer kendi seçeneğiyle gösterilir ve kullanıcı uyarılır.
  const listedeYok = deger !== undefined && !secenekler.some(d => d.no === deger);

  if (secenekler.length === 0 && !listedeYok) {
    return (
      <p className="text-[10px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">
        {tr
          ? 'Mikro depo tanımı bulunamadı — sevk deposu seçilemiyor, sipariş/e-İrsaliye Mikro’ya yazılmaz. Mikro Senkron → "Depo Tanımları" importunu bir kez çalıştırın.'
          : 'No Mikro warehouse definitions — a shipping warehouse cannot be selected, so the order/e-waybill will not be written to Mikro. Run Mikro Sync → "Warehouse Definitions" once.'}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold text-gray-500 uppercase">
        {tr ? 'Sevk Deposu (Mikro)' : 'Shipping Warehouse (Mikro)'}
      </label>
      <select
        required={zorunlu}
        value={deger ?? ''}
        onChange={e => onDegis(e.target.value === '' ? undefined : Number(e.target.value))}
        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-colors"
      >
        {!(bosSecenekYok && deger !== undefined) && (
          <option value="">
            {zorunlu ? (tr ? 'Depo seçin' : 'Select a warehouse') : (tr ? 'Seçilmedi — Mikro’ya gönderilmez' : 'Not selected — not sent to Mikro')}
          </option>
        )}
        {listedeYok && (
          <option value={deger}>{deger} — {tr ? 'tanımsız depo (listede yok)' : 'unknown warehouse (not in the list)'}</option>
        )}
        {secenekler.map(d => (
          <option key={d.no} value={d.no}>{d.no} — {d.ad}</option>
        ))}
      </select>
      {listedeYok && (
        <p className="text-[10px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">
          {tr
            ? `Bu siparişte kayıtlı depo (${deger}) güncel Mikro depo listesinde yok. Mikro’ya bu numarayla yazılır — doğru depoyu seçin.`
            : `The warehouse stored on this order (${deger}) is not in the current Mikro list. It will be written to Mikro as is — pick the right warehouse.`}
        </p>
      )}
      {deger === undefined && (
        <p className="text-[10px] text-amber-600">
          {tr
            ? 'Depo seçilmezse sipariş ve e-İrsaliye Mikro’ya YAZILMAZ (yanlış depoya yazmamak için). e-Fatura seçilen depoya, seçilmemişse Mikro varsayılanına yazılır.'
            : 'Without a warehouse the order and e-waybill are NOT written to Mikro (to avoid the wrong depot). The e-invoice uses the selected warehouse, otherwise the Mikro default.'}
        </p>
      )}
    </div>
  );
}

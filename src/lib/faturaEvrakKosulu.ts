/**
 * faturaEvrakKosulu.ts — «Bu Mikro cari hareketi bir FATURA evrakı mı?» yüklemi. TEK KAYNAK (saf; istemci + sunucu).
 * Şartname q-serisi v3 Q13 + «Kapı sonrası hükümler» QH9 (2026-11-05, Dilim 1).
 *
 * KURAL — `server/mikro/seriOzet.faturaKosuluIfadesi` SQL'iyle AYNI küme (iki metnin eşitliği `faturaEvrakKosulu.test.ts`'te
 * çitli): SATIŞ faturası `cha_evrak_tip = 63`; ALIŞ faturası `cha_evrak_tip = 0 AND cha_cinsi = 6`.
 *
 * NEDEN: dekont uçları (`/api/mikro/cari-hareket/kaydet`, `/api/mikro/evrak/kaydet` + `DekontKaydetV2`) istemcinin `cha_*`
 * alanlarını Mikro'ya geçiriyordu — fatura evrak tipi (63) ve keyfi seri ('Q') durdurulmuyordu (kapı a1-3). Dekont penceresi
 * listenin İLK türünü varsayılan seçiyordu; liste `COUNT(*) DESC` sıralı ve canlıda en kalabalık grup 63 / 6 / 0 (412 satış
 * faturası) → varsayılan tür fatura evrak tipiydi. «Yazım bayrağı kapalıyken hiçbir yoldan Q yazılamaz» ancak bununla doğrudur.
 *
 * TİPE DAYANIKLI (kapı k12): değer istemciden metin gelebilir (`'63'`, `' 63'`) ya da ondalıklı sayı (`63.0`) —
 * `Number(String(v).trim())` ile çevrilir; `=== 63` metni kaçırırdı. Güvence SUNUCUDADIR; istemci süzgeci yalnız kolaylık.
 */

/** Evrak kodu sayıya: `Number(String(v).trim())` (null / undefined → NaN; '63' / ' 63' / 63.0 → 63). */
export const evrakKodu = (v: unknown): number => Number(String(v).trim());

/** Fatura evrakı mı: SATIŞ (63) ya da ALIŞ (0 + cinsi 6). */
export function faturaEvrakiMi(evrakTip: unknown, cinsi: unknown): boolean {
  const tip = evrakKodu(evrakTip);
  return tip === 63 || (tip === 0 && evrakKodu(cinsi) === 6);
}

/**
 * Anahtar katlaması — YALNIZ kod kimliği karşılaştırması (ekran metni değil): uyumluluk biçimi (NFKC; ör. Kelvin «K», uzun «ſ»),
 * Türkçe `İ` / `ı` → `i`, ASCII küçük harf, birleşik nokta (U+0307) ayıklanır.
 */
const anahtarKatla = (k: string): string => k.normalize('NFKC').replace(/[İı]/g, 'i').toLowerCase().replace(/\u0307/g, '');
const EVRAK_ANAHTARLARI: ReadonlySet<string> = new Set(['cha_evrak_tip', 'cha_cinsi']);

/**
 * Evrak tipi / cinsi anahtarı YALNIZ birebir küçük harf yazımıyla kabul edilir; başka yazımı (`CHA_EVRAK_TIP`, `Cha_Evrak_Tip`,
 * `CHA_CİNSİ` …) varsa red nedeni, yoksa null. NEDEN (bulgu Q6, 2026-11-05): kapı yalnız `cha_evrak_tip` / `cha_cinsi`'yi okuyordu;
 * ikinci yazım kapıdan geçip `...hareket` yayılımıyla Mikro gövdesine gidiyordu. Mikro'nun anahtar eşlemesi (.NET büyük-küçük
 * harf duyarsız mı, SQL Turkish_CI mi) ÖLÇÜLMEDİ — denetlenemeyen yazım Mikro'ya gitmez. Çağıranlar: `dekontGovdesiFaturaHatasi`
 * (evrak/kaydet) ve `server/mikro/govdeMuhasebe.cariHareketGovdesi` (cari-hareket/kaydet); ikisi de `faturaEvrakiMi`'den ÖNCE.
 */
export function evrakAnahtariYazimHatasi(satir: Readonly<Record<string, unknown>>): string | null {
  for (const k of Object.keys(satir)) {
    const n = anahtarKatla(k);
    if (EVRAK_ANAHTARLARI.has(n) && k !== n) return `«${k.slice(0, 64)}» anahtarı yalnız «${n}» yazımıyla kabul edilir.`;
  }
  return null;
}

/** Evrak tipi verilmiş mi: bilinen sonlu sayı (sayı ya da boş olmayan metin) ve > 0 — `cariHareketGovdesi`'nin kuralı. */
const evrakTipiVerildi = (v: unknown): boolean =>
  (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(evrakKodu(v)) && evrakKodu(v) > 0;

/** Dekont yolunun reddi — ekranda ve syncLog'da aynı metin. */
export const DEKONT_FATURA_RED_METNI =
  'Fatura evrak tipi dekont yolundan yazılamaz (cha_evrak_tip 63, ya da 0 + cha_cinsi 6) — fatura yalnız fatura ucundan kesilir.';

/**
 * `DekontKaydetV2` gövdesinin denetimi: geçerse null, geçmezse 400 nedeni. HER `evraklar[i].satirlar[j]` satırı denetlenir;
 * `evraklar` ya da bir evrakın `satirlar`'ı dizi değilse red (denetlenemeyen gövde Mikro'ya gitmez). Sıra: anahtar yazımı →
 * fatura evrakı → evrak tipi yok / ≤ 0 (`cariHareketGovdesi` ile aynı kural: hangi deftere yazılacağı tahmin edilmez).
 */
export function dekontGovdesiFaturaHatasi(payload: unknown): string | null {
  const evraklar = (payload as { evraklar?: unknown } | null)?.evraklar;
  if (!Array.isArray(evraklar)) return 'payload.evraklar dizi olmalı.';
  for (let i = 0; i < evraklar.length; i++) {
    const satirlar = (evraklar[i] as { satirlar?: unknown } | null)?.satirlar;
    if (!Array.isArray(satirlar)) return `payload.evraklar[${i}].satirlar dizi olmalı.`;
    for (let j = 0; j < satirlar.length; j++) {
      const satir = (satirlar[j] ?? {}) as Record<string, unknown>;
      const yer = `(evrak ${i + 1}, satır ${j + 1})`;
      const yazim = evrakAnahtariYazimHatasi(satir);
      if (yazim) return `${yazim} ${yer}`;
      if (faturaEvrakiMi(satir.cha_evrak_tip, satir.cha_cinsi)) return `${DEKONT_FATURA_RED_METNI} ${yer}`;
      if (!evrakTipiVerildi(satir.cha_evrak_tip)) return `cha_evrak_tip verilmeli (ör. dekont 29) — tahmin edilmez ${yer}`;
    }
  }
  return null;
}

/** Dekont penceresinin tür listesi: fatura tipleri ÇIKAR (varsayılan seçim fatura tipi olamaz); evrak tipi ≤ 0 olan tür de çıkar —
 *  iki sunucu yolu da onu reddeder (ölü seçenek kalmasın). Sıra korunur. */
export function dekontTurleri<T extends { cha_evrak_tip?: unknown; cha_cinsi?: unknown }>(turler: readonly T[]): T[] {
  return turler.filter(x => x.cha_evrak_tip != null && evrakTipiVerildi(x.cha_evrak_tip) && !faturaEvrakiMi(x.cha_evrak_tip, x.cha_cinsi));
}

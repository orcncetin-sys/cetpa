import { useEffect, useState, useMemo } from 'react';

/** Dünya ülke/şehir verisi — Satış Bölgesi ekranı için (2026-08-17,
 *  kullanıcı: "tüm dünyadaki şehirleri göm, ülke seçimi ekle").
 *
 *  Ülke KODLARI + şehir listeleri `public/geo/cities/<ISO2>.json` altında,
 *  build-time'da `scripts/gen-geo-cities.cjs` ile MIT lisanslı `all-the-cities`
 *  paketinden üretildi (paket yalnız üretim script'inde kullanıldı, runtime
 *  bundle'a HİÇ girmedi — bkz. o script'in başlık yorumu). Ülke ADLARI ayrı
 *  bir statik dosyada DEĞİL: tarayıcının yerleşik Intl.DisplayNames API'si
 *  ISO koddan TR/EN adı canlı çözer, ek veri/bağımlılık gerekmez.
 *
 *  Her ülkenin şehir listesi yalnız o ülke SEÇİLDİĞİNDE lazy-fetch edilir
 *  (236 ülke × ortalama ~10KB — hepsini baştan yüklemek gereksiz). */

let indexCache: string[] | null = null;
const cityCache = new Map<string, [string, number][]>();

async function fetchCountryIndex(): Promise<string[]> {
  if (indexCache) return indexCache;
  // Başarısız istek önbelleğe YAZILMAZ — geçici ağ hatası kalıcı boş listeye
  // dönüşüp sayfa yeniden yüklenene kadar düzelmesin (code-review bulgusu).
  try {
    const res = await fetch('/geo/cities/_index.json');
    if (!res.ok) return [];
    indexCache = await res.json();
    return indexCache;
  } catch { return []; }
}

async function fetchCities(iso2: string): Promise<[string, number][]> {
  if (cityCache.has(iso2)) return cityCache.get(iso2)!;
  try {
    const res = await fetch(`/geo/cities/${iso2}.json`);
    if (!res.ok) return [];
    const data: [string, number][] = await res.json();
    cityCache.set(iso2, data);
    return data;
  } catch { return []; }
}

/** ISO2 → görünen ad (Türkçe/İngilizce), Intl.DisplayNames ile. Desteklenmeyen
 *  tarayıcıda (çok eski) ISO kodun kendisine düşer — hata fırlatmaz. */
export function countryDisplayName(iso2: string, lang: 'tr' | 'en'): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(iso2) ?? iso2;
  } catch {
    return iso2;
  }
}

/** Ülke kodu listesi (bir kez fetch edilir, adlarına göre sıralı). */
export function useCountryList(lang: 'tr' | 'en'): Array<{ code: string; name: string }> {
  const [codes, setCodes] = useState<string[]>([]);
  useEffect(() => {
    let iptal = false;
    fetchCountryIndex().then(c => { if (!iptal) setCodes(c); });
    return () => { iptal = true; };
  }, []);
  return useMemo(
    () => codes
      .map(code => ({ code, name: countryDisplayName(code, lang) }))
      .sort((a, b) => a.name.localeCompare(b.name, lang)),
    [codes, lang],
  );
}

/** Seçili ülkenin şehirleri (nüfusa göre azalan). Ülke değişince yeniden fetch eder. */
export function useCitiesForCountry(iso2: string | null): string[] {
  const [cities, setCities] = useState<string[]>([]);
  useEffect(() => {
    if (!iso2) { setCities([]); return; }
    let iptal = false;
    fetchCities(iso2).then(rows => { if (!iptal) setCities(rows.map(r => r[0])); });
    return () => { iptal = true; };
  }, [iso2]);
  return cities;
}

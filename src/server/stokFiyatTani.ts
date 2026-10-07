/**
 * stokFiyatTani.ts — stok kartlarında SATIŞ FİYATI kapsamasının ÖLÇÜMÜ (2026-10-02). Saf; FİYAT DÖNDÜRMEZ, yalnız sayar.
 *
 * NEDEN: "Yeni Sipariş" penceresinde ürünler 0 fiyatla görünüyordu. Bunun veri eksikliği mi (kartta fiyat yok / başka kademe
 * adıyla duruyor / dövizli) yoksa okuma hatası mı olduğu ölçülmeden düzeltme kararı verilemez. Ops jetonlu uç fiyat dökmez
 * (bilerek) — bu yüzden çıktı yalnız sayım ve VAR / YOK bilgisidir.
 * "Pozitif fiyat" = sonlu ve > 0 sayı. 0 ve negatif "fiyat yok" sayılır (fiyat importu da öyle sayar — eslemeStok.fiyatEsle).
 */
const nesneMi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const pozitif = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;

export interface KartFiyatDurumu {
  perakende: boolean; herhangiKademe: boolean; tekilFiyat: boolean; fiyatli: boolean;
  paraBirimi: string; kdvBilinen: boolean; stoklu: boolean; kaynak: string; etiketli: boolean;
}

export function kartFiyatDurumu(k: Readonly<Record<string, unknown>>): KartFiyatDurumu {
  const kademeler = nesneMi(k.prices) ? k.prices : {};
  const herhangiKademe = Object.values(kademeler).some(pozitif);
  const tekilFiyat = pozitif(k.price);
  return {
    perakende: pozitif(kademeler['Retail']), herhangiKademe, tekilFiyat, fiyatli: herhangiKademe || tekilFiyat,
    paraBirimi: typeof k.priceCurrency === 'string' && k.priceCurrency !== '' ? k.priceCurrency : '(yok)',
    kdvBilinen: typeof k.vatRate === 'number' && Number.isFinite(k.vatRate),
    stoklu: pozitif(k.stockLevel),
    kaynak: typeof k.source === 'string' && k.source !== '' ? k.source : '(yok)',
    etiketli: typeof k.companyId === 'string' && k.companyId !== '',
  };
}

export interface StokFiyatOzeti {
  kart: { toplam: number; perakende: number; herhangiKademe: number; tekilFiyat: number; fiyatsiz: number; stoklu: number; stokluFiyatsiz: number; kdvBilinen: number };
  /** `prices` altında görülen kademe adları → kaç kartta var, kaçında pozitif. */
  kademeler: Record<string, { kart: number; pozitif: number }>;
  paraBirimleri: Record<string, number>;
  kaynaklar: Record<string, number>;
}

export function stokFiyatOzeti(kartlar: readonly Readonly<Record<string, unknown>>[]): StokFiyatOzeti {
  const o: StokFiyatOzeti = {
    kart: { toplam: kartlar.length, perakende: 0, herhangiKademe: 0, tekilFiyat: 0, fiyatsiz: 0, stoklu: 0, stokluFiyatsiz: 0, kdvBilinen: 0 },
    kademeler: {}, paraBirimleri: {}, kaynaklar: {},
  };
  for (const k of kartlar) {
    const d = kartFiyatDurumu(k);
    if (d.perakende) o.kart.perakende++;
    if (d.herhangiKademe) o.kart.herhangiKademe++;
    if (d.tekilFiyat) o.kart.tekilFiyat++;
    if (!d.fiyatli) o.kart.fiyatsiz++;
    if (d.stoklu) o.kart.stoklu++;
    if (d.stoklu && !d.fiyatli) o.kart.stokluFiyatsiz++;
    if (d.kdvBilinen) o.kart.kdvBilinen++;
    o.paraBirimleri[d.paraBirimi] = (o.paraBirimleri[d.paraBirimi] ?? 0) + 1;
    o.kaynaklar[d.kaynak] = (o.kaynaklar[d.kaynak] ?? 0) + 1;
    if (nesneMi(k.prices)) {
      for (const [ad, deger] of Object.entries(k.prices)) {
        const kayit = o.kademeler[ad] ?? (o.kademeler[ad] = { kart: 0, pozitif: 0 });
        kayit.kart++;
        if (pozitif(deger)) kayit.pozitif++;
      }
    }
  }
  return o;
}

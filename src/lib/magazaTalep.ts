/**
 * magazaTalep.ts — mağaza sipariş talebinin ORTAK sözleşmesi.
 *
 * Sunucu (yazar: `src/server/routes/magazaRoutes.ts`, bildirim işçisi) ile
 * ekran (okur: `src/components/siparis/MagazaTalepleri.tsx`) aynı biçimi buradan
 * okur. Yaprak modül: ne sunucuyu ne istemciyi içe aktarır.
 *
 * NEDEN AYRI KOLEKSİYON (kullanıcı kararı K1, 2026-10-08): talep `orders`'a
 * YAZILMAZ. Kimliksiz bir uçtan gelen, fiyatı / stok kartı doğrulanmamış kayıt
 * sipariş değildir; ciroya, KPI'lara, Mikro'ya giden yollara karışmamalıdır.
 *
 * TUTARLAR BEYANDIR: `talepFiyat` ve `talepEdilen.*` müşterinin sitede gördüğü
 * rakamlardır. Hiçbir yerde ERP tutarı gibi kullanılmaz; ekran bunlardan toplam
 * TÜRETMEZ. `null` = BİLİNMİYOR («fiyat sorulacak»), sıfır değil.
 */

export const MAGAZA_TALEP_KOLEKSIYONU = 'magazaTalepleri';

/** Mağaza istemcisinin ürettiği talep numarası (ör. `T261008-5Y9P`). */
export const MAGAZA_TALEP_NO_DESENI = /^T\d{6}-[A-Z0-9]{4}$/;

/**
 * Doküman kimliği: `mt-` + sha256(kiracı | talep no | telefonun son 10 hanesi)
 * özetinin ilk 32 onaltılık hanesi. TİRE: `__` bu kod tabanında kiracı öneki
 * ayracıdır (bkz. `server.ts` `<cid>__anahtar`), kimlikte kullanılmaz.
 */
export const MAGAZA_TALEP_KIMLIK_DESENI = /^mt-[0-9a-f]{32}$/;

/** «bekliyor» bu süreden eskiyse ekranda ve bekçide «bildirim gönderilmedi» sayılır. */
export const MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS = 10 * 60_000;

export type MagazaBildirimDurumu = 'bekliyor' | 'gitti' | 'gonderilemedi' | 'yapilandirilmamis';

/** KAPALI küme: dokümana, günlüğe, yanıta hata METNİ değil yalnız bu sınıf yazılır. */
export const MAGAZA_BILDIRIM_HATA_SINIFLARI = ['kimlik', 'tls', 'baglanti', 'gonderen-reddi', 'alici-reddi', 'diger'] as const;
export type MagazaBildirimHataSinifi = typeof MAGAZA_BILDIRIM_HATA_SINIFLARI[number];

export interface MagazaBildirim {
  durum: MagazaBildirimDurumu;
  /** Son durum değişikliğinin sunucu saati (UTC, ISO-8601 metin). */
  zaman: string;
  /** Kaçıncı deneme başarısız oldu (yalnız kuyruk yolunda). */
  deneme?: number;
  hataSinifi?: MagazaBildirimHataSinifi;
}

export interface MagazaTalepMusteri {
  ad: string;
  firma: string;
  telefon: string;
  eposta: string;
  il: string;
  adres: string;
  vergi: string;
}

export interface MagazaTalepKalemi {
  id: string;
  sku: string;
  ad: string;
  marka: string;
  adet: number;
  /** Müşterinin sitede gördüğü birim fiyat. `null` = fiyat sorulacak (0 DEĞİL). */
  talepFiyat: number | null;
  /** Mağazanın «tedarik edilecek» işareti. */
  tedarik: boolean;
}

export interface MagazaTalebi {
  companyId: string;
  talepNo: string;
  /** Dilim 1'de tek değer; teyit / ret durumları dilim 2'de eklenir. */
  durum: 'yeni';
  /** Sunucunun kayıt saati (UTC, ISO-8601 metin). Sıralama ve «yeni» sayacı bunu okur. */
  olusturma: string;
  /** Müşteri cihazının saati; çözülemediyse `null`. Güvenilmez — yalnız bilgi. */
  istemciTarihi: string | null;
  musteri: MagazaTalepMusteri;
  /** Telefonun son 10 rakamı (durum sorgusunun anahtarı — dilim 2). */
  telefonSon10: string;
  not: string;
  kalemler: MagazaTalepKalemi[];
  /** İstemci BEYANI; alan gönderilmediyse `null`. */
  talepEdilen: { araToplam: number | null; kdv: number | null; toplam: number | null };
  /** Sunucuda kalemlerden türetilir: herhangi bir `talepFiyat === null`. */
  fiyatiSorulacakVar: boolean;
  /** Herhangi bir metin alanı üst sınırda kırpıldıysa. */
  kirpildi?: true;
  bildirim: MagazaBildirim;
}

/**
 * vergiIsaretci.ts — KDV YÜZDESİ → Mikro vergi İŞARETÇİSİ (vergiSiraNo) TERS araması.
 * SAF: ağ, DB, express yok. Test: vergiIsaretci.test.ts (ÖNCE yazıldı).
 * (Faz 3 3/n hakem bulgusu, 2026-09-19 — üç kopya tek kaynağa indirildi.)
 *
 * YÖN ÖNEMLİ: `sto_perakende_vergi` / `sip_vergi_pntr` / `sth_vergi_pntr` bir yüzde
 * DEĞİL, VergiListesiV2'nin satır sırasıdır (sıra 1 "YOK" %0 · 2 "%1" · 3 "%10" ·
 * 4 "%20" — mikroClient.ts `mikroVergiOranlari` başlığı, 2026-07-31 canlı bulgusu).
 * Sıra numaraları FİRMA VERİTABANINA GÖRE DEĞİŞİR; bu yüzden tahmin edilemez.
 * `vergiOraniCoz` işaretçi→oran çevirir; gövde kurarken TERSİ gerekir.
 *
 * NEDEN TEK DOSYA (hakem bulgusu): aynı arama üç gövde modülünde ÜÇ FARKLI eşitlik
 * kuralıyla duruyordu —
 *   govdeStokCari        `deger === o`                 (kesin eşitlik)
 *   govdeFaturaIrsaliye  `Math.abs(deger - o) > 1e-9`
 *   govdeSiparis         `Math.abs(o - hedef) > 1e-6`
 * `mikroVergiOranlari` oranı yuvarlamadan koyuyor (`Number(v.vergiOrani)`), yani tablo
 * %20'yi 19.999999999 diye döndürürse AYNI sipariş SiparisKaydetV2'den geçerken aynı
 * malın faturası ve stok kartı "%20 oranı Mikro vergi tablosunda yok" ile 400 alırdı.
 * Bir gövdenin geçip kardeşinin düşmesi veri değil, KURAL farkıdır.
 *
 * TEYİTSİZ: canlı VergiListesiV2'nin oranları gerçekten float döndürüp döndürmediği
 * lokalde görülemez (Mac'te Mikro verisi yok). Tolerans yine de tek kaynakta durur ki
 * float gelirse üç yüzey birden aynı şekilde davransın.
 *
 * VARSAYILAN YOK: bulunamazsa `null` döner — çağıran `MikroGovdeHatasi` fırlatır,
 * "en yakın orana yuvarla" ya da eski `kdvOran >= 20 ? 4 : >= 10 ? 3 : 1` tahmini YOK.
 */
import { bilinenSayi } from '../../utils/para.js';

/**
 * Oran karşılaştırma toleransı. Kayan nokta artığını (19.9999999999 ≈ 20,
 * 0.1 + 0.2 ≈ 0.3) yutacak kadar büyük, GERÇEKTEN farklı iki KDV oranını
 * (en küçük gerçek fark: %0,01) birbirine karıştırmayacak kadar küçük.
 */
export const VERGI_ORAN_TOLERANSI = 1e-6;

/**
 * Oran → vergiSiraNo. Bulunamazsa `null`.
 *
 * Aynı oranı taşıyan birden çok sıra varsa EN KÜÇÜK sıra seçilir (Mikro'da tekrar
 * beklenmiyor ama seçim belirlenimli olsun — Map'in ekleme sırasına göre değişmesin).
 * Tablodaki çöp satırlar (Mikro'nun ilklendirilmemiş dizi hücreleri: NaN sıra,
 * 4.6e-322 oran) atlanır.
 */
export function vergiIsaretcisiCoz(oran: unknown, tablo: ReadonlyMap<number, number>): number | null {
  if (!bilinenSayi(oran)) return null;
  const hedef = Number(oran);
  // Number.isFinite — global isFinite DEĞİL (CLAUDE.md): isFinite(null) === true.
  if (!Number.isFinite(hedef)) return null;
  let bulunan: number | null = null;
  for (const [sira, deger] of tablo) {
    if (!Number.isFinite(sira) || !Number.isFinite(deger)) continue;
    if (Math.abs(deger - hedef) > VERGI_ORAN_TOLERANSI) continue;
    if (bulunan === null || sira < bulunan) bulunan = sira;
  }
  return bulunan;
}

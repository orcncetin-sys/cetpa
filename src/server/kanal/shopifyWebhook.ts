/**
 * shopifyWebhook.ts — doğrulanmış Shopify olayını `orders`'a işler ve bağlantı durumunu günceller (2026-10-02).
 *
 * İmza doğrulaması ve kiracının bulunması ROTADA (kanalRoutes `/api/shopify/webhook`) yapılır; buraya gelen olayın kiracısı
 * (`cid`) ve tuzu bellidir. Eşleme kuralları saf modülde: `shopifyEsleme.ts`. Bu dosya yalnız oku → eşle → yaz zinciridir.
 *
 * Yazım `set(…, { merge: true })`: yamada OLMAYAN alanlara (timeline, notes, stockApplied, irsaliyeNo, mikroFaturaNo, depoNo)
 * dokunulmaz. Stok düşümü / fatura / müşteri bildirimi YOKTUR (kapsam dışı — Shopify kendi bildirimini yollar).
 * İşleyici FIRLATIRSA çağıran (kuyruk işçisi) yeniden dener; fırlatmadan önce durum dokümanına `sonHata` yazılır.
 *
 * DURUM DOKÜMANI — üç kural (2026-10-07):
 *  • `toplamBildirim` SONUÇLANAN bildirimi sayar (yazıldı / atlandı / test). Hata dalında ARTMAZ: kuyruk aynı olayı sekiz kez
 *    yeniden dener, sayaç deneme sayısına dönerdi (1 bildirim 2–9 görünürdü).
 *  • `sonHata` yalnız onu ÜRETEN olay sonradan SONUÇLANINCA temizlenir. Koşulsuz temizlik YOK: denemeleri tükenen A
 *    siparişinin tek izi, ilgisiz B siparişinin başarısıyla silinirdi. İki yol:
 *      – YAZILDI: aynı sipariş dokümanına (`sonHataOlay`) başarılı yazım — topic'e bakılmaz, sonraki olay siparişin tam hâlini taşır.
 *      – ATLANDI: hatayı üreten olayın KENDİ yeniden denemesi eşlemede atlandı (bayat / kayıt yok / değişiklik yok). Olay
 *        sonuçlandı, bir daha denenmeyecek; iz kalsaydı kaybolan bir şey olmadığı hâlde kalıcı olurdu. «Kendi denemesi» OLAY
 *        KİMLİĞİYLE tanınır (`sonHataOlayNo` = `X-Shopify-Webhook-Id`; kuyruk yeniden denemesi aynı iş verisini, yani aynı
 *        kimliği taşır). Doküman + topic YETMEZ (inceleme 2026-10-08): `orders/updated` ve `fulfillments/*` aynı sipariş için
 *        defalarca gelen AYRI olaylardır — 1. kolinin takip numaralı olayı denemelerini tüketmişken 2. kolinin takipsiz olayı
 *        «değişiklik yok» diye atlanınca iz siliniyor, sipariş takip numarasız kalıyordu. Kimlik yoksa atlama yolu SİLMEZ.
 *        Aynı dokümanın başka topic'li atlaması da silmez: `orders/create` yazımı düşmüşken aynı siparişin kargo olayı «kayıt
 *        yok» diye atlanır — sipariş hâlâ yazılmamıştır.
 *  • Durum, yazıldığı BAĞLANTI SÜRÜMÜNÜ damga olarak taşır (shopifyBaglanti `baglantiSurumu`). Eldeki durum başka sürümünse
 *    eski bağlantının kalıntısıdır: sayaç / hata izi ondan DEVRALINMAZ, yazım birleştirmesizdir. `durumaDokunma` olayında
 *    (eski sürümle doğrulanmış, kuyrukta beklemiş iş) durum HİÇ yazılmaz.
 */
import type { AdminDbLike } from '../adminDbTypes.js';
import { BAGLANTI_KOLEKSIYONU, durumBuSurumunMu, durumDamgasi, durumKimligi } from './shopifyBaglanti.js';
import { kargoOlayiEsle, olayKimligi, siparisOlayiEsle, type EslemeSonucu, type ShopifyBaglam } from './shopifyEsleme.js';

export interface ShopifyOlayi {
  topic: string;
  body: unknown;
  cid: string;
  tuz: string;
  /** `X-Shopify-API-Version` başlığı (durum dokümanına; yoksa yazılmaz). */
  apiSurumu?: string;
  /** Bağlantı sürümü (kayıttan; sürümsüz eski kayıtta null) — durum dokümanına DAMGA olarak yazılır. */
  baglantiSurumu: string | null;
  /** Olayın KENDİ kimliği (`X-Shopify-Webhook-Id`); kuyruğun yeniden denemelerinde aynı kalır. Yoksa atlama yolu hata izini silmez. */
  olayNo?: string;
  /**
   * true: durum dokümanına DOKUNULMAZ (sipariş yine yazılır). Olay, o arada alan adı / sırrı değişmiş bağlantının ESKİ
   * sürümüyle doğrulandıysa işçi böyle çağırır — eski sırla doğrulanan olay yeni bağlantıyı «bildirim alındı» göstermesin.
   */
  durumaDokunma?: boolean;
}
export interface ShopifyIsleyiciBaglami {
  db: AdminDbLike;
  /** Sunucu zaman damgası (pgServerTimestamp) — `updatedAt` için. */
  zamanDamgasi: () => unknown;
  simdi: () => Date;
}
export type OlaySonucu = { sonuc: 'yazildi' | 'atlandi'; neden?: string; docId?: string; siparisNo?: string | null; olustur?: boolean };

/**
 * `say`: bildirim sayacı artsın mı (hata dalında false). `yazilanOlay` / `atlananOlay`: SONUÇLANAN olayın sipariş doküman
 * kimliği — yazıldıysa ilki, eşlemede atlandıysa ikincisi (hata dalının `sonHataOlay`'a yazdığı kimlikle AYNI anahtar).
 */
interface DurumSecenegi { say: boolean; yazilanOlay?: string; atlananOlay?: string }

async function durumYaz(C: ShopifyIsleyiciBaglami, o: ShopifyOlayi, alanlar: Record<string, unknown>, s: DurumSecenegi): Promise<void> {
  if (o.durumaDokunma) return;
  // En iyi çaba: durum yazımı hatası olayı DÜŞÜRMEZ (sipariş zaten yazıldı; Shopify'a 500 dönüp yeniden yazdırmak anlamsız).
  try {
    const ref = C.db.collection(BAGLANTI_KOLEKSIYONU).doc(durumKimligi(o.cid));
    const eldeki = (await ref.get()).data();
    // Başka sürümün durumu = eski bağlantının kalıntısı: önceki sayılmaz (sayaç 1'den başlar) ve aşağıda birleştirilmez.
    const onceki = durumBuSurumunMu(eldeki, o.baglantiSurumu) ? eldeki : undefined;
    const toplam = typeof onceki?.toplamBildirim === 'number' && Number.isFinite(onceki.toplamBildirim) ? onceki.toplamBildirim : 0;
    // Hata izini yalnız onu üreten olayın sonuçlanması siler (dosya başı). `null` AÇIKÇA yazılır: yazım birleştirmeli, alanı
    // atlamak eskiyi bırakır.
    const hataGecti = (s.yazilanOlay !== undefined && onceki?.sonHataOlay === s.yazilanOlay)
      || (s.atlananOlay !== undefined && onceki?.sonHataOlay === s.atlananOlay && onceki?.sonHataTopic === o.topic
        && typeof o.olayNo === 'string' && o.olayNo !== '' && onceki?.sonHataOlayNo === o.olayNo);
    await ref.set({
      ...durumDamgasi(o.cid, o.baglantiSurumu), sonBildirim: C.simdi().toISOString(), sonTopic: o.topic,
      ...(s.say ? { toplamBildirim: toplam + 1 } : {}),
      ...(o.apiSurumu ? { sonApiSurumu: o.apiSurumu } : {}),
      ...(hataGecti ? { sonHata: null, sonHataZamani: null, sonHataOlay: null, sonHataTopic: null, sonHataOlayNo: null } : {}),
      ...alanlar,
    }, { merge: onceki !== undefined });
  } catch (e) {
    console.warn('[shopify-webhook] durum yazılamadı:', e instanceof Error ? e.message : String(e));
  }
}

export async function shopifyOlayiIsle(C: ShopifyIsleyiciBaglami, o: ShopifyOlayi): Promise<OlaySonucu> {
  const b: ShopifyBaglam = { cid: o.cid, tuz: o.tuz };
  // `try` DIŞINDA: hata dalı, hatayı üreten olayın doküman kimliğini (`sonHataOlay`) buradan okur.
  let kimlik: ReturnType<typeof olayKimligi> | undefined;
  try {
    kimlik = olayKimligi(o.topic, o.body, b);
    if (kimlik.tur === 'atla') {
      await durumYaz(C, o, { sonSonuc: kimlik.neden === 'test' ? 'test' : 'atlandi' }, { say: true });
      return { sonuc: 'atlandi', neden: kimlik.neden };
    }
    const ref = C.db.collection('orders').doc(kimlik.docId);
    const snap = await ref.get();
    const mevcut = snap.exists ? snap.data() : undefined;
    // Kimlik kiracıya + tuza bağlı olduğundan başka kiracının dokümanına denk gelmesi beklenmez; yine de etiket tutmuyorsa YAZMA.
    if (mevcut && typeof mevcut.companyId === 'string' && mevcut.companyId !== '' && mevcut.companyId !== o.cid) {
      throw new Error('sipariş dokümanı başka kiracıya ait');
    }
    const esleme: EslemeSonucu = kimlik.tur === 'siparis'
      ? siparisOlayiEsle(o.body, mevcut, b, C.simdi().toISOString())
      : kargoOlayiEsle(o.body, mevcut, b);
    if (esleme.tur === 'atla') {
      // Olay SONUÇLANDI (bir daha denenmeyecek): hata izini üreten bu olaysa iz temizlenir — kimlik hata dalındakiyle aynı.
      await durumYaz(C, o, { sonSonuc: esleme.neden === 'test' ? 'test' : 'atlandi' }, { say: true, atlananOlay: kimlik.docId });
      return { sonuc: 'atlandi', neden: esleme.neden };
    }
    await ref.set({ ...esleme.yama, updatedAt: C.zamanDamgasi() }, { merge: true });
    await durumYaz(C, o, { sonSonuc: esleme.olustur ? 'olusturuldu' : 'guncellendi', ...(esleme.siparisNo ? { sonSiparisNo: esleme.siparisNo } : {}) },
      { say: true, yazilanOlay: esleme.docId });
    return { sonuc: 'yazildi', docId: esleme.docId, siparisNo: esleme.siparisNo, olustur: esleme.olustur };
  } catch (e) {
    // Hata metni gövde / sır taşımaz (kendi fırlattıklarımız ve veritabanı hatası); yine de kısaltılır.
    await durumYaz(C, o, {
      sonSonuc: 'hata', sonHata: (e instanceof Error ? e.message : String(e)).slice(0, 300), sonHataZamani: C.simdi().toISOString(),
      sonHataOlay: kimlik && kimlik.tur !== 'atla' ? kimlik.docId : null,
      sonHataTopic: kimlik && kimlik.tur !== 'atla' ? o.topic : null,
      sonHataOlayNo: kimlik && kimlik.tur !== 'atla' && typeof o.olayNo === 'string' && o.olayNo !== '' ? o.olayNo : null,
    }, { say: false });
    throw e;
  }
}

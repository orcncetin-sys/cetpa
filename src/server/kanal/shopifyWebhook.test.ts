import { describe, it, expect, vi } from 'vitest';
import type { AdminDbLike } from '../adminDbTypes';
import { shopifyOlayiIsle, type ShopifyIsleyiciBaglami } from './shopifyWebhook';
import { shopifySiparisKimligi } from './shopifyEsleme';

/**
 * Bellek içi doküman deposu: `set(merge)` üst düzeyde birleştirir (pgShim ile aynı anlam).
 * `patlat`: anahtar → o dokümana yapılacak sıradaki KAÇ yazımın fırlatacağı (geçici veritabanı hatası; sonraki deneme geçer).
 * `okumaPatlat`: aynısı OKUMA için (yazım hiç denenmeden düşen olay — yeniden denemesi eşlemede atlanabilir).
 */
function sahteDb(baslangic: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(baslangic));
  const yazimlar: string[] = [];
  const patlat = new Map<string, number>();
  const okumaPatlat = new Map<string, number>();
  const db = {
    collection: (coll: string) => ({
      doc: (id: string) => ({
        id,
        get: async () => {
          const kalan = okumaPatlat.get(`${coll}/${id}`);
          if (kalan !== undefined && kalan > 0) { okumaPatlat.set(`${coll}/${id}`, kalan - 1); throw new Error('connection terminated unexpectedly'); }
          return { exists: docs.has(`${coll}/${id}`), id, data: () => docs.get(`${coll}/${id}`) };
        },
        set: async (veri: Record<string, unknown>, opts?: { merge?: boolean }) => {
          const kalan = patlat.get(`${coll}/${id}`);
          if (kalan !== undefined && kalan > 0) { patlat.set(`${coll}/${id}`, kalan - 1); throw new Error('could not serialize access'); }
          yazimlar.push(`${coll}/${id}`);
          docs.set(`${coll}/${id}`, opts?.merge ? { ...(docs.get(`${coll}/${id}`) ?? {}), ...veri } : veri);
        },
      }),
    }),
  } as unknown as AdminDbLike;
  return { db, docs, yazimlar, patlat, okumaPatlat };
}
const SIMDI = new Date('2026-10-02T12:00:00.000Z');
const baglam = (db: AdminDbLike): ShopifyIsleyiciBaglami => ({ db, zamanDamgasi: () => 'ZAMAN', simdi: () => SIMDI });
const A = { cid: 'kiraciA', tuz: 'tuz-a', baglantiSurumu: 'surum-a' };
const govde = (ek: Record<string, unknown> = {}) => ({
  id: 9001, name: '#1001', created_at: '2026-10-02T10:00:00+03:00', updated_at: '2026-10-02T10:00:00+03:00',
  currency: 'TRY', total_price: '120.00', taxes_included: true, financial_status: 'pending',
  billing_address: { name: 'Şirin Yapı' }, line_items: [], ...ek,
});
const kimlik = shopifySiparisKimligi(A, '9001');

describe('shopifyOlayiIsle', () => {
  it('oluşturur: deterministik kimlik, kiracı damgası, durum dokümanı', async () => {
    const { db, docs } = sahteDb();
    const r = await shopifyOlayiIsle(baglam(db), { ...A, topic: 'orders/create', body: govde(), apiSurumu: '2026-07' });
    expect(r).toEqual({ sonuc: 'yazildi', docId: kimlik, siparisNo: '#1001', olustur: true });
    expect(docs.get(`orders/${kimlik}`)).toMatchObject({ companyId: 'kiraciA', source: 'shopify_webhook', customerName: 'Şirin Yapı', totalPrice: 120, status: 'Pending', updatedAt: 'ZAMAN' });
    expect(docs.get('shopifyBaglantilari/kiraciA__durum')).toMatchObject({
      companyId: 'kiraciA', sonTopic: 'orders/create', sonSonuc: 'olusturuldu', sonSiparisNo: '#1001', sonApiSurumu: '2026-07',
      toplamBildirim: 1, sonBildirim: '2026-10-02T12:00:00.000Z',
    });
  });
  it('yeniden teslim AYNI dokümana yazar; güncelleme önce gelirse de kayıt kurulur (upsert)', async () => {
    const { db, docs } = sahteDb();
    await shopifyOlayiIsle(baglam(db), { ...A, topic: 'orders/updated', body: govde() });
    await shopifyOlayiIsle(baglam(db), { ...A, topic: 'orders/create', body: govde() });
    expect([...docs.keys()].filter(k => k.startsWith('orders/'))).toEqual([`orders/${kimlik}`]);
    expect(docs.get('shopifyBaglantilari/kiraciA__durum')).toMatchObject({ toplamBildirim: 2, sonSonuc: 'guncellendi' });
  });
  it('kullanıcının Cetpa\'da yazdığı alanlara (not, irsaliye, depo) ve ileri duruma dokunmaz', async () => {
    const { db, docs } = sahteDb({ [`orders/${kimlik}`]: { companyId: 'kiraciA', status: 'Delivered', notes: 'elle not', irsaliyeNo: 'IRS-1', depoNo: 2, paid: true } });
    await shopifyOlayiIsle(baglam(db), { ...A, topic: 'orders/updated', body: govde({ updated_at: '2026-10-02T11:00:00+03:00' }) });
    expect(docs.get(`orders/${kimlik}`)).toMatchObject({ status: 'Delivered', notes: 'elle not', irsaliyeNo: 'IRS-1', depoNo: 2, paid: true, totalPrice: 120 });
  });
  it('kiracı izolasyonu: aynı Shopify kimliği başka kiracıda BAŞKA dokümana yazılır', async () => {
    const { db, docs } = sahteDb();
    await shopifyOlayiIsle(baglam(db), { ...A, topic: 'orders/create', body: govde() });
    await shopifyOlayiIsle(baglam(db), { cid: 'kiraciB', tuz: 'tuz-b', baglantiSurumu: 'surum-b', topic: 'orders/create', body: govde() });
    const siparisler = [...docs.entries()].filter(([k]) => k.startsWith('orders/'));
    expect(siparisler).toHaveLength(2);
    expect(siparisler.map(([, v]) => v.companyId).sort()).toEqual(['kiraciA', 'kiraciB']);
  });
  it('doküman başka kiracıya etiketliyse YAZMAZ, fırlatır ve hatayı durum dokümanına yazar', async () => {
    const { db, docs } = sahteDb({ [`orders/${kimlik}`]: { companyId: 'kiraciB', status: 'Pending' } });
    await expect(shopifyOlayiIsle(baglam(db), { ...A, topic: 'orders/create', body: govde() })).rejects.toThrow(/başka kiracı/);
    expect(docs.get(`orders/${kimlik}`)).toEqual({ companyId: 'kiraciB', status: 'Pending' });
    expect(docs.get('shopifyBaglantilari/kiraciA__durum')).toMatchObject({ sonSonuc: 'hata', sonHataZamani: '2026-10-02T12:00:00.000Z' });
  });
  it('test bildirimi, bilinmeyen topic ve kimliksiz gövde siparişe YAZILMAZ; durum güncellenir', async () => {
    const { db, docs, yazimlar } = sahteDb();
    expect(await shopifyOlayiIsle(baglam(db), { ...A, topic: 'orders/create', body: govde({ test: true }) })).toEqual({ sonuc: 'atlandi', neden: 'test' });
    expect(docs.get('shopifyBaglantilari/kiraciA__durum')).toMatchObject({ sonSonuc: 'test' });
    expect(await shopifyOlayiIsle(baglam(db), { ...A, topic: 'refunds/create', body: govde() })).toEqual({ sonuc: 'atlandi', neden: 'topic' });
    expect(await shopifyOlayiIsle(baglam(db), { ...A, topic: 'orders/create', body: { id: 'x' } })).toEqual({ sonuc: 'atlandi', neden: 'kimliksiz' });
    expect(yazimlar.some(y => y.startsWith('orders/'))).toBe(false);
    expect(docs.get('shopifyBaglantilari/kiraciA__durum')).toMatchObject({ sonSonuc: 'atlandi', toplamBildirim: 3 });
  });
  it('kargo olayı: sipariş varsa yalnız takip numarası; sipariş yoksa atlar', async () => {
    const { db, docs } = sahteDb();
    const kargo = { order_id: 9001, status: 'success', tracking_number: 'TR1', tracking_company: 'Aras' };
    expect(await shopifyOlayiIsle(baglam(db), { ...A, topic: 'fulfillments/create', body: kargo })).toEqual({ sonuc: 'atlandi', neden: 'kayitYok' });
    await shopifyOlayiIsle(baglam(db), { ...A, topic: 'orders/create', body: govde() });
    await shopifyOlayiIsle(baglam(db), { ...A, topic: 'fulfillments/create', body: kargo });
    expect(docs.get(`orders/${kimlik}`)).toMatchObject({ trackingNumber: 'TR1', cargoCompany: 'Aras', status: 'Pending' });
  });
  describe('durum dokümanı: sayaç ve son hata (2026-10-07)', () => {
    const DURUM = 'shopifyBaglantilari/kiraciA__durum';
    const olay = (ek: Record<string, unknown> = {}, topic = 'orders/create') => ({ ...A, topic, body: govde(ek) });

    it('hata dalı sayacı ARTIRMAZ: yeniden denemeyle geçen 1 bildirim 1 sayılır (2 değil)', async () => {
      const { db, docs, patlat } = sahteDb();
      patlat.set(`orders/${kimlik}`, 2);
      await expect(shopifyOlayiIsle(baglam(db), olay())).rejects.toThrow(/serialize/);
      await expect(shopifyOlayiIsle(baglam(db), olay())).rejects.toThrow(/serialize/);
      // İki başarısız deneme: hata yazıldı, sayaç HİÇ yazılmadı (0 da değil — alan yok).
      expect(docs.get(DURUM)).toMatchObject({ sonSonuc: 'hata', sonHata: 'could not serialize access', sonHataOlay: kimlik });
      expect(docs.get(DURUM)).not.toHaveProperty('toplamBildirim');
      await shopifyOlayiIsle(baglam(db), olay());
      expect(docs.get(DURUM)).toMatchObject({ toplamBildirim: 1, sonSonuc: 'olusturuldu' });
    });
    it('hata → AYNI olayın başarısı: `sonHata` / `sonHataZamani` / `sonHataOlay` açıkça null yazılır', async () => {
      const { db, docs, patlat } = sahteDb();
      patlat.set(`orders/${kimlik}`, 1);
      await expect(shopifyOlayiIsle(baglam(db), olay())).rejects.toThrow();
      expect(docs.get(DURUM)).toMatchObject({ sonHata: 'could not serialize access', sonHataZamani: '2026-10-02T12:00:00.000Z', sonHataOlay: kimlik, sonHataTopic: 'orders/create' });
      await shopifyOlayiIsle(baglam(db), olay());
      const d = docs.get(DURUM);
      expect(d).toMatchObject({ sonHata: null, sonHataZamani: null, sonHataOlay: null, sonHataTopic: null, sonSonuc: 'olusturuldu', toplamBildirim: 1 });
    });
    it('hata → AYNI olayın yeniden denemesi BAYAT diye atlandı: olay sonuçlandı, hata izi temizlenir', async () => {
      const { db, docs, okumaPatlat } = sahteDb();
      // Yeni olay (T2) önce işlendi; eski olay (T1, Shopify sırayı garanti etmez) ilk denemesinde OKUMADA düştü.
      await shopifyOlayiIsle(baglam(db), olay({ updated_at: '2026-10-02T11:00:00+03:00' }, 'orders/updated'));
      okumaPatlat.set(`orders/${kimlik}`, 1);
      await expect(shopifyOlayiIsle(baglam(db), { ...olay({}, 'orders/paid'), olayNo: 'wh-1' })).rejects.toThrow(/connection terminated/);
      expect(docs.get(DURUM)).toMatchObject({ sonSonuc: 'hata', sonHata: 'connection terminated unexpectedly', sonHataOlay: kimlik, sonHataTopic: 'orders/paid', sonHataOlayNo: 'wh-1', toplamBildirim: 1 });
      // Kuyruğun yeniden denemesi (AYNI olay kimliği): okuma geçer, kayıt daha yeni → atlanır. Bu olay bir daha gelmeyecek.
      expect(await shopifyOlayiIsle(baglam(db), { ...olay({}, 'orders/paid'), olayNo: 'wh-1' })).toEqual({ sonuc: 'atlandi', neden: 'bayat' });
      expect(docs.get(DURUM)).toMatchObject({ sonSonuc: 'atlandi', sonHata: null, sonHataZamani: null, sonHataOlay: null, sonHataTopic: null, sonHataOlayNo: null, toplamBildirim: 2 });
    });
    it('hata → takip numarasız KARGO olayının yeniden denemesi atlandı (değişiklik yok): hata izi temizlenir', async () => {
      const { db, docs, okumaPatlat } = sahteDb();
      await shopifyOlayiIsle(baglam(db), olay());
      const kargo = { ...A, topic: 'fulfillments/update', body: { order_id: 9001, status: 'success' }, olayNo: 'wh-kargo-1' };
      okumaPatlat.set(`orders/${kimlik}`, 1);
      await expect(shopifyOlayiIsle(baglam(db), kargo)).rejects.toThrow(/connection terminated/);
      expect(docs.get(DURUM)).toMatchObject({ sonHata: 'connection terminated unexpectedly', sonHataOlay: kimlik, sonHataTopic: 'fulfillments/update', sonHataOlayNo: 'wh-kargo-1' });
      expect(await shopifyOlayiIsle(baglam(db), kargo)).toEqual({ sonuc: 'atlandi', neden: 'degisiklikYok' });
      expect(docs.get(DURUM)).toMatchObject({ sonSonuc: 'atlandi', sonHata: null, sonHataZamani: null, sonHataOlay: null, sonHataTopic: null });
    });
    it('hata → BAŞKA olayın atlanması hatayı SİLMEZ: başka siparişin aynı topic\'li atlaması da, aynı siparişin başka topic\'li atlaması da', async () => {
      const ikinci = shopifySiparisKimligi(A, '9002');
      const { db, docs, okumaPatlat } = sahteDb();
      // İki sipariş de kayıtlı (T2). #1001'in eski `orders/paid` olayı okumada düştü → iz #1001 + orders/paid.
      await shopifyOlayiIsle(baglam(db), olay({ updated_at: '2026-10-02T11:00:00+03:00' }, 'orders/updated'));
      await shopifyOlayiIsle(baglam(db), olay({ id: 9002, name: '#1002', updated_at: '2026-10-02T11:00:00+03:00' }, 'orders/updated'));
      okumaPatlat.set(`orders/${kimlik}`, 1);
      await expect(shopifyOlayiIsle(baglam(db), { ...olay({}, 'orders/paid'), olayNo: 'wh-paid-1' })).rejects.toThrow();
      const iz = { sonHata: 'connection terminated unexpectedly', sonHataZamani: '2026-10-02T12:00:00.000Z', sonHataOlay: kimlik, sonHataTopic: 'orders/paid', sonHataOlayNo: 'wh-paid-1' };
      // (1) BAŞKA siparişin AYNI topic'li bayat olayı: doküman kimliği tutmaz.
      expect(await shopifyOlayiIsle(baglam(db), olay({ id: 9002, name: '#1002' }, 'orders/paid'))).toEqual({ sonuc: 'atlandi', neden: 'bayat' });
      expect(docs.get(DURUM)).toMatchObject({ ...iz, sonSonuc: 'atlandi' });
      expect(docs.get(`orders/${ikinci}`)).toBeDefined();
      // (2) AYNI siparişin BAŞKA topic'li atlamaları (bayat sipariş olayı, takip numarasız kargo): topic tutmaz.
      expect(await shopifyOlayiIsle(baglam(db), olay({}, 'orders/cancelled'))).toEqual({ sonuc: 'atlandi', neden: 'bayat' });
      expect(await shopifyOlayiIsle(baglam(db), { ...A, topic: 'fulfillments/update', body: { order_id: 9001, status: 'success' } })).toEqual({ sonuc: 'atlandi', neden: 'degisiklikYok' });
      expect(docs.get(DURUM)).toMatchObject(iz);
      // (3) AYNI sipariş + AYNI topic ama BAŞKA olay (başka kimlik) ya da kimliksiz olay: yine silmez — doküman + topic olayı tanımlamaz.
      expect(await shopifyOlayiIsle(baglam(db), { ...olay({}, 'orders/paid'), olayNo: 'wh-paid-2' })).toEqual({ sonuc: 'atlandi', neden: 'bayat' });
      expect(await shopifyOlayiIsle(baglam(db), olay({}, 'orders/paid'))).toEqual({ sonuc: 'atlandi', neden: 'bayat' });
      expect(docs.get(DURUM)).toMatchObject(iz);
      // Hatayı üreten olayın KENDİ yeniden denemesi (aynı kimlik) atlanınca temizlenir.
      expect(await shopifyOlayiIsle(baglam(db), { ...olay({}, 'orders/paid'), olayNo: 'wh-paid-1' })).toEqual({ sonuc: 'atlandi', neden: 'bayat' });
      expect(docs.get(DURUM)).toMatchObject({ sonHata: null, sonHataZamani: null, sonHataOlay: null, sonHataTopic: null, sonHataOlayNo: null });
    });
    // İnceleme 2026-10-08: çok kolili siparişte 1. kolinin takip numaralı olayı denemelerini tüketti; 2. kolinin TAKİPSİZ olayı
    // aynı sipariş + aynı topic ile «değişiklik yok» diye atlanınca iz siliniyor, sipariş takip numarasız kalıyordu.
    it('çok kolili sipariş: 1. kolinin düşen kargo olayının izi, 2. kolinin (BAŞKA olay) atlanmasıyla SİLİNMEZ', async () => {
      const { db, docs, patlat } = sahteDb();
      await shopifyOlayiIsle(baglam(db), olay());
      const koli1 = { ...A, topic: 'fulfillments/create', body: { id: 1, order_id: 9001, status: 'success', tracking_number: 'TR123', tracking_company: 'Aras' }, olayNo: 'wh-koli-1' };
      patlat.set(`orders/${kimlik}`, 1);
      await expect(shopifyOlayiIsle(baglam(db), koli1)).rejects.toThrow(/serialize/);
      const iz = { sonHata: 'could not serialize access', sonHataOlay: kimlik, sonHataTopic: 'fulfillments/create', sonHataOlayNo: 'wh-koli-1' };
      expect(docs.get(DURUM)).toMatchObject(iz);
      const koli2 = { ...A, topic: 'fulfillments/create', body: { id: 2, order_id: 9001, status: 'success' }, olayNo: 'wh-koli-2' };
      expect(await shopifyOlayiIsle(baglam(db), koli2)).toEqual({ sonuc: 'atlandi', neden: 'degisiklikYok' });
      expect(docs.get(DURUM)).toMatchObject({ ...iz, sonSonuc: 'atlandi' });
      expect(docs.get(`orders/${kimlik}`)).not.toHaveProperty('trackingNumber');      // sipariş hâlâ takipsiz — iz bu yüzden durmalı
      // 1. kolinin kendi yeniden denemesi başarıyla yazınca iz temizlenir (yazıldı yolu olay kimliğine bakmaz).
      await shopifyOlayiIsle(baglam(db), koli1);
      expect(docs.get(DURUM)).toMatchObject({ sonHata: null, sonHataOlay: null, sonHataOlayNo: null });
    });
    it('olay kimliği YOKSA (başlık gelmedi) hata izine kimlik yazılmaz ve atlama yolu izi SİLMEZ; yazıldı yolu yine siler', async () => {
      const { db, docs, okumaPatlat } = sahteDb();
      await shopifyOlayiIsle(baglam(db), olay({ updated_at: '2026-10-02T11:00:00+03:00' }, 'orders/updated'));
      okumaPatlat.set(`orders/${kimlik}`, 1);
      await expect(shopifyOlayiIsle(baglam(db), olay({}, 'orders/paid'))).rejects.toThrow();
      expect(docs.get(DURUM)).toMatchObject({ sonHataOlay: kimlik, sonHataTopic: 'orders/paid', sonHataOlayNo: null });
      expect(await shopifyOlayiIsle(baglam(db), olay({}, 'orders/paid'))).toEqual({ sonuc: 'atlandi', neden: 'bayat' });
      expect(docs.get(DURUM)).toMatchObject({ sonHata: 'connection terminated unexpectedly', sonHataOlay: kimlik });
      await shopifyOlayiIsle(baglam(db), olay({ updated_at: '2026-10-02T12:00:00+03:00' }, 'orders/updated'));
      expect(docs.get(DURUM)).toMatchObject({ sonHata: null, sonHataOlay: null, sonHataOlayNo: null, sonSonuc: 'guncellendi' });
    });
    it('kimlik ALANI hiç olmayan hata izi (bu alandan önce yazılmış durum) kimliksiz atlamayla da silinmez — tanımsız = tanımsız eşleşmesi yok', async () => {
      const { db, docs } = sahteDb({
        [`orders/${kimlik}`]: { companyId: 'kiraciA', shopifyUpdatedAt: '2026-10-02T11:00:00+03:00', status: 'Pending' },
        [DURUM]: { companyId: 'kiraciA', baglantiSurumu: 'surum-a', sonHata: 'eski hata', sonHataOlay: kimlik, sonHataTopic: 'fulfillments/update', toplamBildirim: 3 },
      });
      expect(await shopifyOlayiIsle(baglam(db), { ...A, topic: 'fulfillments/update', body: { order_id: 9001, status: 'success' } })).toEqual({ sonuc: 'atlandi', neden: 'degisiklikYok' });
      expect(docs.get(DURUM)).toMatchObject({ sonHata: 'eski hata', sonHataOlay: kimlik, sonHataTopic: 'fulfillments/update', toplamBildirim: 4 });
    });
    it('hata → BAŞKA siparişin başarısı: hata DURUR (kaybolan siparişin tek izi silinmez); o sipariş sonra işlenince temizlenir', async () => {
      const { db, docs, patlat } = sahteDb();
      patlat.set(`orders/${kimlik}`, 1);
      await expect(shopifyOlayiIsle(baglam(db), olay())).rejects.toThrow();
      await shopifyOlayiIsle(baglam(db), olay({ id: 9002, name: '#1002' }));
      expect(docs.get(DURUM)).toMatchObject({
        sonSonuc: 'olusturuldu', sonSiparisNo: '#1002', toplamBildirim: 1,
        sonHata: 'could not serialize access', sonHataZamani: '2026-10-02T12:00:00.000Z', sonHataOlay: kimlik,
      });
      // Atlanan olay (test bildirimi) da hatayı silmez.
      await shopifyOlayiIsle(baglam(db), olay({ test: true }));
      expect(docs.get(DURUM)).toMatchObject({ sonSonuc: 'test', toplamBildirim: 2, sonHata: 'could not serialize access' });
      // Aynı siparişin KARGO olayı da aynı dokümana yazar; ama kayıt yokken atlanır → hata yine durur.
      const kargo = { order_id: 9001, status: 'success', tracking_number: 'TR1' };
      expect(await shopifyOlayiIsle(baglam(db), { ...A, topic: 'fulfillments/create', body: kargo })).toEqual({ sonuc: 'atlandi', neden: 'kayitYok' });
      expect(docs.get(DURUM)).toMatchObject({ sonHata: 'could not serialize access', sonHataOlay: kimlik });
      await shopifyOlayiIsle(baglam(db), olay({}, 'orders/updated'));
      expect(docs.get(DURUM)).toMatchObject({ sonHata: null, sonHataZamani: null, sonHataOlay: null, toplamBildirim: 4 });
    });
    it('yeni hata öncekinin yerine geçer; `sonHataOlay` gösterilen hatanın olayıdır', async () => {
      const ikinci = shopifySiparisKimligi(A, '9002');
      const { db, docs, patlat } = sahteDb();
      patlat.set(`orders/${kimlik}`, 1); patlat.set(`orders/${ikinci}`, 1);
      await expect(shopifyOlayiIsle(baglam(db), olay())).rejects.toThrow();
      await expect(shopifyOlayiIsle(baglam(db), olay({ id: 9002, name: '#1002' }))).rejects.toThrow();
      expect(docs.get(DURUM)).toMatchObject({ sonHataOlay: ikinci });
      // İlk siparişin başarısı ikinci siparişin hatasını SİLMEZ.
      await shopifyOlayiIsle(baglam(db), olay());
      expect(docs.get(DURUM)).toMatchObject({ sonHata: 'could not serialize access', sonHataOlay: ikinci, toplamBildirim: 1 });
    });
    it('başarılı bildirim `sonImzaReddi`ne DOKUNMAZ (kart ret zamanını son bildirimle karşılaştırır)', async () => {
      const { db, docs } = sahteDb({ [DURUM]: { companyId: 'kiraciA', baglantiSurumu: 'surum-a', sonImzaReddi: '2026-10-02T11:00:00.000Z' } });
      await shopifyOlayiIsle(baglam(db), olay());
      expect(docs.get(DURUM)).toMatchObject({ sonImzaReddi: '2026-10-02T11:00:00.000Z', sonBildirim: '2026-10-02T12:00:00.000Z', toplamBildirim: 1 });
    });
  });
  describe('durum dokümanı bağlantı SÜRÜMÜNE bağlı (2026-10-07)', () => {
    const DURUM = 'shopifyBaglantilari/kiraciA__durum';
    const olay = (ek: Record<string, unknown> = {}) => ({ ...A, topic: 'orders/create', body: govde(ek) });
    const ESKI = { companyId: 'kiraciA', baglantiSurumu: 'surum-eski', sonBildirim: '2026-10-01T10:00:00.000Z', sonSiparisNo: '#0999', toplamBildirim: 7, sonImzaReddi: '2026-09-30T10:00:00.000Z', sonHata: 'eski hata', sonHataOlay: kimlik };

    it('yazılan durum sürüm damgası taşır; aynı sürümün durumuyla BİRLEŞİR (sayaç sürer)', async () => {
      const { db, docs } = sahteDb({ [DURUM]: { companyId: 'kiraciA', baglantiSurumu: 'surum-a', toplamBildirim: 4, sonImzaReddi: '2026-10-02T11:00:00.000Z' } });
      await shopifyOlayiIsle(baglam(db), olay());
      expect(docs.get(DURUM)).toMatchObject({ baglantiSurumu: 'surum-a', toplamBildirim: 5, sonImzaReddi: '2026-10-02T11:00:00.000Z' });
    });
    it('BAŞKA sürümün durumu (silinememiş kalıntı) devralınmaz: sayaç 1\'den başlar, eski alanlar gider, eski hata izi «temizlendi» sayılmaz', async () => {
      const { db, docs } = sahteDb({ [DURUM]: ESKI });
      await shopifyOlayiIsle(baglam(db), olay());
      // Birleştirmesiz yazım: eski bağlantının `sonImzaReddi` / `sonHata` / sayacı yeni bağlantının durumuna KARIŞMAZ.
      expect(docs.get(DURUM)).toEqual({
        companyId: 'kiraciA', baglantiSurumu: 'surum-a', sonBildirim: '2026-10-02T12:00:00.000Z', sonTopic: 'orders/create',
        toplamBildirim: 1, sonSonuc: 'olusturuldu', sonSiparisNo: '#1001',
      });
    });
    it('damgasız durum da sürümlü bağlantı için kalıntıdır; sürümsüz (eski) kayıt yalnız damgasız durumla birleşir', async () => {
      const damgasiz = { companyId: 'kiraciA', toplamBildirim: 7, sonImzaReddi: '2026-09-30T10:00:00.000Z' };
      const surumlu = sahteDb({ [DURUM]: damgasiz });
      await shopifyOlayiIsle(baglam(surumlu.db), olay());
      expect(surumlu.docs.get(DURUM)).toMatchObject({ baglantiSurumu: 'surum-a', toplamBildirim: 1 });
      expect(surumlu.docs.get(DURUM)).not.toHaveProperty('sonImzaReddi');
      // Sürümsüz kayıt: damga YAZILMAZ (null da değil), damgasız durum sürer; sürümlü kalıntı ise devralınmaz.
      const surumsuz = sahteDb({ [DURUM]: damgasiz });
      await shopifyOlayiIsle(baglam(surumsuz.db), { ...olay(), baglantiSurumu: null });
      expect(surumsuz.docs.get(DURUM)).toMatchObject({ toplamBildirim: 8, sonImzaReddi: '2026-09-30T10:00:00.000Z' });
      expect(surumsuz.docs.get(DURUM)).not.toHaveProperty('baglantiSurumu');
      const kalinti = sahteDb({ [DURUM]: ESKI });
      await shopifyOlayiIsle(baglam(kalinti.db), { ...olay(), baglantiSurumu: null });
      expect(kalinti.docs.get(DURUM)).toMatchObject({ toplamBildirim: 1 });
      expect(kalinti.docs.get(DURUM)).not.toHaveProperty('baglantiSurumu');
    });
    it('`durumaDokunma`: sipariş YAZILIR, durum dokümanı hiç değişmez — başarıda da hatada da', async () => {
      const guncel = { companyId: 'kiraciA', baglantiSurumu: 'surum-a', sonImzaReddi: '2026-10-02T11:30:00.000Z' };
      const { db, docs, yazimlar, patlat } = sahteDb({ [DURUM]: guncel });
      const eskiIs = { ...olay(), durumaDokunma: true };
      expect(await shopifyOlayiIsle(baglam(db), eskiIs)).toMatchObject({ sonuc: 'yazildi', docId: kimlik });
      expect(docs.get(`orders/${kimlik}`)).toMatchObject({ companyId: 'kiraciA', customerName: 'Şirin Yapı' });
      expect(await shopifyOlayiIsle(baglam(db), { ...eskiIs, body: govde({ test: true }) })).toEqual({ sonuc: 'atlandi', neden: 'test' });
      patlat.set(`orders/${kimlik}`, 1);
      await expect(shopifyOlayiIsle(baglam(db), eskiIs)).rejects.toThrow(/serialize/);
      expect(docs.get(DURUM)).toEqual(guncel);
      expect(yazimlar.filter(y => y.startsWith('shopifyBaglantilari/'))).toEqual([]);
    });
  });
  it('durum yazımı başarısız olsa da sipariş yazılır (olay düşmez)', async () => {
    const { db, docs } = sahteDb();
    const asil = db.collection.bind(db);
    const kirik = { ...db, collection: (c: string) => (c === 'shopifyBaglantilari' ? { doc: () => ({ get: async () => { throw new Error('pg yok'); } }) } : asil(c)) } as unknown as AdminDbLike;
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await shopifyOlayiIsle(baglam(kirik), { ...A, topic: 'orders/create', body: govde() })).sonuc).toBe('yazildi');
    expect(docs.has(`orders/${kimlik}`)).toBe(true);
    uyari.mockRestore();
  });
});

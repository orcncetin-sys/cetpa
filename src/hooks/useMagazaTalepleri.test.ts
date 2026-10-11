/**
 * useMagazaTalepleri.test.ts — mağaza taleplerinin istemci aboneliği, savunmacı daraltma ve «yeni» sayacı (dilim 1, 2026-10-08).
 *
 * KİLİTLENEN DEĞİŞMEZLER (şartname § 4 / § 5):
 *   1. `enabled` (= yetki) yanlışken `onSnapshot` HİÇ çağrılmaz — yetkisiz abonelikte sunucu ne hata ne boş init gönderir.
 *   2. Akıştan gelen doküman güvenilmezdir: bilinmeyen SAYI 0 olmaz (`null` / NaN), hiçbir kayıt atılmaz.
 *   3. «Yeni» sayacının sakladığı değer `Date.now()` DEĞİL, görülen taleplerin en büyük `olusturma`'sıdır; sekme AÇIKKEN gelen
 *      talep görülmüş sayılır; `olusturma`'sı çözülemeyen talep sayılmaz; depolama kapalıyken de çalışır.
 *   4. Adresle açılış (`?kaynak=magaza`) yalnız yetkili rolde sekmeyi açar.
 *   5. İlk görüntü süre sınırı: sunucu listeyi HİÇ göndermezse (istemcideki rol sunucudakiyle uyuşmuyor) ekran sonsuza dek
 *      «Yükleniyor…» demez — süre dolunca hata; geç gelen görüntü hatayı siler; yetki düşünce / kapanışta zamanlayıcı kalmaz.
 *   6. DİLİM 2a (şartname v6 § 5.1 / § 7 «İstemci», 2026-10-10): `durum` dokümandan okunur ve kapalı kümeden geçer — bilinmeyen /
 *      eksik değer `'yeni'`ye ÇEVRİLMEZ, `null` olur; `durumSurum` sayı değilse 0; `kalemTeslim` giriş giriş daraltılır (uymayan
 *      GİRİŞ düşer, nesnenin tamamı değil); `etiketBasildi` bozuksa `null`; beyan kalemine `teslim` / `anahtar` YAZILMAZ.
 *      Kanca ağ isteği ATMAZ (yazma `services/magazaTalepIstemcisi.ts`'te).
 *   7. DİLİM 2b (şartname v6 § 10.4 / § 10.8 «İstemci», 2026-10-11): `teyit` kalem kalem okunur ve TEK bozuk kalem (anahtarı desene
 *      uymayan, KDV oranı küme dışı, oran kaynağı tanınmayan) teyidi bütünüyle `null` yapar; `icerikSurum` sayı değilse 0;
 *      `silindi` NESNE ise silinmiş (alanları bozuk olsa da), `null` / yok ise canlı; `elle` nesne ya da `null`; `bildirimRevize`
 *      ilk bildirimle AYNI dört durumlu sözlükten ve `alanlar` `alanlariBirlestir` ile; `gerekmiyor` diye durum yok. Sekme
 *      rozetinin iki sayısı YALNIZ canlı talepleri sayar.
 *
 * BİLEREK DEĞİŞEN dilim 1 sabiti: «tam dokümanı OLDUĞU GİBI okur» eşitliği — satır artık dilim 2a alanlarının VARSAYILANINI da
 * taşır (`durumAciklama: ''`, `durumSurum: 0`, `iptalOncesi: null`, `durumGecmisi: []`, `kalemTeslim: {}`, `etiketBasildi: null`);
 * beklenen nesne `DILIM1_VARSAYILAN` ile birlikte TAM eşitliktir (gevşetilmedi).
 *
 * BİLEREK DEĞİŞEN dilim 2a sabiti (2b): aynı TAM eşitlik artık 2b alanlarının varsayılanını da taşır (`teyit: null`,
 * `icerikSurum: 0`, `silindi: null`, `elle: null`, `bildirimRevize: null`) — `DILIM1_VARSAYILAN` genişledi, eşitlik gevşemedi.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { join } from 'node:path';
import { oku, SRC_KOK } from '../test/kaynakTarama';
import {
  useMagazaTalepleri, useMagazaYeniSayaci, magazaTalebiDaralt, magazaIlkKaynakSekmesi,
  magazaTalepOlusturmaMs, enBuyukOlusturmaMs, yeniTalepSayisi,
  magazaSonGorulenAnahtari, magazaSonGorulenOku, magazaSonGorulenYaz,
  MAGAZA_ILK_GORUNTU_SURESI_MS, MAGAZA_ILK_GORUNTU_HATASI,
  yeniAsamaSayisi,
  type MagazaTalepSatiri,
} from './useMagazaTalepleri';
import {
  MAGAZA_TALEP_ASAMALARI, magazaKalemAnahtarlari, magazaKalemTeslimMi, magazaTeslimIsaretsiz, magazaGuncellemeZamani, magazaSilinmisMi,
  type MagazaTalebi,
} from '../lib/magazaTalep';
import { MAGAZA_BILDIRIM_DURUMLARI } from '../server/kanal/magazaBildirimSayim';
import { yorumsuz } from '../test/degismezTarayici';

// ── Akış düzeneği: `lib/dbClient` yerine abonelikleri kaydeden sahte ────────────────────────────────────────────────
interface Abonelik { ad: string; next: (s: unknown) => void; err: (e: Error) => void; kapandi: boolean }
const abonelikler: Abonelik[] = [];
vi.mock('../lib/dbClient', () => ({
  collection: (_db: unknown, ad: string) => ({ ad }),
  query: (c: unknown) => c,
  onSnapshot: (q: { ad: string }, next: (s: unknown) => void, err: (e: Error) => void) => {
    const a: Abonelik = { ad: q.ad, next, err, kapandi: false };
    abonelikler.push(a);
    return () => { a.kapandi = true; };
  },
}));

const goruntu = (satirlar: Array<{ id: string; veri: unknown }>) => ({ docs: satirlar.map(s => ({ id: s.id, data: () => s.veri })) });

/** Sunucunun yazdığı biçimde TAM bir talep dokümanı (lib/magazaTalep.ts `MagazaTalebi`). */
const tamTalep: MagazaTalebi = {
  companyId: 'kiraci-1',
  talepNo: 'T261008-5Y9P',
  durum: 'yeni',
  olusturma: '2026-10-08T09:15:00.000Z',
  istemciTarihi: '2026-10-08T09:14:58.000Z',
  musteri: { ad: 'Şükrü Çağlayan', firma: 'Çağlayan İnşaat', telefon: '0532 111 22 33', eposta: 'sukru@ornek.com.tr', il: 'İzmir', adres: 'Işıklar Cad. No: 5\nKat 2', vergi: '1234567890' },
  telefonSon10: '5321112233',
  not: 'Öğleden sonra arayın',
  kalemler: [
    { id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, talepFiyat: 204.99, tedarik: false },
    { id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, talepFiyat: null, tedarik: true },
  ],
  talepEdilen: { araToplam: 409.98, kdv: 82, toplam: 491.98 },
  fiyatiSorulacakVar: true,
  bildirim: { durum: 'gitti', zaman: '2026-10-08T09:15:04.000Z' },
};

/**
 * Dilim 1 kaydında OLMAYAN dilim 2a ve 2b alanlarının satırdaki varsayılanı (okunamayan değer uydurulmaz: boş / 0 / `null`).
 * 2b: teyit yok, içerik sürümü 0, silinmemiş, mağazadan gelmiş, revize bildirimi yok.
 */
const DILIM1_VARSAYILAN = {
  durumAciklama: '', durumSurum: 0, iptalOncesi: null, durumGecmisi: [], kalemTeslim: {}, etiketBasildi: null,
  teyit: null, icerikSurum: 0, silindi: null, elle: null, bildirimRevize: null,
} as const;

beforeEach(() => { abonelikler.length = 0; localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

// ── 1. Savunmacı daraltma ───────────────────────────────────────────────────────────────────────────────────────────
describe('magazaTalebiDaralt — akıştan gelen doküman güvenilmez', () => {
  it('tam dokümanı OLDUĞU GİBI okur ve kimliği ekler (Türkçe harfler aynen); dilim 1 kaydında dilim 2a alanları varsayılanda', () => {
    expect(magazaTalebiDaralt('mt-0123', tamTalep)).toEqual({ ...tamTalep, id: 'mt-0123', ...DILIM1_VARSAYILAN });
    // İsteğe bağlı iki alan dokümanda yokken satırda da YOKTUR (uydurma zaman / sayaç yazılmaz).
    const t = magazaTalebiDaralt('mt-0123', tamTalep);
    expect('durumZamani' in t).toBe(false);
    expect('durumGecmisiDusen' in t).toBe(false);
  });

  it('dilim 2a alanlarını taşıyan TAM doküman olduğu gibi okunur', () => {
    const tam2a = {
      ...tamTalep,
      durum: 'iptal',
      durumAciklama: 'Müşteri vazgeçti',
      durumZamani: '2026-10-09T08:00:00.000Z',
      durumSurum: 7,
      iptalOncesi: 'sevk',
      durumGecmisi: [
        { onceki: 'yeni', yeni: 'teyit', zaman: '2026-10-08T10:00:00.000Z', kim: { uid: 'u-1', ad: 'Ayşe Yılmaz' }, kanal: 'panel' },
        { onceki: 'sevk', yeni: 'iptal', zaman: '2026-10-09T08:00:00.000Z', kim: { uid: 'u-2', ad: 'Mehmet Öztürk' }, kanal: 'erp' },
      ],
      durumGecmisiDusen: 3,
      kalemTeslim: {
        'b:0': { durum: 'teslim', zaman: '2026-10-08T15:00:00.000Z', kim: { uid: 'u-1', ad: 'Ayşe Yılmaz' } },
        'b:1': { durum: 'bekliyor', zaman: '2026-10-08T16:00:00.000Z', kim: { uid: 'u-2', ad: 'Mehmet Öztürk' } },
      },
      etiketBasildi: { zaman: '2026-10-08T14:05:00.000Z', koli: 3, kim: { uid: 'u-1', panel: true } },
    };
    // 2a kaydında 2b alanları yoktur: satırda varsayılanlarıyla durur.
    expect(magazaTalebiDaralt('mt-2a', tam2a)).toEqual({ ...tam2a, id: 'mt-2a', teyit: null, icerikSurum: 0, silindi: null, elle: null, bildirimRevize: null });
  });

  it('nesne olmayan / boş doküman ATILMAZ: metinler boş, sayılar BİLİNMİYOR, bildirim null', () => {
    for (const ham of [null, undefined, 'abc', 42, [], {}]) {
      const t = magazaTalebiDaralt('mt-x', ham);
      expect(t.id).toBe('mt-x');
      expect(t.talepNo).toBe('');
      expect(t.olusturma).toBe('');
      expect(t.istemciTarihi).toBeNull();
      expect(t.musteri).toEqual({ ad: '', firma: '', telefon: '', eposta: '', il: '', adres: '', vergi: '' });
      expect(t.kalemler).toEqual([]);
      expect(t.talepEdilen).toEqual({ araToplam: null, kdv: null, toplam: null });   // 0 DEĞİL
      expect(t.fiyatiSorulacakVar).toBe(false);
      expect(t.bildirim).toBeNull();
      expect('kirpildi' in t).toBe(false);
      // Dilim 2a: aşama `'yeni'` UYDURULMAZ; sürüm 0; işaret / geçmiş boş; etiket basılmadı.
      expect(t.durum).toBeNull();
      expect(t).toMatchObject(DILIM1_VARSAYILAN);
    }
  });

  it('kalem fiyatı: yok / null / metin / NaN / sonsuz → null («fiyat sorulacak»); meşru 0 KORUNUR', () => {
    const kalemler = [
      { ad: 'yok' },
      { ad: 'null', talepFiyat: null },
      { ad: 'metin', talepFiyat: '204.99' },
      { ad: 'nan', talepFiyat: NaN },
      { ad: 'sonsuz', talepFiyat: Infinity },
      { ad: 'sifir', talepFiyat: 0 },
      { ad: 'sayi', talepFiyat: 12.5 },
    ];
    const t = magazaTalebiDaralt('mt-1', { kalemler });
    expect(t.kalemler.map(k => k.talepFiyat)).toEqual([null, null, null, null, null, 0, 12.5]);
  });

  it('kalem adedi: sayı değilse NaN (0 «sıfır adet», 1 «bir adet» UYDURULMAZ)', () => {
    const t = magazaTalebiDaralt('mt-1', { kalemler: [{ adet: 3 }, {}, { adet: '3' }, { adet: null }, { adet: Infinity }] });
    expect(t.kalemler[0].adet).toBe(3);
    for (const k of t.kalemler.slice(1)) expect(Number.isNaN(k.adet)).toBe(true);
  });

  it('bozuk kalem (nesne değil) listeden DÜŞMEZ — satırı boş alanlarla kalır (kalem sayısı değişmesin)', () => {
    const t = magazaTalebiDaralt('mt-1', { kalemler: [null, 'x', 7, { sku: 'A-1', tedarik: 'evet' }] });
    expect(t.kalemler).toHaveLength(4);
    expect(t.kalemler[3]).toMatchObject({ sku: 'A-1', ad: '', tedarik: false });   // tedarik yalnız `true` ise doğru
    expect(magazaTalebiDaralt('mt-1', { kalemler: 'bozuk' }).kalemler).toEqual([]);
  });

  it('talep edilen tutarlar: yok / metin → null; meşru 0 KORUNUR', () => {
    expect(magazaTalebiDaralt('a', { talepEdilen: { araToplam: 0, kdv: '82', toplam: null } }).talepEdilen)
      .toEqual({ araToplam: 0, kdv: null, toplam: null });
    expect(magazaTalebiDaralt('a', { talepEdilen: 'bozuk' }).talepEdilen).toEqual({ araToplam: null, kdv: null, toplam: null });
  });

  it('`olusturma` metin değilse boş kalır; kayıt ATILMAZ', () => {
    for (const olusturma of [{ __op: 'serverTimestamp' }, 1759914900000, null]) {
      const t = magazaTalebiDaralt('mt-1', { talepNo: 'T261008-AAAA', olusturma });
      expect(t.olusturma).toBe('');
      expect(t.talepNo).toBe('T261008-AAAA');
    }
  });

  it('bildirim: bilinmeyen durum → null (uydurma «gitti» / «bekliyor» YOK); kapalı küme dışı hata sınıfı ve hata METNİ taşınmaz', () => {
    expect(magazaTalebiDaralt('a', { bildirim: { durum: 'tamam', zaman: 'x' } }).bildirim).toBeNull();
    expect(magazaTalebiDaralt('a', { bildirim: 'gitti' }).bildirim).toBeNull();
    // `toString` gibi miras alınan ad «bilinen durum» sayılmaz.
    expect(magazaTalebiDaralt('a', { bildirim: { durum: 'toString', zaman: 'x' } }).bildirim).toBeNull();
    const b = magazaTalebiDaralt('a', { bildirim: { durum: 'bekliyor', zaman: '2026-10-08T09:15:00.000Z', deneme: 3, hataSinifi: 'tls', hata: 'self signed certificate' } }).bildirim;
    expect(b).toEqual({ durum: 'bekliyor', zaman: '2026-10-08T09:15:00.000Z', deneme: 3, hataSinifi: 'tls' });
    const c = magazaTalebiDaralt('a', { bildirim: { durum: 'gonderilemedi', zaman: 5, deneme: '3', hataSinifi: 'EAUTH 535 parola yanlış' } }).bildirim;
    expect(c).toEqual({ durum: 'gonderilemedi', zaman: '' });
  });

  it('`kirpildi` yalnız TAM `true` ise taşınır; `fiyatiSorulacakVar` yalnız TAM `true` ise doğru', () => {
    expect(magazaTalebiDaralt('a', { kirpildi: true }).kirpildi).toBe(true);
    for (const v of [false, 'true', 1, null]) expect('kirpildi' in magazaTalebiDaralt('a', { kirpildi: v })).toBe(false);
    expect(magazaTalebiDaralt('a', { fiyatiSorulacakVar: true }).fiyatiSorulacakVar).toBe(true);
    expect(magazaTalebiDaralt('a', { fiyatiSorulacakVar: 'true' }).fiyatiSorulacakVar).toBe(false);
  });
});

// ── 1b. Dilim 2a alanları ───────────────────────────────────────────────────────────────────────────────────────────
describe('magazaTalebiDaralt — dilim 2a: aşama, sürüm, kalem teslim, etiket (şartname v6 § 5.1)', () => {
  const d = (ek: Record<string, unknown>) => magazaTalebiDaralt('mt-1', { ...tamTalep, ...ek });

  it('`durum` dokümandan okunur: altı aşamanın her biri kendisi (`\'sevk\'` → `\'sevk\'`) — sabit `\'yeni\'` YAZILMAZ', () => {
    for (const asama of MAGAZA_TALEP_ASAMALARI) expect(d({ durum: asama }).durum, asama).toBe(asama);
    expect(d({ durum: 'sevk' }).durum).toBe('sevk');
  });

  it('bilinmeyen / eksik aşama `null` olur — `\'yeni\'`ye ÇEVRİLMEZ (ekran «durum okunamadı» basar)', () => {
    for (const bozuk of ['alindi', 'bilinmiyor', 'Yeni', 'SEVK', ' sevk', '', 'toString', 'constructor', '__proto__', 3, null, undefined, true, ['sevk'], { durum: 'sevk' }]) {
      expect(d({ durum: bozuk }).durum, JSON.stringify(bozuk)).toBeNull();
    }
    const { durum: _yok, ...durumsuz } = tamTalep;
    expect(magazaTalebiDaralt('mt-1', durumsuz).durum).toBeNull();   // alan yok → null, 'yeni' değil
  });

  it('`durumSurum`: negatif olmayan tam sayı ise kendisi; sayı değilse / kesirliyse / negatifse 0', () => {
    expect(d({ durumSurum: 0 }).durumSurum).toBe(0);
    expect(d({ durumSurum: 12 }).durumSurum).toBe(12);
    for (const bozuk of ['3', null, undefined, NaN, Infinity, -1, 2.5, {}, [4]]) expect(d({ durumSurum: bozuk }).durumSurum, String(bozuk)).toBe(0);
  });

  it('`durumAciklama` metin değilse boş; `durumZamani` yalnız metinse taşınır; `telefonSon10` metin değilse boş', () => {
    expect(d({ durumAciklama: 'Yarın teslim' }).durumAciklama).toBe('Yarın teslim');
    for (const bozuk of [null, 5, {}, ['x']]) expect(d({ durumAciklama: bozuk }).durumAciklama).toBe('');
    expect(d({ durumZamani: '2026-10-09T08:00:00.000Z' }).durumZamani).toBe('2026-10-09T08:00:00.000Z');
    for (const bozuk of [null, 1760000000000, { __op: 'serverTimestamp' }]) expect('durumZamani' in d({ durumZamani: bozuk })).toBe(false);
    expect(d({ telefonSon10: '5321112233' }).telefonSon10).toBe('5321112233');
    expect(d({ telefonSon10: 5321112233 }).telefonSon10).toBe('');
  });

  it('`iptalOncesi` yalnız dört AÇIK aşamadan biriyse taşınır; `teslim` / `iptal` / çöp → `null` (iptalden dönüş uydurulmaz)', () => {
    for (const acik of ['yeni', 'teyit', 'hazirlaniyor', 'sevk']) expect(d({ iptalOncesi: acik }).iptalOncesi).toBe(acik);
    for (const bozuk of ['teslim', 'iptal', 'alindi', '', null, undefined, 2, {}]) expect(d({ iptalOncesi: bozuk }).iptalOncesi, String(bozuk)).toBeNull();
  });

  it('`durumGecmisi` giriş giriş daraltılır: bozuk GİRİŞ düşer, sağlamlar sırasıyla kalır; dizi değilse `[]`', () => {
    const saglam = { onceki: 'yeni', yeni: 'teyit', zaman: '2026-10-08T10:00:00.000Z', kim: { uid: 'u-1', ad: 'Ayşe Yılmaz' }, kanal: 'panel' };
    const ikinci = { onceki: 'teyit', yeni: 'hazirlaniyor', zaman: '2026-10-08T11:00:00.000Z', kim: { uid: 'u-2', ad: 'Mehmet Öztürk' }, kanal: 'erp' };
    const t = d({ durumGecmisi: [
      saglam,
      null,
      'yeni→teyit',
      { ...saglam, onceki: 'alindi' },              // panel sözlüğü saklanan değer değildir
      { ...saglam, yeni: 'bilinmiyor' },
      { ...saglam, zaman: 1760000000000 },
      { ...saglam, kim: { uid: 'u-1' } },            // ad yok
      { ...saglam, kim: 'Ayşe' },
      { ...saglam, kanal: 'mobil' },
      { ...ikinci, fazla: 'alan', aciklama: 'geçmişe açıklama yazılmaz' },
    ] });
    expect(t.durumGecmisi).toEqual([saglam, ikinci]);   // fazladan alan taşınmaz
    for (const bozuk of [null, 'x', {}, 5]) expect(d({ durumGecmisi: bozuk }).durumGecmisi).toEqual([]);
    expect(d({ durumGecmisiDusen: 5 }).durumGecmisiDusen).toBe(5);
    for (const bozuk of ['5', -1, 1.5, null]) expect('durumGecmisiDusen' in d({ durumGecmisiDusen: bozuk })).toBe(false);
  });

  it('`kalemTeslim` nesne değilse / yoksa BOŞ sayılır (`{}`) — fırlatmaz', () => {
    for (const bozuk of [undefined, null, 'teslim', 3, true, [{ durum: 'teslim' }]]) {
      expect(d({ kalemTeslim: bozuk }).kalemTeslim, String(bozuk)).toEqual({});
    }
  });

  it('`kalemTeslim` giriş giriş daraltılır: uymayan GİRİŞ düşer, nesnenin tamamı DEĞİL; anahtar kurallı desene uymalı', () => {
    const kim = { uid: 'u-1', ad: 'Ayşe Yılmaz' };
    const z = '2026-10-08T15:00:00.000Z';
    const t = d({ kalemTeslim: {
      'b:0': { durum: 'teslim', zaman: z, kim, fazla: 'alan' },
      'b:1': { durum: 'bekliyor', zaman: z, kim },
      't:0123456789ab': { durum: 'teslim', zaman: z, kim },      // 2b'nin teyit anahtarı: desene uyar, taşınır
      'b:01': { durum: 'teslim', zaman: z, kim },                 // öncü sıfır (K5)
      'b:10000': { durum: 'teslim', zaman: z, kim },
      'B:0': { durum: 'teslim', zaman: z, kim },
      'c:0': { durum: 'teslim', zaman: z, kim },
      '': { durum: 'teslim', zaman: z, kim },
      'b:2': { durum: 'verildi', zaman: z, kim },                 // bilinmeyen durum
      'b:3': { durum: 'teslim', zaman: 1760000000000, kim },      // zaman metin değil
      'b:4': { durum: 'teslim', zaman: z, kim: { uid: 'u-1' } },  // ad yok
      'b:5': { durum: 'teslim', zaman: z },
      'b:6': 'teslim',
      'b:7': null,
    } });
    expect(t.kalemTeslim).toEqual({
      'b:0': { durum: 'teslim', zaman: z, kim },
      'b:1': { durum: 'bekliyor', zaman: z, kim },
      't:0123456789ab': { durum: 'teslim', zaman: z, kim },
    });
  });

  it('`teslim` bayrağı kancada SAKLANMAZ: beyan kalemine `teslim` / `anahtar` yazılmaz; ekran ortak saf işlevleri okur', () => {
    const kim = { uid: 'u-1', ad: 'Ayşe Yılmaz' };
    const t = d({
      durumZamani: '2026-10-08T12:00:00.000Z',
      kalemTeslim: { 'b:1': { durum: 'teslim', zaman: '2026-10-08T15:00:00.000Z', kim }, 'b:0': { durum: 'bekliyor', zaman: '2026-10-08T14:00:00.000Z', kim } },
      kalemler: [{ ...tamTalep.kalemler[0], teslim: true, anahtar: 'b:0' }, tamTalep.kalemler[1]],
    });
    for (const k of t.kalemler) expect(Object.keys(k).sort()).toEqual(['ad', 'adet', 'id', 'marka', 'sku', 'talepFiyat', 'tedarik']);
    // Aynı satır, § 1'in ortak işlevleriyle (panelin `Siparis` eşlemesi ve takip ucu da bunları okur).
    expect(magazaKalemAnahtarlari(t)).toEqual(['b:0', 'b:1']);
    expect(magazaKalemAnahtarlari(t).map(a => magazaKalemTeslimMi(t.kalemTeslim, a))).toEqual([false, true]);
    expect(magazaTeslimIsaretsiz(t)).toBe(1);
    expect(magazaGuncellemeZamani(t)).toBe('2026-10-08T15:00:00.000Z');
  });

  it('`etiketBasildi`: nesne ve `zaman` metin ise `{ zaman, koli?, kim }`; yok / `null` / bozuk → `null` (= basılmadı)', () => {
    const z = '2026-10-08T14:05:00.000Z';
    expect(d({ etiketBasildi: { zaman: z, koli: 3, kim: { uid: 'u-1', panel: true } } }).etiketBasildi).toEqual({ zaman: z, koli: 3, kim: { uid: 'u-1', panel: true } });
    expect(d({ etiketBasildi: { zaman: z, kim: { panel: true } } }).etiketBasildi).toEqual({ zaman: z, kim: { panel: true } });
    // `koli` yalnız POZİTİF TAM sayıysa taşınır (0 / kesirli / metin → anahtar yok); `kim` alanları tek tek daraltılır.
    for (const koli of [0, -2, 1.5, '3', null, NaN]) {
      expect(d({ etiketBasildi: { zaman: z, koli, kim: { uid: 7, panel: 'evet', ad: 'sızan ad' } } }).etiketBasildi, String(koli)).toEqual({ zaman: z, kim: {} });
    }
    for (const bozuk of [undefined, null, 'basıldı', true, 3, [z], {}, { koli: 3 }, { zaman: 1760000000000 }]) {
      expect(d({ etiketBasildi: bozuk }).etiketBasildi, JSON.stringify(bozuk)).toBeNull();
    }
  });

  it('`yeniAsamaSayisi`: aşaması `yeni` olanların sayısı (panelin «Yeni»siyle aynı ölçüt); okunamayan aşama SAYILMAZ', () => {
    const satirlar = [d({ durum: 'yeni' }), d({ durum: 'yeni' }), d({ durum: 'teyit' }), d({ durum: 'bozuk' }), d({ durum: 'iptal' })];
    expect(yeniAsamaSayisi(satirlar)).toBe(2);
    expect(yeniAsamaSayisi([])).toBe(0);
  });
});

// ── 1c. Dilim 2b alanları ───────────────────────────────────────────────────────────────────────────────────────────
describe('magazaTalebiDaralt — dilim 2b: teyit, içerik sürümü, silindi, elle, revize bildirimi (şartname v6 § 10.4)', () => {
  const d = (ek: Record<string, unknown>) => magazaTalebiDaralt('mt-1', { ...tamTalep, ...ek });
  const z = '2026-10-09T08:00:00.000Z';
  const teyitKalemi = (ek: Record<string, unknown> = {}) =>
    ({ anahtar: 't:aaaaaaaaaaaa', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, birimFiyat: 95, kdvOrani: 20, kdvKaynagi: 'urun', tedarik: false, ...ek });
  const teyit = (ek: Record<string, unknown> = {}) => ({
    kalemler: [teyitKalemi(), teyitKalemi({ anahtar: 't:bbbbbbbbbbbb', id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, birimFiyat: 40, kdvOrani: 10, kdvKaynagi: 'personel' })],
    araToplam: 230, kdv: 42, toplam: 272, zaman: z, kim: { uid: 'u-2', ad: 'Mehmet Öztürk' }, ...ek,
  });

  it('dilim 2b alanlarını taşıyan TAM doküman olduğu gibi okunur', () => {
    const tam2b = {
      ...tamTalep,
      teyit: teyit(),
      icerikSurum: 4,
      icerikZamani: z,
      silindi: { zaman: z, kim: { uid: 'u-9', ad: 'Zeynep Yönetici' }, kanal: 'panel' },
      elle: { zaman: '2026-10-08T09:15:00.000Z', kim: { uid: 'u-1', ad: 'Ayşe Yılmaz' } },
      bildirimRevize: { durum: 'gonderilemedi', zaman: z, alanlar: ['musteri', 'teyit'], kim: { uid: 'u-2', ad: 'Mehmet Öztürk' }, icerikSurum: 4, deneme: 3, hataSinifi: 'baglanti' },
    };
    const { teyit: _t, icerikSurum: _s, silindi: _x, elle: _e, bildirimRevize: _b, ...kalan } = DILIM1_VARSAYILAN;
    expect(magazaTalebiDaralt('mt-2b', tam2b)).toEqual({ ...tam2b, id: 'mt-2b', ...kalan });
  });

  it('2a / dilim 1 kaydı (2b alanı yok): teyit `null`, `icerikSurum` 0, silinmemiş, mağazadan gelmiş, revize yok; `icerikZamani` satırda YOK', () => {
    const t = d({});
    expect([t.teyit, t.icerikSurum, t.silindi, t.elle, t.bildirimRevize]).toEqual([null, 0, null, null, null]);
    expect('icerikZamani' in t).toBe(false);
  });

  it('`teyit` bozuksa BÜTÜNÜYLE `null` (yarım okunmuş teyit yanlış tutar basardı): nesne değil / kalem dizisi yok / boş dizi', () => {
    for (const bozuk of [undefined, null, 'teyit', 3, true, [teyitKalemi()], {}, { kalemler: 'x' }, { kalemler: {} }, teyit({ kalemler: [] })]) {
      expect(d({ teyit: bozuk }).teyit, JSON.stringify(bozuk)).toBeNull();
    }
  });

  it('TEK bozuk kalem teyidi düşürür: `anahtar` desene uymuyor, `kdvOrani` küme dışı, `kdvKaynagi` tanınmıyor, kalem nesne değil, yinelenen anahtar', () => {
    const bozukKalemler: Array<[string, unknown]> = [
      ['anahtar yok', teyitKalemi({ anahtar: undefined })],
      ['beyan anahtarı değil ama öncü sıfırlı', teyitKalemi({ anahtar: 'b:01' })],
      ['kısa onaltılık', teyitKalemi({ anahtar: 't:abc' })],
      ['büyük harfli onaltılık', teyitKalemi({ anahtar: 't:AAAAAAAAAAAA' })],
      ['anahtar sayı', teyitKalemi({ anahtar: 7 })],
      ['kdvOrani 18 (küme dışı)', teyitKalemi({ kdvOrani: 18 })],
      ['kdvOrani 8', teyitKalemi({ kdvOrani: 8 })],
      ['kdvOrani metin', teyitKalemi({ kdvOrani: '20' })],
      ['kdvOrani yok', teyitKalemi({ kdvOrani: undefined })],
      ['kdvKaynagi tanınmıyor', teyitKalemi({ kdvKaynagi: 'mikro' })],
      ['kdvKaynagi yok', teyitKalemi({ kdvKaynagi: undefined })],
      ['kalem null', null],
      ['kalem metin', 'kalem'],
    ];
    for (const [ad, kalem] of bozukKalemler) {
      expect(d({ teyit: teyit({ kalemler: [teyitKalemi({ anahtar: 't:cccccccccccc' }), kalem] }) }).teyit, ad).toBeNull();
    }
    // Aynı anahtar iki kalemde: teslim işareti hangisine ait belli olmaz.
    expect(d({ teyit: teyit({ kalemler: [teyitKalemi(), teyitKalemi()] }) }).teyit).toBeNull();
    // Denetim: aynı kalemlerin SAĞLAM hâli okunur (yukarıdaki `null`lar gerçekten bozukluktan).
    expect(d({ teyit: teyit({ kalemler: [teyitKalemi({ anahtar: 't:cccccccccccc' }), teyitKalemi()] }) }).teyit?.kalemler).toHaveLength(2);
  });

  it('beyandan kopya anahtarı (`b:<dizin>`) desene UYAR ama teyit kalemi sunucuda hep `t:` taşır — desen ortak, kalem okunur', () => {
    // Desen `lib/magazaTalep.ts` MAGAZA_KALEM_ANAHTARI_DESENI'dir (ikinci desen yazılmaz); sunucu teyide `b:` yazmaz.
    expect(d({ teyit: teyit({ kalemler: [teyitKalemi({ anahtar: 'b:0' })] }) }).teyit?.kalemler[0].anahtar).toBe('b:0');
  });

  it('teyit toplamları ve fiyat: sayı değilse `null` (0 DEĞİL); meşru 0 KORUNUR; adet sayı değilse NaN; `tedarik` yalnız TAM `true`', () => {
    const t = d({ teyit: teyit({ araToplam: '230', kdv: NaN, toplam: undefined, kalemler: [teyitKalemi({ birimFiyat: '95', adet: '2', tedarik: 'evet', id: 7, marka: null })] }) }).teyit;
    expect([t?.araToplam, t?.kdv, t?.toplam]).toEqual([null, null, null]);
    expect(t?.kalemler[0]).toEqual({ anahtar: 't:aaaaaaaaaaaa', id: '', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: '', adet: NaN, birimFiyat: null, kdvOrani: 20, kdvKaynagi: 'urun', tedarik: false });
    const sifir = d({ teyit: teyit({ araToplam: 0, kdv: 0, toplam: 0, kalemler: [teyitKalemi({ birimFiyat: 0, kdvOrani: 0 })] }) }).teyit;
    expect([sifir?.araToplam, sifir?.kdv, sifir?.toplam, sifir?.kalemler[0].birimFiyat, sifir?.kalemler[0].kdvOrani]).toEqual([0, 0, 0, 0, 0]);
  });

  it('teyit eden okunamıyorsa ad boş kalır, teyit DÜŞMEZ; `zaman` metin değilse boş', () => {
    const t = d({ teyit: teyit({ kim: 'Mehmet', zaman: 1760000000000 }) }).teyit;
    expect(t?.kim).toEqual({ uid: '', ad: '' });
    expect(t?.zaman).toBe('');
    expect(t?.kalemler).toHaveLength(2);
  });

  it('`icerikSurum`: negatif olmayan tam sayı ise kendisi; sayı değilse / kesirliyse / negatifse 0; `icerikZamani` yalnız metinse taşınır', () => {
    expect(d({ icerikSurum: 0 }).icerikSurum).toBe(0);
    expect(d({ icerikSurum: 12 }).icerikSurum).toBe(12);
    for (const bozuk of ['3', 2.5, -1, NaN, null, undefined, true, [3]]) expect(d({ icerikSurum: bozuk }).icerikSurum, String(bozuk)).toBe(0);
    expect(d({ icerikZamani: z }).icerikZamani).toBe(z);
    for (const bozuk of [1760000000000, null, undefined, { z }]) expect('icerikZamani' in d({ icerikZamani: bozuk })).toBe(false);
  });

  it('`silindi`: NESNE → silinmiş; `null` (geri alınmış) → `null`; yok → `null`; nesne olmayan değer → `null`', () => {
    expect(d({ silindi: { zaman: z, kim: { uid: 'u-9', ad: 'Zeynep Yönetici' }, kanal: 'erp' } }).silindi).toEqual({ zaman: z, kim: { uid: 'u-9', ad: 'Zeynep Yönetici' }, kanal: 'erp' });
    expect(d({ silindi: null }).silindi).toBeNull();
    expect(d({}).silindi).toBeNull();
    for (const bozuk of ['silindi', true, 1, [{ zaman: z }]]) expect(d({ silindi: bozuk }).silindi, JSON.stringify(bozuk)).toBeNull();
  });

  it('alanları BOZUK silme nesnesi `null`\'a DÜŞMEZ: talep yine SİLİNMİŞ görünür (sunucu 409 `silindi` verirken ekran canlı göstermesin)', () => {
    expect(d({ silindi: {} }).silindi).toEqual({ zaman: '', kim: { uid: '', ad: '' }, kanal: null });
    expect(d({ silindi: { zaman: 7, kim: 'biri', kanal: 'mobil' } }).silindi).toEqual({ zaman: '', kim: { uid: '', ad: '' }, kanal: null });
    // Ölçüt ortak saf işlevle AYNI hükmü verir (SQL eşi `jsonb_typeof(…) = 'object'`).
    for (const v of [{}, { zaman: z }, null, undefined, 'x', [], 0]) expect(d({ silindi: v }).silindi !== null, JSON.stringify(v)).toBe(magazaSilinmisMi({ silindi: v }));
  });

  it('`elle`: nesne → `{ zaman, kim }` (ERP\'de elle açıldı); yok / `null` / dizi / metin → `null` (mağazadan geldi)', () => {
    expect(d({ elle: { zaman: z, kim: { uid: 'u-1', ad: 'Ayşe Yılmaz' }, fazladan: 1 } }).elle).toEqual({ zaman: z, kim: { uid: 'u-1', ad: 'Ayşe Yılmaz' } });
    expect(d({ elle: {} }).elle).toEqual({ zaman: '', kim: { uid: '', ad: '' } });
    for (const yok of [undefined, null, [], 'elle', true]) expect(d({ elle: yok }).elle, JSON.stringify(yok)).toBeNull();
  });

  it('`bildirimRevize` DÖRT durumda tanınır (ilk bildirimle AYNI sözlük); `kim` / `icerikSurum` / `deneme` / hata sınıfı taşınır', () => {
    for (const durum of MAGAZA_BILDIRIM_DURUMLARI) {
      expect(d({ bildirimRevize: { durum, zaman: z, alanlar: ['not'], kim: { uid: 'u-2', ad: 'Mehmet Öztürk' }, icerikSurum: 3 } }).bildirimRevize, durum)
        .toEqual({ durum, zaman: z, alanlar: ['not'], kim: { uid: 'u-2', ad: 'Mehmet Öztürk' }, icerikSurum: 3 });
    }
    expect(MAGAZA_BILDIRIM_DURUMLARI).toHaveLength(4);
    expect(d({ bildirimRevize: { durum: 'bekliyor', zaman: z, alanlar: ['teyit'], kim: { uid: 'u', ad: 'A' }, icerikSurum: 1, deneme: 2, hataSinifi: 'tls' } }).bildirimRevize)
      .toEqual({ durum: 'bekliyor', zaman: z, alanlar: ['teyit'], kim: { uid: 'u', ad: 'A' }, icerikSurum: 1, deneme: 2, hataSinifi: 'tls' });
  });

  it('`bildirimRevize.alanlar` `alanlariBirlestir` ile: yinelenen ad tekilleşir (SQL birleştirmesi `[\'not\', \'not\']` bırakır), bilinmeyen ad süzülür', () => {
    const r = (alanlar: unknown) => d({ bildirimRevize: { durum: 'bekliyor', zaman: z, alanlar, kim: { uid: 'u', ad: 'A' }, icerikSurum: 1 } }).bildirimRevize?.alanlar;
    expect(r(['not', 'not'])).toEqual(['not']);
    expect(r(['not', 'teyit', 'not', 'musteri'])).toEqual(['not', 'teyit', 'musteri']);
    expect(r(['not', 'fiyat', 7, null, 'teyit'])).toEqual(['not', 'teyit']);
    for (const bozuk of [undefined, null, 'not', { 0: 'not' }]) expect(r(bozuk), JSON.stringify(bozuk)).toEqual([]);
  });

  it('`bildirimRevize` bozuksa `null` (ikinci rozet çizilmez): alan yok, nesne değil, durum bilinmiyor; `icerikSurum` okunamıyorsa `null`, kim okunamıyorsa boş', () => {
    for (const bozuk of [undefined, null, 'bekliyor', [], {}, { zaman: z }, { durum: 'Bekliyor', zaman: z }, { durum: 'vazgecildi', zaman: z }, { durum: 'hata', zaman: z }]) {
      expect(d({ bildirimRevize: bozuk }).bildirimRevize, JSON.stringify(bozuk)).toBeNull();
    }
    expect(d({ bildirimRevize: { durum: 'gitti', zaman: z, icerikSurum: '3', kim: null } }).bildirimRevize).toEqual({ durum: 'gitti', zaman: z, alanlar: [], kim: { uid: '', ad: '' }, icerikSurum: null });
  });

  it('`gerekmiyor` özel bir durum DEĞİLDİR: iki bildirim alanında da bilinmeyen dizge gibi işlenir (`null`)', () => {
    expect(d({ bildirim: { durum: 'gerekmiyor', zaman: z } }).bildirim).toBeNull();
    expect(d({ bildirimRevize: { durum: 'gerekmiyor', zaman: z, alanlar: ['not'], kim: { uid: 'u', ad: 'A' }, icerikSurum: 1 } }).bildirimRevize).toBeNull();
  });

  it('içerik düzenlemesi BEYANI değiştirmez: teyitli dokümanda `kalemler` ve `talepEdilen` aynen okunur (iki tablo ayrı kaynaktan)', () => {
    const t = d({ teyit: teyit() });
    expect(t.kalemler).toEqual(tamTalep.kalemler);
    expect(t.talepEdilen).toEqual(tamTalep.talepEdilen);
    expect(magazaKalemAnahtarlari(t)).toEqual(['t:aaaaaaaaaaaa', 't:bbbbbbbbbbbb']);       // aktif kaynak teyit
    expect(magazaKalemAnahtarlari(d({}))).toEqual(['b:0', 'b:1']);
  });

  it('sayaçlar YALNIZ canlı talepleri sayar: `yeniAsamaSayisi` silinmişi saymaz; geri alınan (`null`) yeniden sayılır', () => {
    const silinmis = { zaman: z, kim: { uid: 'u', ad: 'A' }, kanal: 'erp' };
    expect(yeniAsamaSayisi([d({ durum: 'yeni' }), d({ durum: 'yeni', silindi: silinmis }), d({ durum: 'yeni', silindi: null }), d({ durum: 'teyit' })])).toBe(2);
    expect(yeniAsamaSayisi([{ durum: 'yeni' }])).toBe(1);                                   // `silindi` alanı olmayan girdi canlıdır
  });
});

describe('useMagazaTalepleri.ts — kaynak çiti (yorumlar süzülür)', () => {
  const kod = yorumsuz('src/hooks/useMagazaTalepleri.ts', oku(join(SRC_KOK, 'hooks', 'useMagazaTalepleri.ts'))).join('\n');

  it('kaynak okunuyor (çit boş metne bakmasın)', () => { expect(kod.length).toBeGreaterThan(5000); });

  it('aşama kapalı kümeden geçer (`Record<MagazaTalepAsamasi, true>` — kümeye aşama eklenirse derleme kırılır); sabit `\'yeni\'` yazımı yok', () => {
    expect(kod).toContain('const BILINEN_ASAMA: Record<MagazaTalepAsamasi, true> = {');
    expect(kod).toContain('durum: asamaYaDaNull(d.durum),');
    expect(kod).not.toMatch(/durum: 'yeni'/);
  });

  it('kanca ağ isteği ATMAZ ve koleksiyona YAZMAZ: yazma `services/magazaTalepIstemcisi.ts`\'tedir', () => {
    expect(kod).not.toMatch(/authFetch|fetch\(|setDoc|updateDoc|addDoc|deleteDoc/);
    expect(kod).not.toMatch(/services\//);
  });

  it('bildirim sözlüğü DEĞİŞMEDİ: `BILINEN_BILDIRIM_DURUMU` anahtarları tam DÖRT ve sunucunun `MAGAZA_BILDIRIM_DURUMLARI` kümesiyle aynı; beşinci dal yok', () => {
    const govde = /const BILINEN_BILDIRIM_DURUMU: Record<MagazaBildirimDurumu, true> = \{([^}]*)\};/.exec(kod)?.[1] ?? '';
    const anahtarlar = [...govde.matchAll(/(\w+): true/g)].map(m => m[1]);
    expect(anahtarlar).toHaveLength(4);
    expect([...anahtarlar].sort()).toEqual([...MAGAZA_BILDIRIM_DURUMLARI].sort());
    expect(kod).not.toMatch(/gerekmiyor|vazgecildi/);
  });

  it('revize bildirimi ilk bildirimle AYNI daraltıcıdan geçer (kopya sözlük yok); `alanlar` `alanlariBirlestir` ile; silinmiş ölçütü ortak saf işlev', () => {
    const govde = /function bildirimRevizeDaralt\(v: unknown\): MagazaSatirBildirimRevize \| null \{\n([\s\S]*?)\n\}/.exec(kod)?.[1] ?? '';
    expect(govde).toContain('const taban = bildirimDaralt(v);');
    expect(govde).toContain('alanlar: alanlariBirlestir(b.alanlar)');
    expect((kod.match(/bildirimDurumuMu\(/g) ?? [])).toHaveLength(1);                 // tek karşılaştırma: `bildirimDaralt` içinde
    expect(kod).toContain('if (!magazaSilinmisMi({ silindi: v })) return null;');
    // Teyit kalemi: anahtar deseni, oran kümesi ve kaynak kümesi ortak sözleşmeden (kopya desen / kopya küme yok).
    expect(kod).toContain('MAGAZA_KALEM_ANAHTARI_DESENI.test(k.anahtar)');
    expect(kod).toContain('!magazaKdvOraniMi(k.kdvOrani) || !magazaKdvKaynagiMi(k.kdvKaynagi)');
    expect(kod).not.toMatch(/\[0, 1, 10, 20\]|'personel'|'varsayilan'/);
    // Sayısal alanda varsayılan yok: teyit toplamları `sayiYaDaNull`.
    expect(kod).toContain('araToplam: sayiYaDaNull(t.araToplam), kdv: sayiYaDaNull(t.kdv), toplam: sayiYaDaNull(t.toplam),');
    expect(kod).not.toMatch(/(\?\?|\|\|)\s*0\b/);
  });

  it('kalem daraltıcısı beyan kalemine `teslim` / `anahtar` YAZMAZ (V16); türetilen değer kancada saklanmaz', () => {
    const govde = /function kalemDaralt\(v: unknown\): MagazaTalepKalemi \{\n([\s\S]*?)\n\}/.exec(kod)?.[1] ?? '';
    expect(govde.length).toBeGreaterThan(100);
    expect(govde).not.toMatch(/teslim|anahtar/);
    expect(kod).not.toMatch(/magazaKalemTeslimMi|magazaTeslimIsaretsiz|magazaGuncellemeZamani|magazaKalemAnahtarlari/);
  });
});

// ── 2. Abonelik ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe('useMagazaTalepleri — abonelik', () => {
  it('`enabled` YANLIŞKEN onSnapshot HİÇ çağrılmaz; durum «yükleniyor» DEĞİL (beklenen bir şey yok)', () => {
    const { result, rerender, unmount } = renderHook(() => useMagazaTalepleri(false));
    rerender();
    expect(abonelikler).toHaveLength(0);
    expect(result.current).toEqual({ talepler: [], yukleniyor: false, hata: null });
    unmount();
    expect(abonelikler).toHaveLength(0);
  });

  it('`enabled` doğruyken `magazaTalepleri`ne TEK abonelik açar; ilk görüntüye (ya da süre sınırına) kadar «yükleniyor»', () => {
    const { result, rerender } = renderHook(() => useMagazaTalepleri(true));
    expect(abonelikler.map(a => a.ad)).toEqual(['magazaTalepleri']);
    expect(result.current).toEqual({ talepler: [], yukleniyor: true, hata: null });
    rerender();
    rerender();
    expect(abonelikler).toHaveLength(1);   // yeniden çizim yeni abonelik AÇMAZ
  });

  it('görüntü gelince dokümanlar daraltılır; `olusturma`\'sı çözülemeyen kayıt LİSTEDE KALIR', () => {
    const { result } = renderHook(() => useMagazaTalepleri(true));
    act(() => abonelikler[0].next(goruntu([
      { id: 'mt-1', veri: tamTalep },
      { id: 'mt-2', veri: { ...tamTalep, talepNo: 'T261008-BOZK', olusturma: 'dün öğlen' } },
      { id: 'mt-3', veri: null },
    ])));
    expect(result.current.yukleniyor).toBe(false);
    expect(result.current.hata).toBeNull();
    expect(result.current.talepler.map(t => t.id)).toEqual(['mt-1', 'mt-2', 'mt-3']);
    expect(result.current.talepler[0]).toEqual({ ...tamTalep, id: 'mt-1', ...DILIM1_VARSAYILAN });
    expect(result.current.talepler[1].olusturma).toBe('dün öğlen');
    expect(magazaTalepOlusturmaMs(result.current.talepler[1])).toBeNull();
  });

  it('abonelik hatası «talep yok» gibi SESSİZ kalmaz: hata metni döner', () => {
    const { result } = renderHook(() => useMagazaTalepleri(true));
    act(() => abonelikler[0].err(new Error('bağlantı koptu')));
    expect(result.current).toEqual({ talepler: [], yukleniyor: false, hata: 'bağlantı koptu' });
  });

  it('yetki düşünce abonelik KAPANIR ve önceki rolün gördüğü talepler bellekte kalmaz; yeniden açılınca «yükleniyor»dan başlar', () => {
    const { result, rerender } = renderHook(({ yetkili }: { yetkili: boolean }) => useMagazaTalepleri(yetkili), { initialProps: { yetkili: true } });
    act(() => abonelikler[0].next(goruntu([{ id: 'mt-1', veri: tamTalep }])));
    expect(result.current.talepler).toHaveLength(1);

    rerender({ yetkili: false });
    expect(abonelikler[0].kapandi).toBe(true);
    expect(result.current).toEqual({ talepler: [], yukleniyor: false, hata: null });
    expect(abonelikler).toHaveLength(1);

    rerender({ yetkili: true });
    expect(abonelikler).toHaveLength(2);
    expect(result.current).toEqual({ talepler: [], yukleniyor: true, hata: null });
  });

  it('bileşen kaldırılınca abonelik kapanır', () => {
    const { unmount } = renderHook(() => useMagazaTalepleri(true));
    unmount();
    expect(abonelikler[0].kapandi).toBe(true);
  });
});

// ── 2b. İlk görüntü süre sınırı ─────────────────────────────────────────────────────────────────────────────────────
describe('useMagazaTalepleri — ilk görüntü süre sınırı (sunucu listeyi HİÇ göndermezse sonsuz «Yükleniyor…» YOK)', () => {
  const SURE_DOLDU: ReturnType<typeof useMagazaTalepleri> = { talepler: [], yukleniyor: false, hata: MAGAZA_ILK_GORUNTU_HATASI };
  const BEKLENIYOR: ReturnType<typeof useMagazaTalepleri> = { talepler: [], yukleniyor: true, hata: null };
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('süre dolmadan «yükleniyor»; TAM dolunca hata — «yükleniyor» DEĞİL, liste boş, metin ne yapılacağını söyler', () => {
    const { result } = renderHook(() => useMagazaTalepleri(true));
    act(() => { vi.advanceTimersByTime(MAGAZA_ILK_GORUNTU_SURESI_MS - 1); });
    expect(result.current).toEqual(BEKLENIYOR);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toEqual(SURE_DOLDU);
    expect(MAGAZA_ILK_GORUNTU_HATASI).toBe('sunucu bu listeyi göndermedi (yetki ya da bağlantı) — sayfayı yenileyin');
    // Abonelik AÇIK kalır: geç gelen görüntü buradan gelecek.
    expect(abonelikler).toHaveLength(1);
    expect(abonelikler[0].kapandi).toBe(false);
  });

  it('GEÇ gelen görüntü hatayı siler (yavaş ama meşru abonelik kilitli kalmaz)', () => {
    const { result } = renderHook(() => useMagazaTalepleri(true));
    act(() => { vi.advanceTimersByTime(MAGAZA_ILK_GORUNTU_SURESI_MS); });
    expect(result.current).toEqual(SURE_DOLDU);
    act(() => abonelikler[0].next(goruntu([{ id: 'mt-1', veri: tamTalep }, { id: 'mt-2', veri: tamTalep }])));
    expect(result.current.yukleniyor).toBe(false);
    expect(result.current.hata).toBeNull();
    expect(result.current.talepler.map(t => t.id)).toEqual(['mt-1', 'mt-2']);
  });

  it('görüntü ZAMANINDA geldiyse süre dolunca hiçbir şey değişmez', () => {
    const { result } = renderHook(() => useMagazaTalepleri(true));
    act(() => abonelikler[0].next(goruntu([{ id: 'mt-1', veri: tamTalep }])));
    const onceki = result.current;
    act(() => { vi.advanceTimersByTime(MAGAZA_ILK_GORUNTU_SURESI_MS * 3); });
    expect(result.current).toBe(onceki);   // aynı nesne: yeniden çizim bile yok
    expect(result.current.talepler.map(t => t.id)).toEqual(['mt-1']);
  });

  it('boş görüntü de GÖRÜNTÜDÜR: «talep yok» süre dolunca hataya DÖNMEZ', () => {
    const { result } = renderHook(() => useMagazaTalepleri(true));
    act(() => abonelikler[0].next(goruntu([])));
    act(() => { vi.advanceTimersByTime(MAGAZA_ILK_GORUNTU_SURESI_MS * 3); });
    expect(result.current).toEqual({ talepler: [], yukleniyor: false, hata: null });
  });

  it('abonelik hatası ZAMANINDA geldiyse süre dolunca kendi metni EZİLMEZ', () => {
    const { result } = renderHook(() => useMagazaTalepleri(true));
    act(() => abonelikler[0].err(new Error('bağlantı koptu')));
    act(() => { vi.advanceTimersByTime(MAGAZA_ILK_GORUNTU_SURESI_MS * 3); });
    expect(result.current).toEqual({ talepler: [], yukleniyor: false, hata: 'bağlantı koptu' });
  });

  it('yetki düşünce zamanlayıcı KAPANIR: kapalıyken hata üretilmez; yeniden açılınca süre BAŞTAN sayılır', () => {
    const { result, rerender } = renderHook(({ yetkili }: { yetkili: boolean }) => useMagazaTalepleri(yetkili), { initialProps: { yetkili: true } });
    act(() => { vi.advanceTimersByTime(30_000); });
    rerender({ yetkili: false });
    expect(abonelikler[0].kapandi).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current).toEqual({ talepler: [], yukleniyor: false, hata: null });

    // 60. saniyede yeniden açıldı: ilk açılışın 90. saniyesi (buranın 30. saniyesi) hata ÜRETMEZ.
    rerender({ yetkili: true });
    expect(abonelikler).toHaveLength(2);
    expect(result.current).toEqual(BEKLENIYOR);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current).toEqual(BEKLENIYOR);
    act(() => { vi.advanceTimersByTime(MAGAZA_ILK_GORUNTU_SURESI_MS - 30_000 - 1); });
    expect(result.current).toEqual(BEKLENIYOR);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toEqual(SURE_DOLDU);
  });

  it('bileşen kaldırılınca zamanlayıcı kapanır (bekleyen zamanlayıcı KALMAZ)', () => {
    const { unmount } = renderHook(() => useMagazaTalepleri(true));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('`enabled` yanlışken zamanlayıcı HİÇ kurulmaz (beklenen bir şey yok)', () => {
    const { result } = renderHook(() => useMagazaTalepleri(false));
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(MAGAZA_ILK_GORUNTU_SURESI_MS * 3); });
    expect(result.current).toEqual({ talepler: [], yukleniyor: false, hata: null });
  });

  it('süre 90 sn ve `lib/dbClient.ts` INIT_GUARD_MS ertelemesinden UZUN (çit: erteleme uzarsa bu süre de uzatılır)', () => {
    expect(MAGAZA_ILK_GORUNTU_SURESI_MS).toBe(90_000);
    // Meşru abonelik, uçuştaki başka bir init yüzünden INIT_GUARD_MS kadar ertelenebilir; süre ondan uzun olmasaydı
    // yetkili kullanıcı da «okunamadı» görürdü. Ertelemenin değeri KAYNAKTAN okunur (sınıfın özel alanı; içe aktarılamaz).
    const es = /\bINIT_GUARD_MS = ([\d_]+);/.exec(oku(join(SRC_KOK, 'lib', 'dbClient.ts')));
    expect(es).not.toBeNull();
    const erteleme = Number((es?.[1] ?? '').replace(/_/g, ''));
    expect(erteleme).toBeGreaterThan(0);
    expect(MAGAZA_ILK_GORUNTU_SURESI_MS).toBeGreaterThan(erteleme);
  });
});

// ── 3. Adresle açılış ───────────────────────────────────────────────────────────────────────────────────────────────
describe('magazaIlkKaynakSekmesi — ?kaynak=magaza', () => {
  it('adres `?kaynak=magaza` VE rol yetkiliyse sekme «magaza»', () => {
    expect(magazaIlkKaynakSekmesi('?kaynak=magaza', true)).toBe('magaza');
    expect(magazaIlkKaynakSekmesi('kaynak=magaza', true)).toBe('magaza');
    expect(magazaIlkKaynakSekmesi('?track=abc&kaynak=magaza', true)).toBe('magaza');
  });
  it('YETKİSİZ rolde adres sekmeyi AÇMAZ', () => {
    expect(magazaIlkKaynakSekmesi('?kaynak=magaza', false)).toBe('cetpa');
  });
  it('parametre yok / başka değer / benzer ad → «cetpa»', () => {
    for (const arama of ['', '?', '?kaynak=mikro', '?kaynak=', '?kaynak=MAGAZA', '?kaynak=magaza2', '?xkaynak=magaza', '?kaynak']) {
      expect(magazaIlkKaynakSekmesi(arama, true), arama).toBe('cetpa');
    }
  });
});

// ── 4. «Yeni» sayacı — saf parçalar ─────────────────────────────────────────────────────────────────────────────────
const T = (olusturma: string) => ({ olusturma });
const SABAH = '2026-10-08T06:00:00.000Z', OGLE = '2026-10-08T09:00:00.000Z', AKSAM = '2026-10-08T15:00:00.000Z';
const ms = (iso: string) => Date.parse(iso);

describe('«yeni» sayacı — saf kurallar', () => {
  it('en büyük `olusturma`: çözülemeyenler atlanır; hiçbiri çözülemiyorsa / liste boşsa null', () => {
    expect(enBuyukOlusturmaMs([T(OGLE), T('bozuk'), T(AKSAM), T(SABAH)])).toBe(ms(AKSAM));
    expect(enBuyukOlusturmaMs([T('bozuk'), T('')])).toBeNull();
    expect(enBuyukOlusturmaMs([])).toBeNull();
  });

  it('sayı = `olusturma` > son görülen (EŞİT olan yeni DEĞİL); çözülemeyen SAYILMAZ', () => {
    const talepler = [T(SABAH), T(OGLE), T(AKSAM), T('bozuk'), T('')];
    expect(yeniTalepSayisi(talepler, ms(OGLE))).toBe(1);
    expect(yeniTalepSayisi(talepler, ms(AKSAM))).toBe(0);
    expect(yeniTalepSayisi(talepler, ms(SABAH) - 1)).toBe(3);
  });

  it('son görülen YOKSA çözülebilen bütün talepler yenidir', () => {
    expect(yeniTalepSayisi([T(SABAH), T(OGLE), T('bozuk')], null)).toBe(2);
    expect(yeniTalepSayisi([], null)).toBe(0);
  });

  it('anahtar `cetpa:magazaTalepSonGorulen:<companyId>:<uid>`; kimliklerden biri yoksa null', () => {
    expect(magazaSonGorulenAnahtari('kiraci-1', 'uid-7')).toBe('cetpa:magazaTalepSonGorulen:kiraci-1:uid-7');
    for (const [c, u] of [[null, 'uid-7'], ['kiraci-1', undefined], ['', 'uid-7'], ['kiraci-1', ''], [null, null]] as const) {
      expect(magazaSonGorulenAnahtari(c, u)).toBeNull();
    }
  });

  it('oku / yaz: gidiş-dönüş; bozuk değer → null; değer yalnız İLERİ gider', () => {
    const anahtar = 'cetpa:magazaTalepSonGorulen:k:u';
    expect(magazaSonGorulenOku(anahtar)).toBeNull();
    magazaSonGorulenYaz(anahtar, ms(OGLE));
    expect(localStorage.getItem(anahtar)).toBe(String(ms(OGLE)));
    expect(magazaSonGorulenOku(anahtar)).toBe(ms(OGLE));
    magazaSonGorulenYaz(anahtar, ms(SABAH));                      // geri çekilmez
    expect(magazaSonGorulenOku(anahtar)).toBe(ms(OGLE));
    magazaSonGorulenYaz(anahtar, NaN);                            // sonlu olmayan yazılmaz
    expect(magazaSonGorulenOku(anahtar)).toBe(ms(OGLE));
    for (const bozuk of ['abc', '', '-5', '0', 'NaN', 'Infinity']) {
      localStorage.setItem(anahtar, bozuk);
      expect(magazaSonGorulenOku(anahtar), bozuk).toBeNull();
    }
    expect(magazaSonGorulenOku(null)).toBeNull();
    magazaSonGorulenYaz(null, ms(OGLE));                          // anahtar yokken hiçbir şey yazılmaz
    expect(localStorage.length).toBe(1);
  });

  it('depolama fırlatırsa (özel pencere / kota) oku null döner, yaz SESSİZCE geçer', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(magazaSonGorulenOku('k')).toBeNull();
    expect(() => magazaSonGorulenYaz('k', 5)).not.toThrow();
  });
});

// ── 5. «Yeni» sayacı — kanca ────────────────────────────────────────────────────────────────────────────────────────
describe('useMagazaYeniSayaci', () => {
  const ANAHTAR = 'cetpa:magazaTalepSonGorulen:kiraci-1:uid-7';
  const satir = (id: string, olusturma: string): MagazaTalepSatiri => magazaTalebiDaralt(id, { ...tamTalep, olusturma });
  type P = { talepler: MagazaTalepSatiri[]; anahtar: string | null; acik: boolean };
  const kur = (ilk: P) => renderHook((p: P) => useMagazaYeniSayaci(p.talepler, p.anahtar, p.acik), { initialProps: ilk });

  it('anahtar depoda YOKSA bütün (tarihi okunan) talepler yenidir', () => {
    const { result } = kur({ talepler: [satir('a', SABAH), satir('b', OGLE), satir('c', 'bozuk')], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(2);
    expect(localStorage.getItem(ANAHTAR)).toBeNull();   // sekme açılmadan hiçbir şey «görüldü» diye yazılmaz
  });

  it('(2b) silinmiş talep «görülmemiş» SAYILMAZ (rozeti kabartmaz); ama GÖRÜLDÜ sayılır — geri alınınca yeniden «görülmemiş» olmaz', () => {
    const silinmis = (id: string, olusturma: string): MagazaTalepSatiri =>
      magazaTalebiDaralt(id, { ...tamTalep, olusturma, silindi: { zaman: AKSAM, kim: { uid: 'u', ad: 'A' }, kanal: 'erp' } });
    const { result, rerender } = kur({ talepler: [satir('a', SABAH), silinmis('b', OGLE)], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(1);                                             // yalnız canlı `a`
    // Sekme açıldı: saklanan değer BÜTÜN taleplerin en büyüğüdür (silinmiş `b` de görüldü).
    rerender({ talepler: [satir('a', SABAH), silinmis('b', OGLE)], anahtar: ANAHTAR, acik: true });
    expect(localStorage.getItem(ANAHTAR)).toBe(String(ms(OGLE)));
    // `b` geri alındı ve sekme kapandı: zaten görülmüştü, sayaç 0 kalır.
    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(0);
  });

  it('depodaki son görülenden SONRA gelenler sayılır', () => {
    localStorage.setItem(ANAHTAR, String(ms(SABAH)));
    const { result } = kur({ talepler: [satir('a', SABAH), satir('b', OGLE), satir('c', AKSAM)], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(2);
  });

  it('sekme açılınca sayı 0 olur ve saklanan değer görülenlerin EN BÜYÜK `olusturma`\'sıdır — `Date.now()` DEĞİL', () => {
    // Kullanıcının saati 2030: `Date.now()` saklansaydı sonraki bütün talepler «görülmüş» sayılırdı.
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T00:00:00.000Z'));
    const { result } = kur({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: ANAHTAR, acik: true });
    expect(result.current).toBe(0);
    expect(localStorage.getItem(ANAHTAR)).toBe(String(ms(OGLE)));
  });

  it('sekme AÇIKKEN gelen talep görülmüş sayılır; sekmeden çıkınca 0 kalır, SONRA gelen 1 olur', () => {
    const { result, rerender } = kur({ talepler: [satir('a', SABAH)], anahtar: ANAHTAR, acik: true });
    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: ANAHTAR, acik: true });   // açıkken geldi
    expect(result.current).toBe(0);
    expect(localStorage.getItem(ANAHTAR)).toBe(String(ms(OGLE)));

    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: ANAHTAR, acik: false });  // sekmeden çıktı
    expect(result.current).toBe(0);

    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE), satir('c', AKSAM)], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(1);
  });

  it('sekme açıkken gelen talep TEK ÇİZİMDE bile «yeni» görünmez (rozet yanıp sönmesin)', () => {
    const gorulen: number[] = [];
    const { rerender } = renderHook((p: P) => { const n = useMagazaYeniSayaci(p.talepler, p.anahtar, p.acik); gorulen.push(n); return n; },
      { initialProps: { talepler: [satir('a', SABAH)], anahtar: ANAHTAR, acik: true } });
    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: ANAHTAR, acik: true });
    expect(gorulen.length).toBeGreaterThanOrEqual(2);
    expect(gorulen.filter(n => n !== 0)).toEqual([]);
  });

  it('sekme açıkken sayfa yenilense de görülen talepler yeniden «yeni» sayılmaz (değer depoda)', () => {
    const talepler = [satir('a', SABAH), satir('b', OGLE)];
    kur({ talepler, anahtar: ANAHTAR, acik: true }).unmount();
    const { result } = kur({ talepler, anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(0);
  });

  it('`olusturma`\'sı çözülemeyen talep sekme açılıp kapansa da sayaca GİRMEZ ve saklanan değeri bozmaz', () => {
    const { result, rerender } = kur({ talepler: [satir('x', 'bozuk')], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(0);
    rerender({ talepler: [satir('x', 'bozuk')], anahtar: ANAHTAR, acik: true });
    expect(localStorage.getItem(ANAHTAR)).toBeNull();
    rerender({ talepler: [satir('x', 'bozuk'), satir('a', SABAH)], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(1);
  });

  it('depolama KAPALIYKEN (fırlatıyor) sayaç bu oturumda bellekten çalışır', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const { result, rerender } = kur({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(2);
    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: ANAHTAR, acik: true });
    expect(result.current).toBe(0);
    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE), satir('c', AKSAM)], anahtar: ANAHTAR, acik: false });
    expect(result.current).toBe(1);
  });

  it('anahtar yokken (kiracı / kullanıcı bilinmiyor) depoya HİÇBİR ŞEY yazılmaz; sayaç bellekten çalışır', () => {
    const { result, rerender } = kur({ talepler: [satir('a', SABAH)], anahtar: null, acik: true });
    expect(result.current).toBe(0);
    expect(localStorage.length).toBe(0);
    rerender({ talepler: [satir('a', SABAH), satir('b', OGLE)], anahtar: null, acik: false });
    expect(result.current).toBe(1);
  });

  it('başka kimliğin bellekteki «gördüm»ü bu kimliğe UYGULANMAZ (kiracı / kullanıcı değişti)', () => {
    const DIGER = 'cetpa:magazaTalepSonGorulen:kiraci-2:uid-9';
    const talepler = [satir('a', SABAH), satir('b', OGLE)];
    const { result, rerender } = kur({ talepler, anahtar: ANAHTAR, acik: true });
    expect(result.current).toBe(0);
    rerender({ talepler, anahtar: DIGER, acik: false });
    expect(result.current).toBe(2);
    expect(localStorage.getItem(DIGER)).toBeNull();
  });

  it('başka sekmenin yazdığı daha yeni değer geriye ÇEKİLMEZ', () => {
    localStorage.setItem(ANAHTAR, String(ms(AKSAM)));
    kur({ talepler: [satir('a', SABAH)], anahtar: ANAHTAR, acik: true });
    expect(localStorage.getItem(ANAHTAR)).toBe(String(ms(AKSAM)));
  });
});

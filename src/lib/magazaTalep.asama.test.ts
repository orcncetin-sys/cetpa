// @vitest-environment node
/**
 * magazaTalep.asama.test.ts — mağaza talebi ortak sözleşmesinin SAF işlevleri (dilim 2a, şartname v6 § 1 / § 7 «Saf»).
 *
 * Kilitlenen değişmezler: 6 × 6 geçiş tablosu (V5 geri alma, V12 `teslim` → `iptal` izinsiz), `iptalOncesi` çözümü,
 * `magazaIzinliGecisler` tabloyla aynı, panel sözlüğü (bilinmeyen → `null`), `magazaAcikMi` (`null` AÇIK), kalem anahtarı
 * deseni (öncü sıfır GEÇMEZ — K5), kalem teslim saf işlevleri, `magazaGuncellemeZamani` metin sırası, `bildirimGorunumu`
 * `max` kuralı (Y2) ve «Yeniden gönder» kuralı (Y1).
 */
import { describe, it, expect } from 'vitest';
import {
  MAGAZA_ACIK_ASAMALAR, MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS, MAGAZA_KALEM_ANAHTARI_DESENI, MAGAZA_TALEP_ASAMALARI,
  MAGAZA_UTC_ZAMAN_DESENI, PANEL_DURUMLARI,
  bildirimBeklemeBaslangiciMs, bildirimGorunumu, magazaAcikMi, magazaGecisi, magazaGuncellemeZamani, magazaIzinliGecisler,
  magazaKalemAnahtarlari, magazaKalemTeslimMi, magazaTeslimIsaretsiz, magazaTeslimKaynagi, magazaYenidenGonderilebilir,
  panelDurumuna, paneldenAsamaya,
  type MagazaTalepAsamasi, type MagazaGecisSonucu, type MagazaBildirim,
} from './magazaTalep';

const SIMDI = Date.parse('2026-10-09T12:00:00.000Z');
const once = (dakika: number): string => new Date(SIMDI - dakika * 60_000).toISOString();

describe('aşama kümesi ve açıklık', () => {
  it('altı saklı aşama; dört açık aşama', () => {
    expect([...MAGAZA_TALEP_ASAMALARI]).toEqual(['yeni', 'teyit', 'hazirlaniyor', 'sevk', 'teslim', 'iptal']);
    expect([...MAGAZA_ACIK_ASAMALAR]).toEqual(['yeni', 'teyit', 'hazirlaniyor', 'sevk']);
  });
  it('`magazaAcikMi`: `null` → true (bilinmeyen satır KAYBOLMAZ); teslim / iptal → false; dört açık → true', () => {
    expect(magazaAcikMi(null)).toBe(true);
    expect(magazaAcikMi('teslim')).toBe(false);
    expect(magazaAcikMi('iptal')).toBe(false);
    for (const a of MAGAZA_ACIK_ASAMALAR) expect(magazaAcikMi(a), a).toBe(true);
  });
});

describe('panel sözlüğü', () => {
  it('`yeni` ↔ `alindi`; diğerleri aynen', () => {
    expect(panelDurumuna('yeni')).toBe('alindi');
    expect(paneldenAsamaya('alindi')).toBe('yeni');
    for (const a of MAGAZA_TALEP_ASAMALARI.filter(a => a !== 'yeni')) {
      expect(panelDurumuna(a)).toBe(a);
      expect(paneldenAsamaya(a)).toBe(a);
    }
    expect([...PANEL_DURUMLARI]).toEqual(['alindi', 'teyit', 'hazirlaniyor', 'sevk', 'teslim', 'iptal']);
  });
  it('bilinmeyen / `bilinmiyor` / saklanan `yeni` / çöp → null (alindi\'ye ÇEVRİLMEZ)', () => {
    for (const v of ['bilinmiyor', 'yeni', 'ALINDI', '', 7, null, undefined, {}, ['alindi']]) expect(paneldenAsamaya(v), String(v)).toBeNull();
  });
});

describe('geçiş tablosu — magazaGecisi 6 × 6', () => {
  type Hucre = '—' | 'açıklama' | 'ileri' | 'geri' | 'iptal' | '✻';
  const TABLO: Record<MagazaTalepAsamasi, Record<MagazaTalepAsamasi, Hucre>> = {
    yeni:         { yeni: 'açıklama', teyit: 'ileri',    hazirlaniyor: '—',        sevk: '—',        teslim: '—',     iptal: 'iptal' },
    teyit:        { yeni: 'geri',     teyit: 'açıklama', hazirlaniyor: 'ileri',    sevk: '—',        teslim: '—',     iptal: 'iptal' },
    hazirlaniyor: { yeni: '—',        teyit: 'geri',     hazirlaniyor: 'açıklama', sevk: 'ileri',    teslim: '—',     iptal: 'iptal' },
    sevk:         { yeni: '—',        teyit: '—',        hazirlaniyor: 'geri',     sevk: 'açıklama', teslim: 'ileri', iptal: 'iptal' },
    teslim:       { yeni: '—',        teyit: '—',        hazirlaniyor: '—',        sevk: 'geri',     teslim: 'açıklama', iptal: '—' },
    iptal:        { yeni: '✻',        teyit: '✻',        hazirlaniyor: '✻',        sevk: '✻',        teslim: '—',     iptal: 'açıklama' },
  };
  const beklenen = (h: Hucre, onceki: MagazaTalepAsamasi, iptalOncesi: unknown, yeni: MagazaTalepAsamasi): MagazaGecisSonucu => {
    if (h === '—') return { izinli: false };
    if (h === 'açıklama') return { izinli: true, tur: 'aciklama' };
    if (h === 'ileri') return { izinli: true, tur: 'ileri' };
    if (h === 'geri') return { izinli: true, tur: 'geri' };
    if (h === 'iptal') return { izinli: true, tur: 'iptal', iptalOncesi: onceki as Exclude<MagazaTalepAsamasi, 'teslim' | 'iptal'> };
    return iptalOncesi === yeni ? { izinli: true, tur: 'iptalden-donus', iptalOncesi: null } : { izinli: false };
  };
  it('tablo birebir — `iptalOncesi` yokken iptalden dönüş İZİNSİZ', () => {
    for (const onceki of MAGAZA_TALEP_ASAMALARI) for (const yeni of MAGAZA_TALEP_ASAMALARI) {
      expect(magazaGecisi(onceki, yeni, undefined), `${onceki} → ${yeni}`).toEqual(beklenen(TABLO[onceki][yeni], onceki, undefined, yeni));
    }
  });
  it('iptalden dönüş yalnız `iptalOncesi` ile AYNI sütuna; `teslim` / `iptal` / çöp değer YOK sayılır', () => {
    for (const hedef of MAGAZA_ACIK_ASAMALAR) {
      for (const yeni of MAGAZA_TALEP_ASAMALARI) {
        expect(magazaGecisi('iptal', yeni, hedef), `iptal(${hedef}) → ${yeni}`).toEqual(beklenen(TABLO.iptal[yeni], 'iptal', hedef, yeni));
      }
    }
    for (const kotu of ['teslim', 'iptal', 'çöp', 7, null, {}, ['sevk']]) {
      for (const yeni of MAGAZA_ACIK_ASAMALAR) expect(magazaGecisi('iptal', yeni, kotu), `${String(kotu)} → ${yeni}`).toEqual({ izinli: false });
    }
  });
  it('`teslim` → `iptal` İZİNSİZ (V12); `teslim` → `sevk` → `iptal` iki adımla mümkün', () => {
    expect(magazaGecisi('teslim', 'iptal', undefined)).toEqual({ izinli: false });
    expect(magazaGecisi('teslim', 'sevk', undefined)).toEqual({ izinli: true, tur: 'geri' });
    expect(magazaGecisi('sevk', 'iptal', undefined)).toEqual({ izinli: true, tur: 'iptal', iptalOncesi: 'sevk' });
  });
  it('aynı aşama `iptalOncesi`ne DOKUNMAZ (`iptal` → `iptal` dâhil); iptal → geri al → yeniden iptal izinli, üzerine yazılır', () => {
    expect(magazaGecisi('iptal', 'iptal', 'sevk')).toEqual({ izinli: true, tur: 'aciklama' });
    expect('iptalOncesi' in magazaGecisi('sevk', 'sevk', undefined)).toBe(false);
    const donus = magazaGecisi('iptal', 'hazirlaniyor', 'hazirlaniyor');
    expect(donus).toEqual({ izinli: true, tur: 'iptalden-donus', iptalOncesi: null });
    expect(magazaGecisi('hazirlaniyor', 'iptal', null)).toEqual({ izinli: true, tur: 'iptal', iptalOncesi: 'hazirlaniyor' });
  });
  it('`magazaIzinliGecisler` her aşama için tabloyla aynı (kendisi hariç)', () => {
    expect(magazaIzinliGecisler('yeni', undefined)).toEqual(['teyit', 'iptal']);
    expect(magazaIzinliGecisler('teyit', undefined)).toEqual(['yeni', 'hazirlaniyor', 'iptal']);
    expect(magazaIzinliGecisler('hazirlaniyor', undefined)).toEqual(['teyit', 'sevk', 'iptal']);
    expect(magazaIzinliGecisler('sevk', undefined)).toEqual(['hazirlaniyor', 'teslim', 'iptal']);
    expect(magazaIzinliGecisler('teslim', undefined)).toEqual(['sevk']);
    expect(magazaIzinliGecisler('iptal', undefined)).toEqual([]);
    expect(magazaIzinliGecisler('iptal', 'teyit')).toEqual(['teyit']);
    expect(magazaIzinliGecisler('iptal', 'teslim')).toEqual([]);
    for (const onceki of MAGAZA_TALEP_ASAMALARI) {
      const tablo = MAGAZA_TALEP_ASAMALARI.filter(y => y !== onceki && TABLO[onceki][y] !== '—' && TABLO[onceki][y] !== '✻');
      expect(magazaIzinliGecisler(onceki, undefined), onceki).toEqual(tablo);
    }
  });
});

describe('kalem anahtarı deseni (K5)', () => {
  it('geçer: `b:0`, `b:9999`, `t:` + 12 küçük onaltılık', () => {
    for (const a of ['b:0', 'b:1', 'b:42', 'b:9999', 't:0123456789ab', 't:ffffffffffff']) expect(MAGAZA_KALEM_ANAHTARI_DESENI.test(a), a).toBe(true);
  });
  it('geçmez: öncü sıfır, aralık dışı, yanlış önek / büyük harf / uzunluk, boş', () => {
    for (const a of ['b:01', 'b:001', 'b:007', 'b:0001', 'b:', 'b:10000', 't:0123456789a', 't:0123456789abc', 't:0123456789AB', 'c:0', 'B:0', '', 'b:0 ', ' b:0', 'b:-1', 'b:1.0'])
      expect(MAGAZA_KALEM_ANAHTARI_DESENI.test(a), JSON.stringify(a)).toBe(false);
  });
});

describe('kalem teslim saf işlevleri', () => {
  const kalemler = [{ ad: 'a' }, { ad: 'b' }, { ad: 'c' }];
  const giris = (durum: 'teslim' | 'bekliyor', zaman = once(1)) => ({ durum, zaman, kim: { uid: 'u', ad: 'U' } });

  it('`magazaTeslimKaynagi`: teyit yok / nesne değil / boş dizi → beyan; boş olmayan dizi → teyit', () => {
    expect(magazaTeslimKaynagi({ kalemler })).toBe('beyan');
    expect(magazaTeslimKaynagi({ kalemler, teyit: 'çöp' })).toBe('beyan');
    expect(magazaTeslimKaynagi({ kalemler, teyit: { kalemler: [] } })).toBe('beyan');
    expect(magazaTeslimKaynagi({ kalemler, teyit: { kalemler: 'çöp' } })).toBe('beyan');
    expect(magazaTeslimKaynagi({ kalemler, teyit: { kalemler: [{ anahtar: 't:0123456789ab' }] } })).toBe('teyit');
  });
  it('`magazaKalemAnahtarlari`: 3 beyan → b:0..b:2; dizi değilse []; teyitte anahtarlar kalem sırasıyla (dizge olmayan atlanır)', () => {
    expect(magazaKalemAnahtarlari({ kalemler })).toEqual(['b:0', 'b:1', 'b:2']);
    expect(magazaKalemAnahtarlari({ kalemler: 'çöp' })).toEqual([]);
    expect(magazaKalemAnahtarlari({})).toEqual([]);
    expect(magazaKalemAnahtarlari({ kalemler, teyit: { kalemler: [{ anahtar: 't:bbbbbbbbbbbb' }, { anahtar: 't:aaaaaaaaaaaa' }, { anahtar: 7 }] } }))
      .toEqual(['t:bbbbbbbbbbbb', 't:aaaaaaaaaaaa']);
  });
  it('`magazaKalemTeslimMi`: giriş yok → false; bekliyor → false; teslim → true; nesne olmayan kalemTeslim → false, fırlatmaz', () => {
    expect(magazaKalemTeslimMi({}, 'b:0')).toBe(false);
    expect(magazaKalemTeslimMi({ 'b:0': giris('bekliyor') }, 'b:0')).toBe(false);
    expect(magazaKalemTeslimMi({ 'b:0': giris('teslim') }, 'b:0')).toBe(true);
    for (const cop of ['x', 7, null, undefined, ['b:0'], { 'b:0': 'teslim' }, { 'b:0': { durum: 'TESLIM' } }]) expect(magazaKalemTeslimMi(cop, 'b:0'), String(cop)).toBe(false);
  });
  it('`magazaTeslimIsaretsiz`: kaynak − işaretli; öbür kaynağın anahtarındaki işaret SAYILMAZ; 60 kalem + 3 işaret → 57', () => {
    expect(magazaTeslimIsaretsiz({ kalemler })).toBe(3);
    expect(magazaTeslimIsaretsiz({ kalemler, kalemTeslim: { 'b:1': giris('teslim'), 'b:2': giris('bekliyor') } })).toBe(2);
    // beyan kaynağında `t:` işareti, teyit kaynağında `b:` işareti sayılmaz
    expect(magazaTeslimIsaretsiz({ kalemler, kalemTeslim: { 't:0123456789ab': giris('teslim') } })).toBe(3);
    expect(magazaTeslimIsaretsiz({ kalemler, teyit: { kalemler: [{ anahtar: 't:0123456789ab' }] }, kalemTeslim: { 'b:0': giris('teslim'), 'b:1': giris('teslim') } })).toBe(1);
    const altmis = Array.from({ length: 60 }, (_, i) => ({ ad: `k${i}` }));
    expect(magazaTeslimIsaretsiz({ kalemler: altmis, kalemTeslim: { 'b:0': giris('teslim'), 'b:30': giris('teslim'), 'b:59': giris('teslim') } })).toBe(57);
    expect(magazaTeslimIsaretsiz({ kalemler, kalemTeslim: 'çöp' })).toBe(3);
  });
  it('`magazaGuncellemeZamani`: durumZamani yokken olusturma; kalem zamanı daha yeniyse o; bekliyor girişi de kapsanır; metin sırası', () => {
    const olusturma = once(100), durumZamani = once(50);
    expect(magazaGuncellemeZamani({ olusturma })).toBe(olusturma);
    expect(magazaGuncellemeZamani({ olusturma, durumZamani })).toBe(durumZamani);
    expect(magazaGuncellemeZamani({ olusturma, durumZamani, kalemTeslim: { 'b:0': giris('teslim', once(70)) } })).toBe(durumZamani);
    expect(magazaGuncellemeZamani({ olusturma, durumZamani, kalemTeslim: { 'b:0': giris('teslim', once(10)) } })).toBe(once(10));
    expect(magazaGuncellemeZamani({ olusturma, durumZamani, kalemTeslim: { 'b:0': giris('bekliyor', once(5)), 'b:1': giris('teslim', once(20)) } })).toBe(once(5));
    expect(magazaGuncellemeZamani({ olusturma, kalemTeslim: { 'b:0': giris('teslim', once(10)) } })).toBe(once(10));
  });
  it('`magazaGuncellemeZamani`: biçime uymayan / `+03:00` ekli değer yok sayılır; `etiketBasildi.zaman` formüle GİRMEZ', () => {
    const olusturma = once(100), durumZamani = once(50);
    expect(magazaGuncellemeZamani({ olusturma, durumZamani: '2099-01-01T00:00:00+03:00' })).toBe(olusturma);
    expect(magazaGuncellemeZamani({ olusturma, durumZamani, kalemTeslim: { 'b:0': giris('teslim', '2099-01-01T00:00:00+03:00'), 'b:1': giris('teslim', 'bozuk'), 'b:2': 'çöp' } })).toBe(durumZamani);
    expect(magazaGuncellemeZamani({ olusturma, durumZamani, kalemTeslim: 7 })).toBe(durumZamani);
    expect(magazaGuncellemeZamani({ olusturma: 'bozuk' })).toBe('bozuk');
    expect(magazaGuncellemeZamani({ olusturma: 'bozuk', kalemTeslim: { 'b:0': giris('teslim', once(10)) } })).toBe(once(10));
    // etiket zamanı formülde yok: tipte alan bile yok, olsa da okunmaz
    expect(magazaGuncellemeZamani({ olusturma, durumZamani, ...{ etiketBasildi: { zaman: once(0) } } })).toBe(durumZamani);
    expect(MAGAZA_UTC_ZAMAN_DESENI.test(once(0))).toBe(true);
    expect(MAGAZA_UTC_ZAMAN_DESENI.test('2026-10-09T12:00:00Z')).toBe(false);
  });
});

describe('bildirim rozeti — `bildirimGorunumu(b, taban, simdiMs)` (K17, Y2) ve «Yeniden gönder» (Y1)', () => {
  const b = (durum: MagazaBildirim['durum'], zaman: string, ek: Partial<MagazaBildirim> = {}): MagazaBildirim => ({ durum, zaman, ...ek });

  it('sınır: tam 10 dakika hâlâ taze; 1 ms sonrası uyarı (olusturma = zaman)', () => {
    const x = b('bekliyor', once(0));
    expect(bildirimGorunumu(x, once(0), SIMDI + MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS)).toEqual({ tur: 'gonderiliyor' });
    expect(bildirimGorunumu(x, once(0), SIMDI + MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS + 1)).toEqual({ tur: 'uyari', neden: 'bekleme-asildi' });
  });
  it('`max` kuralı: 40 dk önceki talep + 1 dk önceki deneme → «gönderiliyor» (dilim 1\'in `min` sabiti TERSİNE)', () => {
    expect(bildirimGorunumu(b('bekliyor', once(1)), once(40), SIMDI)).toEqual({ tur: 'gonderiliyor' });
    expect(bildirimBeklemeBaslangiciMs(b('bekliyor', once(1)), once(40))).toBe(SIMDI - 60_000);
  });
  it('elle gönderim sonrası: 1 gün önceki talep + `zaman` şimdi → «gönderiliyor», düğme YOK; 11 dk önce → bekleme aşıldı, düğme VAR', () => {
    const taze = bildirimGorunumu(b('bekliyor', once(0)), once(24 * 60), SIMDI);
    expect(taze).toEqual({ tur: 'gonderiliyor' });
    expect(magazaYenidenGonderilebilir(taze)).toBe(false);
    const eski = bildirimGorunumu(b('bekliyor', once(11)), once(24 * 60), SIMDI);
    expect(eski).toEqual({ tur: 'uyari', neden: 'bekleme-asildi' });
    expect(magazaYenidenGonderilebilir(eski)).toBe(true);
  });
  it('biri çözülmüyorsa diğeri; ikisi de çözülmüyorsa `okunamadi` (düğme YOK)', () => {
    expect(bildirimGorunumu(b('bekliyor', ''), once(3), SIMDI)).toEqual({ tur: 'gonderiliyor' });
    expect(bildirimGorunumu(b('bekliyor', once(3)), 'bozuk', SIMDI)).toEqual({ tur: 'gonderiliyor' });
    expect(bildirimGorunumu(b('bekliyor', once(3)), undefined, SIMDI)).toEqual({ tur: 'gonderiliyor' });
    const okunamadi = bildirimGorunumu(b('bekliyor', ''), 'bozuk', SIMDI);
    expect(okunamadi).toEqual({ tur: 'uyari', neden: 'okunamadi' });
    expect(magazaYenidenGonderilebilir(okunamadi)).toBe(false);
    expect(bildirimBeklemeBaslangiciMs(b('bekliyor', ''), 'bozuk')).toBeNull();
    // gevşek biçim («1» → 2001) çözülmüş sayılmaz
    expect(bildirimGorunumu(b('bekliyor', '1'), '2026-10-09', SIMDI)).toEqual({ tur: 'uyari', neden: 'okunamadi' });
  });
  it('kesin durumlar saate bakmaz; `deneme`li bekliyor yalnız süreye bakar', () => {
    expect(bildirimGorunumu(b('gitti', once(899)), once(900), SIMDI)).toEqual({ tur: 'isaretsiz' });
    expect(bildirimGorunumu(b('gonderilemedi', once(0)), once(0), SIMDI)).toEqual({ tur: 'uyari', neden: 'gonderilemedi' });
    expect(bildirimGorunumu(b('yapilandirilmamis', once(0)), once(0), SIMDI)).toEqual({ tur: 'uyari', neden: 'yapilandirilmamis' });
    expect(bildirimGorunumu(b('bekliyor', once(9), { deneme: 3 }), once(40), SIMDI)).toEqual({ tur: 'gonderiliyor' });
    expect(bildirimGorunumu(b('bekliyor', once(11), { deneme: 3 }), once(40), SIMDI)).toEqual({ tur: 'uyari', neden: 'bekleme-asildi' });
  });
  it('`b` null / undefined → okunamadi (dilim 1 davranışı: rozet uyarı, düğme yok); bilinmeyen durum da okunamadi', () => {
    expect(bildirimGorunumu(null, once(0), SIMDI)).toEqual({ tur: 'uyari', neden: 'okunamadi' });
    expect(bildirimGorunumu(undefined, once(0), SIMDI)).toEqual({ tur: 'uyari', neden: 'okunamadi' });
    expect(bildirimGorunumu({ durum: 'gerekmiyor' as MagazaBildirim['durum'], zaman: once(0) }, once(0), SIMDI)).toEqual({ tur: 'uyari', neden: 'okunamadi' });
  });
  it('`magazaYenidenGonderilebilir`: gonderilemedi / yapilandirilmamis / bekleme-asildi → true; gitti / gonderiliyor / okunamadi → false', () => {
    expect(magazaYenidenGonderilebilir({ tur: 'uyari', neden: 'gonderilemedi' })).toBe(true);
    expect(magazaYenidenGonderilebilir({ tur: 'uyari', neden: 'yapilandirilmamis' })).toBe(true);
    expect(magazaYenidenGonderilebilir({ tur: 'uyari', neden: 'bekleme-asildi' })).toBe(true);
    expect(magazaYenidenGonderilebilir({ tur: 'uyari', neden: 'okunamadi' })).toBe(false);
    expect(magazaYenidenGonderilebilir({ tur: 'isaretsiz' })).toBe(false);
    expect(magazaYenidenGonderilebilir({ tur: 'gonderiliyor' })).toBe(false);
    // uçtan uca: talep satırından
    expect(magazaYenidenGonderilebilir(bildirimGorunumu(b('gonderilemedi', once(5)), once(60), SIMDI))).toBe(true);
    expect(magazaYenidenGonderilebilir(bildirimGorunumu(b('gitti', once(5)), once(60), SIMDI))).toBe(false);
    expect(magazaYenidenGonderilebilir(bildirimGorunumu(null, once(60), SIMDI))).toBe(false);
  });
});

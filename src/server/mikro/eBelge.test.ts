import { describe, it, expect } from 'vitest';
import { eBelgeTutarAnahtari, eBelgeNormalize, eBelgeleriNormalize, cariHareketYonOzeti } from './eBelge';

describe('eBelgeTutarAnahtari — ödenecek tutarın kolonu: en-spesifikten-genele, yan tutarlar DIŞLANIR', () => {
  it('KDV / iskonto / matrah / Guid kolonları toplam sanılmaz (eski gevşek /tutar|meblag|toplam/ ilk eşleşeni alıyordu) — mutasyon-ayırt-edici', () => {
    expect(eBelgeTutarAnahtari(['kdv_tutar', 'iskonto_toplam', 'matrah_tutar', 'tutar_Guid', 'odenecek_tutar'])).toBe('odenecek_tutar');
    expect(eBelgeTutarAnahtari(['KdvTutari', 'GenelToplam'])).toBe('GenelToplam');
  });
  it('öncelik: ödenecek > genel toplam > toplam > meblağ > tutar', () => {
    expect(eBelgeTutarAnahtari(['tutar', 'meblag', 'toplam', 'genel_toplam', 'odenecek'])).toBe('odenecek');
    expect(eBelgeTutarAnahtari(['tutar', 'cha_meblag'])).toBe('cha_meblag');
    expect(eBelgeTutarAnahtari(['fatura_tutar'])).toBe('fatura_tutar');
  });
  it('"KDV/vergi DÂHİL" toplam yan tutar DEĞİLDİR — ödenecek tutarın ta kendisidir', () => {
    expect(eBelgeTutarAnahtari(['kdv_tutar', 'kdv_dahil_toplam'])).toBe('kdv_dahil_toplam');
    expect(eBelgeTutarAnahtari(['vergi_tutari', 'VergiDahilTutar'])).toBe('VergiDahilTutar');
    expect(eBelgeTutarAnahtari(['kdv_haric_tutar', 'kdv_tutar'])).toBeNull(); // hariç = matrah, ödenecek değil
  });
  it('yalnız yan tutarlar varsa anahtar YOK (uydurulmaz)', () => {
    expect(eBelgeTutarAnahtari(['kdv_tutar', 'iskonto_tutar', 'ara_toplam'])).toBeNull();
    expect(eBelgeTutarAnahtari([])).toBeNull();
  });
});

describe('eBelgeNormalize — eBelgeler şeması', () => {
  const satir = { fatura_no: 'GIB2026000000123', ettn: '7b1f-uuid', cari_unvan: 'ŞİRİN İNŞAAT LTD. ŞTİ.', vkn: '1234567890',
    kdv_tutar: 3000, odenecek_tutar: 18000, fatura_tarihi: '2026-09-12T00:00:00', durum: 'Onaylandı' };

  it('sayfa paritesi: bilinen satırda alanlar eskiyle aynı, tutar ÖDENECEK tutardır', () => {
    const { kayit, bilinmeyen } = eBelgeNormalize(satir, 'e-fatura', 'gelen');
    expect(kayit).toEqual({
      belgeNo: 'GIB2026000000123', uuid: '7b1f-uuid', alici: 'ŞİRİN İNŞAAT LTD. ŞTİ.', vergiNo: '1234567890',
      tutar: 18000, belgeDate: '2026-09-12', tur: 'e-fatura', yon: 'gelen', durum: 'Onaylandı', kaynak: 'mikro', raw: satir,
    });
    expect(bilinmeyen).toEqual([]);
  });

  it('tutar kolonu yoksa / değer okunamıyorsa `tutar` HİÇ yazılmaz — eski kod ₺0 yazıyordu (mutasyon-ayırt-edici)', () => {
    const { tutar: _t, odenecek_tutar: _o, ...tutarsiz } = { ...satir, tutar: undefined };
    const a = eBelgeNormalize(tutarsiz, 'e-fatura', 'gelen');
    expect('tutar' in a.kayit).toBe(false);
    expect(a.bilinmeyen).toEqual(['tutar']);
    const b = eBelgeNormalize({ ...satir, odenecek_tutar: null }, 'e-arsiv', 'giden');
    expect('tutar' in b.kayit).toBe(false);
    const c = eBelgeNormalize({ ...satir, odenecek_tutar: 'abc' }, 'e-arsiv', 'giden');
    expect('tutar' in c.kayit).toBe(false);
  });

  it('bilinen ₺0 (istisna belgesi) gerçek 0 olarak yazılır; sayısal metin kabul', () => {
    expect(eBelgeNormalize({ ...satir, odenecek_tutar: 0 }, 'e-fatura', 'gelen').kayit.tutar).toBe(0);
    expect(eBelgeNormalize({ ...satir, odenecek_tutar: '1250.50' }, 'e-fatura', 'gelen').kayit.tutar).toBe(1250.5);
  });
});

describe('eBelgeleriNormalize — toplu çeviri + okuma arızası', () => {
  const s = (tutar: unknown) => ({ fatura_no: 'F1', ettn: 'u', genel_toplam: tutar });
  it('kısmi bilinmeyen sayılır, arıza DEĞİL', () => {
    const r = eBelgeleriNormalize([s(100), s(null), s(300), s(400), s(500)], 'e-fatura', 'gelen');
    expect(r.kayitlar).toHaveLength(5);
    expect(r.tutarsiz).toBe(1);
    expect(r.okumaArizasi).toBe(false);
    expect(r.not).toBe('1 belgenin tutarı okunamadı');
  });
  it('≥ 5 belgenin TAMAMINDA tutar okunamıyorsa veri değil OKUMA ARIZASI (kolon adı değişmiş)', () => {
    const r = eBelgeleriNormalize([s(null), s(null), s(null), s(null), s(null)], 'e-fatura', 'gelen');
    expect(r.okumaArizasi).toBe(true);
    expect(r.not).toMatch(/^UYARI: tutar hiçbir belgede okunamadı/);
  });
  it('e-İRSALİYE sevk belgesidir, ödenecek tutarı OLMAZ: tutarsızlık ne arıza ne not üretir (her çekişte yanlış alarm olurdu)', () => {
    const r = eBelgeleriNormalize([s(null), s(null), s(null), s(null), s(null), s(null)], 'e-irsaliye', 'giden');
    expect(r.okumaArizasi).toBe(false);
    expect(r.not).toBeNull();
    expect(r.kayitlar).toHaveLength(6);
  });
  it('az satırda (< 5) tamamı bilinmese de arıza ilan edilmez; hepsi biliniyorsa not yok', () => {
    expect(eBelgeleriNormalize([s(null), s(null)], 'e-fatura', 'gelen').okumaArizasi).toBe(false);
    expect(eBelgeleriNormalize([s(10), s(20)], 'e-fatura', 'gelen').not).toBeNull();
  });
});

describe('cariHareketYonOzeti — import notu', () => {
  it('cha_tip 0 = borç, 1 = alacak; okunamayan yön borç SAYILMAZ (eski `?? 0` hepsini borç yazıyordu) — mutasyon-ayırt-edici', () => {
    expect(cariHareketYonOzeti([{ cha_tip: 0 }, { cha_tip: '0' }, { cha_tip: 1 }, { cha_tip: null }, {}]))
      .toBe('2 borç / 1 alacak hareketi · 2 hareketin yönü okunamadı');
  });
  it('hepsi biliniyorsa eski metinle birebir', () => {
    expect(cariHareketYonOzeti([{ cha_tip: 0 }, { cha_tip: 1 }, { cha_tip: 1 }])).toBe('1 borç / 2 alacak hareketi');
  });
});

/** gibDurum — GİB / alıcı durumu tek kaynağı (fatura 389: 2002 «Fatura red edildi», canlı ölçüm 2026-10-02). */
import { describe, it, expect } from 'vitest';
import { gibDurumCoz, gibRedMi, gibDurumKesin, gibReddedildi, taramaKarari, faturaEttn, GIB_RED_KODU } from './gibDurum';

const E = 'BBBBBBBB-1111-2222-3333-444444444444';
const BUGUN = new Date('2026-10-02T09:00:00Z');
const RED = { BelgeDurumKodu: '2002', BelgeDurumAciklamasi: 'Fatura red edildi', ZarfDurumKodu: '1001', ZarfDurumAciklamasi: 'Zarf gönderildi', GIBDurumKodu: '1300', GIBDurumAciklamasi: 'BAŞARIYLA TAMAMLANDI' };
const fatura = (o: Record<string, unknown> = {}) => ({ cha_tip: '0', cha_ebelge_Islemturu: '1', cha_uuid: E, cha_tarihi: '2026-09-29T00:00:00', ...o });

describe('gibDurumCoz', () => {
  it('ölçülen yanıt biçimi aynen çözülür; 2002 red, 2001/2002 kesin, 1002 kesin değil', () => {
    const d = gibDurumCoz(RED, 0);
    expect(d).toEqual({ belgeKodu: '2002', belgeAciklama: 'Fatura red edildi', zarfKodu: '1001', zarfAciklama: 'Zarf gönderildi', gibKodu: '1300', gibAciklama: 'BAŞARIYLA TAMAMLANDI', eBelgeTipi: 0 });
    expect(GIB_RED_KODU).toBe('2002');
    expect(gibRedMi({ belgeKodu: '2002' })).toBe(true);
    expect(['2001', '1002', '1006', ''].map(belgeKodu => gibRedMi({ belgeKodu }))).toEqual([false, false, false, false]);
    expect(['2001', '2002', '1002', '1006'].map(belgeKodu => gibDurumKesin({ belgeKodu }))).toEqual([true, true, false, false]);
  });
  it('e-Arşiv yanıtında zarf/GİB alanları boş gelir — boş metin, uydurma yok; sayı kod metne çevrilir', () => {
    expect(gibDurumCoz({ BelgeDurumKodu: 1006, BelgeDurumAciklamasi: 'e-Arşiv faturası imzalandı', ZarfDurumKodu: '', GIBDurumKodu: null }, 1))
      .toEqual({ belgeKodu: '1006', belgeAciklama: 'e-Arşiv faturası imzalandı', zarfKodu: '', zarfAciklama: '', gibKodu: '', gibAciklama: '', eBelgeTipi: 1 });
  });
  it('belge kodu yoksa / Data nesne değilse durum BİLİNMİYOR (null) — boş kayıt yazılmaz', () => {
    for (const v of [null, undefined, 'metin', [], {}, { BelgeDurumKodu: '' }, { Durum: 'x', DurumKodu: '5' }]) expect(gibDurumCoz(v, 0)).toBeNull();
  });
});

describe('gibReddedildi', () => {
  it('yalnız açık `gibRed === true`; bayrak yoksa ya da başka değerse reddedilmiş SAYILMAZ', () => {
    expect(gibReddedildi({ gibRed: true })).toBe(true);
    for (const v of [false, undefined, null, 'true', 1]) expect(gibReddedildi({ gibRed: v })).toBe(false);
    expect(gibReddedildi({ gibDurum: { belgeKodu: '2002' } })).toBe(false);          // bayrak TARAMANIN işi; okuyan türetmez
  });
});

describe('taramaKarari', () => {
  it('satış + geçerli ETTN + tür biliniyor → sorulur; e-Fatura tip 0, e-Arşiv tip 1', () => {
    expect(taramaKarari(fatura(), BUGUN)).toEqual({ aday: { ettn: E, eBelgeTipi: 0 } });
    expect(taramaKarari(fatura({ cha_ebelge_Islemturu: '2' }), BUGUN)).toEqual({ aday: { ettn: E, eBelgeTipi: 1 } });
  });
  it('alış, türü bilinmeyen satış, ETTN\'siz / sıfır ETTN sorulmaz — nedenleri ayrı', () => {
    expect(taramaKarari(fatura({ cha_tip: '1' }), BUGUN)).toEqual({ atla: 'satis-degil' });
    expect(taramaKarari(fatura({ cha_tip: undefined }), BUGUN)).toEqual({ atla: 'satis-degil' });
    expect(taramaKarari(fatura({ cha_ebelge_Islemturu: '0' }), BUGUN)).toEqual({ atla: 'tur-bilinmiyor' });
    expect(taramaKarari(fatura({ cha_uuid: '' }), BUGUN)).toEqual({ atla: 'ettn-yok' });
    expect(taramaKarari(fatura({ cha_uuid: '00000000-0000-0000-0000-000000000000' }), BUGUN)).toEqual({ atla: 'ettn-yok' });
    expect(taramaKarari(fatura({ cha_uuid: `${E}' OR 1=1` }), BUGUN)).toEqual({ atla: 'ettn-yok' });
  });
  it('kesin durum (kabul / red) bir daha sorulmaz; kesin olmayan yalnız 45 günlük pencerede yenilenir', () => {
    expect(taramaKarari(fatura({ gibDurum: { belgeKodu: '2002' } }), BUGUN)).toEqual({ atla: 'kesin' });
    expect(taramaKarari(fatura({ gibDurum: { belgeKodu: '2001' } }), BUGUN)).toEqual({ atla: 'kesin' });
    expect(taramaKarari(fatura({ gibDurum: { belgeKodu: '1002' } }), BUGUN)).toEqual({ aday: { ettn: E, eBelgeTipi: 0 } });
    expect(taramaKarari(fatura({ gibDurum: { belgeKodu: '1002' }, cha_tarihi: '2026-08-18T00:00:00' }), BUGUN)).toEqual({ aday: { ettn: E, eBelgeTipi: 0 } });   // tam 45 gün
    expect(taramaKarari(fatura({ gibDurum: { belgeKodu: '1002' }, cha_tarihi: '2026-08-17T00:00:00' }), BUGUN)).toEqual({ atla: 'eski' });
    expect(taramaKarari(fatura({ gibDurum: { belgeKodu: '1002' }, cha_tarihi: null }), BUGUN)).toEqual({ atla: 'eski' });
  });
  it('kesinlik SORULAN ETTN içindir: kayıt yeni ETTN ile yeniden gönderildiyse eski red/kabul geçersiz → yeniden sorulur', () => {
    const YENI = 'CCCCCCCC-1111-2222-3333-444444444444';
    expect(taramaKarari(fatura({ cha_uuid: YENI, gibRed: true, gibDurum: { belgeKodu: '2002', ettn: E.toLowerCase() } }), BUGUN)).toEqual({ aday: { ettn: YENI, eBelgeTipi: 0 } });
    expect(taramaKarari(fatura({ gibRed: true, gibDurum: { belgeKodu: '2002', ettn: E.toLowerCase() } }), BUGUN)).toEqual({ atla: 'kesin' });   // aynı belge
    expect(taramaKarari(fatura({ cha_uuid: YENI, gibDurum: { belgeKodu: '2002' } }), BUGUN)).toEqual({ atla: 'kesin' });                       // ettn yazılmamış eski kayıt
  });
  it('durumu HİÇ yazılmamış fatura yaşına bakılmadan bir kez sorulur (ilk dolum); boş kodlu kayıt "yazılmamış" sayılır', () => {
    expect(taramaKarari(fatura({ cha_tarihi: '2025-05-06T00:00:00' }), BUGUN)).toEqual({ aday: { ettn: E, eBelgeTipi: 0 } });
    expect(taramaKarari(fatura({ cha_tarihi: '2025-05-06T00:00:00', gibDurum: { belgeKodu: '' } }), BUGUN)).toEqual({ aday: { ettn: E, eBelgeTipi: 0 } });
  });
  it('ETTN kolonu harf duyarsız okunur; Mikro\'nun süslü parantezi soyulur (yoksa HER fatura "ETTN\'siz" elenirdi)', () => {
    expect(faturaEttn({ CHA_UUID: ` ${E} ` })).toBe(E);
    expect(faturaEttn({ cha_uuid: `{${E}}` })).toBe(E);
    expect(taramaKarari(fatura({ cha_uuid: `{${E}}` }), BUGUN)).toEqual({ aday: { ettn: E, eBelgeTipi: 0 } });
    expect(faturaEttn({})).toBe('');
  });
});

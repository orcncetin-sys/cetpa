/** gibDurumTara — satış e-belgelerinin GİB durumunu sorup işler (389 → 2002 «Fatura red edildi», 2026-10-02). */
import { describe, it, expect, vi } from 'vitest';
import { gibDurumTara, taramaNotu, type TaramaFaturasi } from './gibDurumTarama';

const E = (n: number) => `BBBBBBBB-1111-2222-3333-${String(n).padStart(12, '0')}`;
const f = (sira: number, o: Record<string, unknown> = {}): TaramaFaturasi => ({
  id: `G${sira}`, cha_tip: '0', cha_ebelge_Islemturu: '1', cha_uuid: E(sira), cha_evrakno_seri: '', cha_evrakno_sira: sira,
  cha_tarihi: `2026-09-${String(sira % 28 + 1).padStart(2, '0')}T00:00:00`, ...o,
});
const yanit = (kod: string, aciklama = '') => ({ ok: true, status: 200, data: { result: [{ StatusCode: 200, IsError: false, ErrorMessage: null, Data: { BelgeDurumKodu: kod, BelgeDurumAciklamasi: aciklama } }] } });
const T0 = Date.parse('2026-10-02T09:00:00Z');
const kur = (faturalar: TaramaFaturasi[], sorgula: (ettn: string, tip: 0 | 1, ms: number) => Promise<{ ok: boolean; status: number; data: unknown }>, butceMs = 600000, adimMs = 400) => {
  let saat = T0;
  const yazilan: Array<{ id: string; alanlar: Record<string, unknown> }> = [];
  const sorgu = vi.fn(async (ettn: string, tip: 0 | 1, ms: number) => { saat += adimMs; return sorgula(ettn, tip, ms); });
  return { yazilan, sorgu, calistir: () => gibDurumTara({ faturalar, sorgula: sorgu, yaz: async (id, alanlar) => { yazilan.push({ id, alanlar }); }, simdi: () => saat, butceMs }) };
};

describe('gibDurumTara', () => {
  it('reddedilen fatura (2002) gibRed:true yazılır; kabul/zarflandı gibRed:false; yalnız iki alan yazılır', async () => {
    const d = kur([f(389), f(396), f(384, { cha_ebelge_Islemturu: '2' })], async ettn =>
      ettn === E(389) ? yanit('2002', 'Fatura red edildi') : ettn === E(384) ? yanit('1006', 'e-Arşiv faturası imzalandı') : yanit('1002', 'Fatura zarflandı'));
    const s = await d.calistir();
    expect(s).toMatchObject({ aday: 3, soruldu: 3, red: 1, yeniRed: 1, kalan: 0, hata: 0, kodlar: { '2002': 1, '1002': 1, '1006': 1 }, yeniRedEvraklar: ['389'] });
    const y389 = d.yazilan.find(y => y.id === 'G389');
    expect(y389?.alanlar).toMatchObject({ gibRed: true, gibDurum: { belgeKodu: '2002', belgeAciklama: 'Fatura red edildi', eBelgeTipi: 0, ettn: E(389).toLowerCase() } });
    expect(Object.keys(y389?.alanlar ?? {}).sort()).toEqual(['gibDurum', 'gibRed']);
    expect(d.yazilan.filter(y => y.alanlar.gibRed === false).map(y => y.id).sort()).toEqual(['G384', 'G396']);
    // e-Arşiv tip 1 ile, e-Fatura tip 0 ile sorulur.
    expect(d.sorgu.mock.calls.find(c => c[0] === E(384))?.[1]).toBe(1);
    expect(d.sorgu.mock.calls.find(c => c[0] === E(389))?.[1]).toBe(0);
  });

  it('alış, türü bilinmeyen, ETTN\'siz ve durumu KESİN fatura sorulmaz; nedenler sayılır', async () => {
    const d = kur([f(1, { cha_tip: '1' }), f(2, { cha_ebelge_Islemturu: '0' }), f(3, { cha_uuid: '' }), f(4, { gibDurum: { belgeKodu: '2002' }, gibRed: true }), f(5)], async () => yanit('1002'));
    const s = await d.calistir();
    expect(s.atlanan).toEqual({ 'satis-degil': 1, 'tur-bilinmiyor': 1, 'ettn-yok': 1, kesin: 1 });
    expect(d.sorgu).toHaveBeenCalledTimes(1);
    expect(d.yazilan.map(y => y.id)).toEqual(['G5']);                          // reddedilmiş (kesin) faturaya DOKUNULMAZ
  });

  it('hata / "bulunamadı" / zaman aşımı: hiçbir şey YAZILMAZ (önceki durum korunur), sayılır, tarama sürer', async () => {
    const d = kur([f(10), f(11), f(12), f(13)], async ettn => {
      if (ettn === E(10)) return { ok: true, status: 200, data: { result: [{ IsError: true, ErrorMessage: 'İlgili e-belge bulunamadı!', Data: null }] } };
      if (ettn === E(11)) throw Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' });
      if (ettn === E(12)) return { ok: true, status: 200, data: { result: [{ IsError: false, Data: { Durum: 'x' } }] } };   // beklenen alan yok
      return yanit('2001');
    });
    const s = await d.calistir();
    expect(s).toMatchObject({ soruldu: 1, hata: 3, kodlar: { '2001': 1 } });
    expect(d.yazilan.map(y => y.id)).toEqual(['G13']);
    expect(s.ilkHata).toMatch(/^1[0-2]: /);
  });

  it('süre bütçesi dolunca DURUR ve kalanı sayar; en YENİ fatura önce sorulur', async () => {
    const d = kur([f(1), f(20), f(9), f(15)], async () => yanit('1002'), 6000, 2500);   // her çağrı 2,5 sn; 6 sn bütçe
    const s = await d.calistir();
    expect(s.soruldu).toBe(1);
    expect(s.kalan).toBe(3);
    expect(d.sorgu.mock.calls[0][0]).toBe(E(20));                                    // 2026-09-21 en yeni
    expect(d.sorgu.mock.calls[0][2]).toBeLessThanOrEqual(6000);                      // çağrı zaman aşımı kalan bütçeyi aşmaz
  });

  it('DEVRE KESİCİ: art arda 3 çağrı fırlarsa tarama durur, kalan sayılır; IsError yanıtı kesiciyi tetiklemez', async () => {
    const zamanAsimi = () => { throw Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }); };
    const d = kur([f(1), f(2), f(3), f(4), f(5), f(6)], async () => zamanAsimi());
    const s = await d.calistir();
    expect(d.sorgu).toHaveBeenCalledTimes(3);
    expect(s).toMatchObject({ soruldu: 0, hata: 3, kalan: 3, kesildi: true });
    expect(taramaNotu(s)).toContain('Mikro art arda yanıt vermedi');
    const bulunamadi = { ok: true, status: 200, data: { result: [{ IsError: true, ErrorMessage: 'İlgili e-belge bulunamadı!', Data: null }] } };
    const d2 = kur([f(1), f(2), f(3), f(4), f(5)], async () => bulunamadi);
    const s2 = await d2.calistir();
    expect(d2.sorgu).toHaveBeenCalledTimes(5);                                 // Mikro yanıt veriyor → kesici atmaz
    expect(s2).toMatchObject({ hata: 5, kalan: 0, kesildi: false });
  });

  it('aynı ETTN\'yi taşıyan iki doküman (aynı numaralı iki başlık) TEK kez sorulur, sonuç ikisine de yazılır', async () => {
    const d = kur([f(246, { id: 'G246a' }), f(246, { id: 'G246b' })], async () => yanit('2002'));
    const s = await d.calistir();
    expect(d.sorgu).toHaveBeenCalledTimes(1);
    expect(d.yazilan.map(y => y.id).sort()).toEqual(['G246a', 'G246b']);
    expect(s.red).toBe(2);
  });

  it('reddedilen evrak YENİ ETTN ile yeniden gönderildiyse yeniden sorulur; kabul edildiyse red bayrağı düşer', async () => {
    const d = kur([f(389, { cha_uuid: E(900), gibRed: true, gibDurum: { belgeKodu: '2002', ettn: E(389).toLowerCase() } })], async () => yanit('2001'));
    const s = await d.calistir();
    expect(d.sorgu.mock.calls[0][0]).toBe(E(900));
    expect(s).toMatchObject({ soruldu: 1, redKalkti: 1 });
    expect(d.yazilan[0].alanlar).toMatchObject({ gibRed: false, gibDurum: { belgeKodu: '2001', ettn: E(900).toLowerCase() } });
  });

  it('önceden reddedilmiş (kesin değil diye işaretlenmemiş eski kayıt) artık reddedilmiş değilse sayılır ve bayrak düşer', async () => {
    const d = kur([f(7, { gibRed: true, gibDurum: { belgeKodu: '' } })], async () => yanit('2001'));
    const s = await d.calistir();
    expect(s.redKalkti).toBe(1);
    expect(d.yazilan[0].alanlar.gibRed).toBe(false);
  });
});

describe('taramaNotu', () => {
  it('özet: sorulan, reddedilen (yeni evraklar), kalan, hata, kod dağılımı', () => {
    const not = taramaNotu({ aday: 9, soruldu: 5, red: 2, yeniRed: 1, redKalkti: 0, kalan: 3, kesildi: false, hata: 1, ilkHata: '12: HTTP 500', kodlar: { '2002': 2, '1002': 3 },
      atlanan: { 'tur-bilinmiyor': 4, 'satis-degil': 300 }, yeniRedEvraklar: ['389'] });
    expect(not).toBe('5 belge soruldu · 2 reddedilmiş (1 yeni: 389) · 3 belge süre dolduğu için sorulamadı — yeniden çalıştırın · ⚠ 1 sorgu başarısız (ilki: 12: HTTP 500) · 4 türü bilinmeyen satış faturası sorulmadı · kodlar: 1002×3, 2002×2');
  });
  it('hiç aday yoksa da anlamlı', () => {
    expect(taramaNotu({ aday: 0, soruldu: 0, red: 0, yeniRed: 0, redKalkti: 0, kalan: 0, kesildi: false, hata: 0, ilkHata: null, kodlar: {}, atlanan: { kesin: 12 }, yeniRedEvraklar: [] })).toBe('0 belge soruldu');
  });
});

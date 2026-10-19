/**
 * faturaDurumu.gonderim.test.ts — e-Fatura gönderim işaretinin istemci kuralları, SAF tablo (2026-10-17, şartname
 * «e-Fatura çift kesim» § 7.4 B5 + B8'in yardımcı kolu). Mevcut `faturaDurumu.test.ts` AYNEN yeşil kalır (eski kurallar).
 *
 * Tablo: {işaret yok, taze gonderiliyor, bayat gonderiliyor, gonderildi, numarasız gonderildi, reddedildi, belirsiz} ×
 * {`mikroFaturasiKesilmisOlabilir`, `mikroyaFaturaGonderilebilir`, `faturaSonucuCozulebilir`, rozet metni, takip tablosu,
 * «Fatura Kes» düğmesi `faturaKesilebilir` (inceleme 1, İ1-3)}.
 * Eşik SABİTTEN okunur (sayı yazılmaz).
 */
import { describe, it, expect } from 'vitest';
import {
  faturaKesilebilir, faturaSonucuCozulebilir, faturaTakipFaturaVar, mikroFaturaDurumMetni, mikroFaturasiKesilmisOlabilir, mikroyaFaturaGonderilebilir,
  lucayaAktarildi,
} from './faturaDurumu';
import { FATURA_GONDERIM_BAYATLIK_MS, faturaGonderimDurumu, faturaIsareti, gonderimBayatMi } from '../../lib/faturaGonderimi';
import { MAGAZA_KAYNAGI } from '../../lib/magazaKaynagi';

const SIMDI = Date.parse('2026-10-17T10:00:00.000Z');
const isaret = (durum: string, ek: Record<string, unknown> = {}, zamanMs = SIMDI - 1_000) =>
  ({ mikroFaturaGonderimi: { durum, istekNo: 'i-1', zaman: new Date(zamanMs).toISOString(), kim: 'satis@example.test', ...ek } });

type Satir = [ad: string, girdi: Record<string, unknown>, kesilmisOlabilir: boolean, gonderilebilir: boolean, cozulebilir: boolean, metin: string | null, faturaKesilebilir: boolean];
const TABLO: Satir[] = [
  ['işaret yok', {}, false, true, false, null, true],
  ['taze gonderiliyor', isaret('gonderiliyor'), true, false, false, 'Fatura gönderiliyor', false],
  ['bayat gonderiliyor', isaret('gonderiliyor', {}, SIMDI - FATURA_GONDERIM_BAYATLIK_MS - 1_000), true, false, true, 'Fatura sonucu bilinmiyor', false],
  ['gonderildi (numaralı)', { ...isaret('gonderildi', { numara: 'CTP1' }), mikroFaturaNo: 'CTP1' }, true, false, false, null, false],
  ['numarasız gonderildi', isaret('gonderildi'), true, false, false, 'Fatura kesildi (numara okunamadı)', false],
  ['reddedildi', isaret('reddedildi'), false, true, false, 'Mikro reddetti', true],
  ['belirsiz', isaret('belirsiz'), true, false, true, 'Fatura sonucu bilinmiyor', false],
];

describe('B5 — işaret × kural tablosu (tek yüklem: mikroFaturasiKesilmisOlabilir)', () => {
  it.each(TABLO)('%s', (_ad, girdi, kesilmis, gonderilebilir, cozulebilir, metin, kesilebilir) => {
    expect(mikroFaturasiKesilmisOlabilir(girdi, SIMDI)).toBe(kesilmis);
    expect(mikroyaFaturaGonderilebilir(girdi, SIMDI)).toBe(gonderilebilir);
    // `mikroyaFaturaGonderilebilir`, kesilmiş-olabilir yükleminin olumsuzunu öteki koşullarıyla birleştirir (iki liste yok).
    expect(mikroyaFaturaGonderilebilir(girdi, SIMDI)).toBe(!mikroFaturasiKesilmisOlabilir(girdi, SIMDI));
    expect(faturaSonucuCozulebilir(girdi, SIMDI)).toBe(cozulebilir);
    expect(mikroFaturaDurumMetni(girdi, 'tr', SIMDI)).toBe(metin);
    // «Fatura Kes» (Muhasebe'ye götüren düğme): Mikro faturası kesilmiş OLABİLEN siparişte de çizilmez (İ1-3).
    expect(faturaKesilebilir(girdi, SIMDI)).toBe(kesilebilir);
  });

  it('bayatlık eşiği sabitten: eşik − 1 sn taze, eşik + 1 sn bayat (D5)', () => {
    const taze = isaret('gonderiliyor', {}, SIMDI - FATURA_GONDERIM_BAYATLIK_MS + 1_000);
    const bayat = isaret('gonderiliyor', {}, SIMDI - FATURA_GONDERIM_BAYATLIK_MS - 1_000);
    expect(faturaGonderimDurumu(taze, SIMDI)).toBe('gonderiliyor');
    expect(faturaGonderimDurumu(bayat, SIMDI)).toBe('belirsiz');
    const bozukZaman = { mikroFaturaGonderimi: { durum: 'gonderiliyor', istekNo: 'x', zaman: 'dün', kim: '' } };
    const okunan = faturaIsareti(bozukZaman);
    if (!okunan) throw new Error('işaret okunamadı');
    expect(gonderimBayatMi(okunan, SIMDI)).toBe(true);   // zamanı okunamayan işaret bayattır (güvenli yön)
  });

  it('işaret biçimi: JSON null, dizi, bilinmeyen durum → işaret YOK sayılır (gönderilebilir — sunucu talebiyle aynı)', () => {
    for (const ham of [null, [], 'gonderildi', { durum: 'uydurma' }]) {
      expect(faturaIsareti({ mikroFaturaGonderimi: ham }), JSON.stringify(ham)).toBeNull();
      expect(mikroyaFaturaGonderilebilir({ mikroFaturaGonderimi: ham }, SIMDI)).toBe(true);
    }
  });

  it('eski kurallar korunur: numara / ETTN dolu, MF, mağaza, faturasız → gönderilemez; `hasInvoice` engellemez', () => {
    expect(mikroyaFaturaGonderilebilir({ mikroFaturaNo: '383' }, SIMDI)).toBe(false);
    expect(mikroyaFaturaGonderilebilir({ mikroFaturaNo: '   ' }, SIMDI)).toBe(true);
    expect(mikroyaFaturaGonderilebilir({ ettn: '8c1f7a54-2c4e-4b7b-9b1a-0d3f5e6a7b8c' }, SIMDI)).toBe(false);   // sunucu D1 ile aynı
    expect(mikroyaFaturaGonderilebilir({ source: 'mikro-fatura' }, SIMDI)).toBe(false);
    expect(mikroyaFaturaGonderilebilir({ source: MAGAZA_KAYNAGI }, SIMDI)).toBe(false);
    expect(mikroyaFaturaGonderilebilir({ faturali: false }, SIMDI)).toBe(false);
    expect(mikroyaFaturaGonderilebilir({ hasInvoice: true }, SIMDI)).toBe(true);
    // Reddedilen MF / mağaza siparişi yine kapalı (işaret öteki koşulları açmaz).
    expect(mikroyaFaturaGonderilebilir({ ...isaret('reddedildi'), source: MAGAZA_KAYNAGI }, SIMDI)).toBe(false);
  });

  it('LB (2026-10-19, «takip kodu + LUCA reddi») — LUCA\'ya Cetpa\'dan aktarılmış sipariş Mikro\'ya gönderilemez (sunucu talebiyle aynı ölçüt)', () => {
    // Sunucu: `(data->'lucaSynced') IS DISTINCT FROM 'true'::jsonb AND btrim(coalesce(data->>'lucaFaturaNo','')) = ''`.
    expect(mikroyaFaturaGonderilebilir({ lucaSynced: true }, SIMDI)).toBe(false);
    expect(mikroyaFaturaGonderilebilir({ lucaFaturaNo: 'LF-2026-0001' }, SIMDI)).toBe(false);
    expect(mikroyaFaturaGonderilebilir({ lucaSynced: true, hasInvoice: true }, SIMDI)).toBe(false);
    expect(mikroyaFaturaGonderilebilir({ lucaSynced: false }, SIMDI)).toBe(true);
    expect(mikroyaFaturaGonderilebilir({ lucaFaturaNo: '   ' }, SIMDI)).toBe(true);
    expect(mikroyaFaturaGonderilebilir({ lucaFaturaNo: '' }, SIMDI)).toBe(true);
    expect(lucayaAktarildi({ lucaSynced: true })).toBe(true);
    expect(lucayaAktarildi({ lucaFaturaNo: 'L1' })).toBe(true);
    expect(lucayaAktarildi({})).toBe(false);
    expect(lucayaAktarildi(null)).toBe(false);
    // `reddedildi` işareti LUCA kapısını açmaz.
    expect(mikroyaFaturaGonderilebilir({ ...isaret('reddedildi'), lucaSynced: true }, SIMDI)).toBe(false);
  });

  it('numara yalnız işarette kaldıysa rozet numarayı gösterir (uydurma yok); İngilizce metinler', () => {
    expect(mikroFaturaDurumMetni(isaret('gonderildi', { numara: 'CTP9' }), 'tr', SIMDI)).toBe('Fatura kesildi (No: CTP9)');
    expect(mikroFaturaDurumMetni(isaret('belirsiz'), 'en', SIMDI)).toBe('Invoice result unknown');
    expect(mikroFaturaDurumMetni(null, 'tr', SIMDI)).toBeNull();
  });
});

describe('B8 (yardımcı) — Muhasebe e-Fatura takip tablosu «faturası var» yüklemi', () => {
  it('gonderiliyor / belirsiz / numarasız gonderildi «Fatura yok» SAYILMAZ; reddedildi ve işaretsiz sayılır; eski üç alan aynen', () => {
    expect(faturaTakipFaturaVar(isaret('gonderiliyor'), SIMDI)).toBe(true);
    expect(faturaTakipFaturaVar(isaret('belirsiz'), SIMDI)).toBe(true);
    expect(faturaTakipFaturaVar(isaret('gonderiliyor', {}, SIMDI - FATURA_GONDERIM_BAYATLIK_MS - 1_000), SIMDI)).toBe(true);
    expect(faturaTakipFaturaVar(isaret('gonderildi'), SIMDI)).toBe(true);
    expect(faturaTakipFaturaVar(isaret('reddedildi'), SIMDI)).toBe(false);
    expect(faturaTakipFaturaVar({}, SIMDI)).toBe(false);
    expect(faturaTakipFaturaVar({ hasInvoice: true }, SIMDI)).toBe(true);
    expect(faturaTakipFaturaVar({ mikroFaturaNo: 'M1' }, SIMDI)).toBe(true);
    expect(faturaTakipFaturaVar({ lucaFaturaNo: 'L1' }, SIMDI)).toBe(true);
  });
});

/** İptal Edilen Faturalar (Mikro) — 2026-09-25: yalnız listelenir; okuma hatası "iptal yok" gibi SESSİZ kalmaz. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import IptalEdilenFaturalar, { iptalFaturaYonu } from './IptalEdilenFaturalar';

let dinleyici: { next: (s: unknown) => void; err: (e: Error) => void } | null = null;
let abonelik = 0;
vi.mock('../../lib/dbClient', () => ({
  collection: (_db: unknown, ad: string) => ({ ad }),
  query: (c: unknown) => c,
  onSnapshot: (_q: unknown, next: (s: unknown) => void, err: (e: Error) => void) => { abonelik++; dinleyici = { next, err }; return () => {}; },
}));
vi.mock('../../firebase', () => ({ db: {}, auth: { currentUser: null } }));

beforeEach(() => { dinleyici = null; abonelik = 0; });
const goruntu = (satirlar: Record<string, unknown>[]) => ({ docs: satirlar.map((v, i) => ({ id: `g${i}`, data: () => v })) });

describe('IptalEdilenFaturalar', () => {
  it('yön cha_tip\'ten (0 satış, diğer alış); okunamazsa null — UYDURULMAZ', () => {
    expect(iptalFaturaYonu({ cha_tip: 0 })).toBe('satis');
    expect(iptalFaturaYonu({ cha_tip: 1 })).toBe('alis');
    expect(iptalFaturaYonu({})).toBeNull();
  });
  it('satırlar tarih azalan; evrak no, yön, cari, tutar; "hiçbir hesaba dahil değildir" notu', async () => {
    render(<IptalEdilenFaturalar dil="tr" rol="Accounting" />);
    dinleyici!.next(goruntu([
      { cha_evrakno_seri: '', cha_evrakno_sira: 381, cha_tarihi: '2026-08-02T00:00:00', cha_tip: 0, cha_kod: '120 01', cha_meblag: 1200 },
      { cha_evrakno_seri: 'A', cha_evrakno_sira: 12, cha_tarihi: '2026-09-01T00:00:00', cha_tip: 1, cha_kod: '320 05', cha_meblag: 500 },
    ]));
    const satirlar = await screen.findAllByRole('row');
    expect(satirlar[1].textContent).toContain('A12');       // en yeni önce
    expect(satirlar[1].textContent).toContain('Alış');
    expect(satirlar[2].textContent).toContain('381');
    expect(satirlar[2].textContent).toContain('Satış');
    expect(screen.getByText(/HİÇBİRİNE dahil değildir/)).toBeTruthy();
  });
  // İnceleme 2026-09-25 (CONFIRMED): sunucu yetkisiz koleksiyonu SSE'den SESSİZCE ayıklar, hata geri çağrısı tetiklenmez —
  // liste sonsuza dek "Yükleniyor…" kalıyordu. Yetkisiz rol için abonelik AÇILMAZ, mesaj basılır.
  it('yetkisiz rol (Sales / B2B) için abonelik AÇILMAZ ve "yetkiniz yok" yazılır — "Yükleniyor" DEĞİL', () => {
    for (const rol of ['Sales', 'B2B', null]) {
      const { unmount } = render(<IptalEdilenFaturalar dil="tr" rol={rol} />);
      expect(screen.getByText(/Bu listeyi görme yetkiniz yok/)).toBeTruthy();
      expect(screen.queryByText(/Yükleniyor/)).toBeNull();
      unmount();
    }
    expect(abonelik).toBe(0);
  });
  it('yetkili rolde okuma hatası (bağlantı vb.) ekranda yazılır — boş liste gibi davranmaz', async () => {
    render(<IptalEdilenFaturalar dil="tr" rol="Manager" />);
    dinleyici!.err(new Error('bağlantı koptu'));
    expect(await screen.findByRole('alert')).toHaveTextContent('İptal edilen faturalar okunamadı: bağlantı koptu');
  });
  it("bilinmeyen tarih / tutar / evrak no '—' basılır (₺0 ya da boş değil)", async () => {
    render(<IptalEdilenFaturalar dil="tr" rol="Admin" />);
    dinleyici!.next(goruntu([{ cha_tip: 0, cha_kod: '120 01', cha_meblag: null, cha_tarihi: null }]));
    const satir = (await screen.findAllByRole('row'))[1];
    expect(satir.textContent).not.toMatch(/₺0/);
    expect((satir.textContent?.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

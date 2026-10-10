/**
 * faturaUstBilgisi.test.ts — fatura detay pencerelerinin üst bilgisi: Fatura No · Belge No · Tarih (2026-10-10).
 *
 * Kullanıcı isteği: «fatura detay ekranlarına tarih ve fatura no + belge no ekle.» Bu dosya iki saf işlevi sabitler:
 *   • `faturaTarihMetni` — `MikroFaturaDetay` ve Muhasebe «Fatura / Sipariş Detayı» AYNI kuralla tarih basar;
 *   • `faturaUstBilgisi` — sipariş satırından açılan pencerenin üç alanı (belge no yalnız TEKİL eşleşen Mikro başlığından).
 * Son blok bağlantı çitidir: yardımcı yazılıp sayfaya BAĞLANMAMIŞ kalmasın («yazıldı ama bağlanmadı» arıza sınıfı).
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'path';
import { faturaTarihMetni, faturaUstBilgisi } from './faturaUstBilgisi';
import { tarihYaz } from '../zaman';
import { kodSatirlari, SRC_KOK } from '../../test/kaynakTarama';

describe('faturaTarihMetni — GG.AA.YYYY; çözülemeyen HAM, boş "—"', () => {
  it.each([
    ['YYYY-AA-GG', '2026-08-31', '31.08.2026'],
    ['GG.AA.YYYY (zaten biçimli)', '31.08.2026', '31.08.2026'],
    ['tek haneli gün / ay', '1.9.2026', '01.09.2026'],
    ['çevresinde boşluk', ' 2026-08-31 ', '31.08.2026'],
  ])('%s', (_ad, girdi, beklenen) => {
    expect(faturaTarihMetni(girdi)).toBe(beklenen);
  });

  it('salt tarih YEREL gün kurulur — ay başı / yıl başı bir gün geri KAYMAZ (UTC gece yarısı tuzağı)', () => {
    // Tuzak yalnız UTC'nin BATISINDA ayırt edilir: +03 (İstanbul) ve UTC'de `Date.parse('2026-01-01')` de aynı güne düşer,
    // test çözücü ne olursa olsun geçiyordu (inceleme 2026-10-10). Süreç dilimi test süresince Pasifik'e alınır (deyim:
    // server/kanal/magazaBildirim.test.ts); böylece test makinenin diliminden bağımsız AYNI şeyi sınar.
    vi.stubEnv('TZ', 'America/Los_Angeles');
    try {
      // Tuzak KURULU mu: dilim değişmediyse test boşa geçmesin, DÜŞSÜN. Ölçüldü: `--pool=threads` altında TZ ataması etkisiz
      // (iş parçacığının ortam kopyası süreç dilimini değiştirmez) ve bu satır düşer; varsayılan havuzda (ayrı süreç) geçer.
      const utcGeceYarisi = new Date('2026-01-01');
      expect([utcGeceYarisi.getFullYear(), utcGeceYarisi.getMonth(), utcGeceYarisi.getDate()]).toEqual([2025, 11, 31]);
      expect(utcGeceYarisi.toLocaleDateString('tr-TR')).toBe('31.12.2025');     // ekran biçimleyicisi de yeni dilimi görüyor

      expect(faturaTarihMetni('2026-01-01')).toBe('01.01.2026');
      expect(faturaTarihMetni('2026-03-01')).toBe('01.03.2026');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('ayna tuzak: yerel gün UTC ile BİÇİMLENMEZ — UTC\'nin doğusunda bir gün geri kaymaz', () => {
    // Üstteki test yalnız «UTC diye çöz, yerelde oku» hatasını yakalar; tersi (yerel günü UTC ile biçimlemek) UTC'nin
    // DOĞUSUNDA ayırt edilir (delta incelemesi 2026-10-10). Ayrı `it`: önceki sabitleme `finally` ile geri alınmış olur.
    vi.stubEnv('TZ', 'Europe/Istanbul');
    try {
      expect(new Date(2026, 0, 1).toISOString().slice(0, 10)).toBe('2025-12-31');   // tuzak kurulu mu
      expect(faturaTarihMetni('2026-01-01')).toBe('01.01.2026');
      expect(faturaTarihMetni('01.01.2026')).toBe('01.01.2026');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ['boş metin', ''],
    ['yalnız boşluk', '   '],
    ['null', null],
    ['undefined', undefined],
  ])("%s → '—' (bugünün tarihi UYDURULMAZ)", (_ad, girdi) => {
    expect(faturaTarihMetni(girdi)).toBe('—');
  });

  it("çözülemeyen metin ham basılır; '—' girdisi '—' kalır", () => {
    expect(faturaTarihMetni('tarih okunamadı')).toBe('tarih okunamadı');
    expect(faturaTarihMetni('—')).toBe('—');
  });
});

describe('faturaUstBilgisi — sipariş satırından açılan «Fatura / Sipariş Detayı»', () => {
  const baslik = (faturaNo: string, belgeNo: string | undefined, yon: 'gelen' | 'giden' = 'giden') => ({ faturaNo, belgeNo, yon });
  /** Faturadan türetilen sipariş (POST /api/mikro/import/faturadan-siparis): numara `mikroEvrak`ta, tarih `orderDate`te. */
  const mf = { source: 'mikro-fatura', mikroEvrak: { seri: '', sira: '246' }, mikroFaturaNo: '246', orderDate: '2026-04-30', createdAt: '2026-04-30T12:00:00.000Z' };

  it('MF siparişi, TEKİL eşleşen giden başlık: belge no başlıktan, tarih fatura tarihi (orderDate)', () => {
    expect(faturaUstBilgisi(mf, [baslik('246', 'CET2026000000246'), baslik('247', 'CET2026000000247')]))
      .toEqual({ faturaNo: '246', belgeNo: 'CET2026000000246', tarih: '30.04.2026' });
  });

  it('serili evrak: başlığın faturaNo biçimi `SERİ-SIRA` (mapMikroFatura ile aynı birleşim)', () => {
    const serili = { ...mf, mikroEvrak: { seri: 'A', sira: '12' }, mikroFaturaNo: 'A12' };
    expect(faturaUstBilgisi(serili, [baslik('A-12', 'X-1'), baslik('12', 'YANLIŞ')]).belgeNo).toBe('X-1');
    expect(faturaUstBilgisi(serili, [baslik('A-12', 'X-1')]).faturaNo).toBe('A12');     // fatura no listedeki ifadeyle AYNI kalır
  });

  it("aynı numaralı İKİ giden başlık (canlıda giden 246): belirsiz → '—' («muhtemelen budur» diye seçilmez)", () => {
    expect(faturaUstBilgisi(mf, [baslik('246', 'CET-A'), baslik('246', 'CET-B')]).belgeNo).toBe('—');
  });

  it("başlık yok (rol okuyamıyor / fatura listede değil): '—'", () => {
    expect(faturaUstBilgisi(mf, []).belgeNo).toBe('—');
    expect(faturaUstBilgisi(mf, [baslik('999', 'BAŞKA')]).belgeNo).toBe('—');
  });

  it('yön süzülür: aynı numaralı GELEN (alış) fatura sayılmaz — türetilen sipariş satış faturasıdır', () => {
    // Alış ve satış aynı evrak numarasını kullanabiliyor (seri boş): tedarikçinin belge no'su satışa YAZILMAZ.
    expect(faturaUstBilgisi(mf, [baslik('246', 'TEDARIKCI-246', 'gelen')]).belgeNo).toBe('—');
    expect(faturaUstBilgisi(mf, [baslik('246', 'TEDARIKCI-246', 'gelen'), baslik('246', 'CET-246')]).belgeNo).toBe('CET-246');
  });

  it("eşleşen başlığın belge no'su boş (Mikro'da boş / eski doküman): '—'", () => {
    expect(faturaUstBilgisi(mf, [baslik('246', undefined)]).belgeNo).toBe('—');
    expect(faturaUstBilgisi(mf, [baslik('246', '   ')]).belgeNo).toBe('—');
  });

  it("native sipariş (Cetpa'dan kesilen fatura): belge no '—' — numarası başlıkla çakışsa bile; tarih mikroFaturaDate", () => {
    const native = { mikroFaturaNo: '246', mikroFaturaDate: '19.09.2026', createdAt: '2026-09-17T08:00:00.000Z' };
    expect(faturaUstBilgisi(native, [baslik('246', 'CET-246')])).toEqual({ faturaNo: '246', belgeNo: '—', tarih: '19.09.2026' });
  });

  it('faturası olmayan native sipariş: fatura no "—", tarih listedeki ifade (createdAt ?? syncedAt)', () => {
    const olusturma = '2026-09-17T08:00:00.000Z';
    expect(faturaUstBilgisi({ createdAt: olusturma }, [])).toEqual({ faturaNo: '—', belgeNo: '—', tarih: tarihYaz(olusturma) });
    expect(faturaUstBilgisi({ syncedAt: olusturma }, []).tarih).toBe(tarihYaz(olusturma));
    expect(faturaUstBilgisi({}, []).tarih).toBe('—');                      // hiçbiri yok → '—' (bugün DEĞİL)
  });

  it('orderDate yalnız faturadan türetilen siparişte FATURA tarihidir; native siparişte kullanılmaz', () => {
    const olusturma = '2026-09-17T08:00:00.000Z';
    expect(faturaUstBilgisi({ orderDate: '2020-01-01', createdAt: olusturma }, []).tarih).toBe(tarihYaz(olusturma));
  });

  it('MF siparişinde orderDate yoksa (fatura tarihi okunamamış) listedeki ifadeye düşer', () => {
    const olusturma = '2026-09-17T08:00:00.000Z';
    expect(faturaUstBilgisi({ ...mf, orderDate: undefined, createdAt: olusturma }, []).tarih).toBe(tarihYaz(olusturma));
  });

  it('fatura no önceliği: mikroFaturaNo → lucaFaturaNo → irsaliyeNo', () => {
    expect(faturaUstBilgisi({ mikroFaturaNo: 'M1', lucaFaturaNo: 'L1', irsaliyeNo: 'I1' }, []).faturaNo).toBe('M1');
    expect(faturaUstBilgisi({ lucaFaturaNo: 'L1', irsaliyeNo: 'I1' }, []).faturaNo).toBe('L1');
    expect(faturaUstBilgisi({ irsaliyeNo: 'I1' }, []).faturaNo).toBe('I1');
  });
});

// ── BAĞLANTI ÇİTİ ────────────────────────────────────────────────────────────────────────────────────────────────────
// Sayfa testte çizilemiyor (giriş + canlı veri). Yardımcının pencereye GERÇEKTEN bağlı olduğu kaynaktan doğrulanır:
// üç satır sırayla ve Müşteri satırından ÖNCE; eski satır içi fatura no hesabı pencerede kalmadı (taşındı, yinelenmez).
describe('MuhasebePage «Fatura / Sipariş Detayı» üst bilgiyi yardımcıdan basar', () => {
  const satirlar = kodSatirlari(join(SRC_KOK, 'pages', 'MuhasebePage.tsx'));
  const satirNo = (parca: string): number => {
    const bulunan = satirlar.filter(s => s.kod.includes(parca));
    if (bulunan.length !== 1) throw new Error(`"${parca}" ${bulunan.length} kod satırında geçiyor (1 bekleniyordu)`);
    return bulunan[0].n;
  };

  it('yardımcı pencerenin siparişi ve sayfadaki mikroFaturalar ile çağrılır', () => {
    expect(satirNo('faturaUstBilgisi(d, mikroFaturalar)')).toBeGreaterThan(0);
  });

  it('üç satır sırayla, Müşteri satırından önce; etiketler ortak sözlükten', () => {
    // TAM eşitlik: üç satır KOŞULSUZ çizilir (D6 — '—' gizlenmez). Alt metin araması `{x && satir564(…)}` ya da üçlü ifade
    // sarmalını kaçırıyordu: «Belge No» boşken satırı gizleyen bir değişiklik çitten geçerdi (inceleme 2026-10-10).
    const kosulsuzSatirNo = (cagri: string): number => {
      const bulunan = satirlar.filter(s => s.kod.trim() === `{${cagri}}`);
      if (bulunan.length !== 1) throw new Error(`"{${cagri}}" ${bulunan.length} kod satırında tek başına duruyor (1 bekleniyordu)`);
      return bulunan[0].n;
    };
    const faturaNo = kosulsuzSatirNo('satir564(oc(tr564).fatura_no, ust564.faturaNo)');
    const belgeNo = kosulsuzSatirNo('satir564(oc(tr564).belge_no, ust564.belgeNo)');
    const tarih = kosulsuzSatirNo('satir564(oc(tr564).tarih, ust564.tarih)');
    const musteri = satirNo('satir564(oc(tr564).musteri, d.customerName)');
    expect([faturaNo, belgeNo, tarih, musteri]).toEqual([faturaNo, faturaNo + 1, faturaNo + 2, faturaNo + 3]);
  });

  it('değer hücresi kırılma sınıflarını taşır — boşluksuz uzun belge no dar ekranda satırı taşırmasın (MikroFaturaDetay `satir` ile aynı çift)', () => {
    const tanim = satirNo('const satir564 = (etiket: string, deger: React.ReactNode) => (');
    const hucre = satirlar.filter(s => s.n > tanim && s.n <= tanim + 4 && s.kod.includes('{deger}</span>'));
    expect(hucre).toHaveLength(1);
    const siniflar = (hucre[0].kod.match(/className="([^"]*)"/)?.[1] ?? '').split(/\s+/);
    expect(siniflar).toEqual(expect.arrayContaining(['min-w-0', 'break-words']));
    expect(siniflar).not.toContain('break-all');
  });

  it('pencerede ikinci bir «Fatura No» satırı YOK (eski satır taşındı)', () => {
    expect(satirlar.filter(s => /satir564\(oc\(tr564\)\.fatura_no\b/.test(s.kod))).toHaveLength(1);
    expect(satirlar.filter(s => s.kod.includes('dInvoiceNo'))).toEqual([]);
  });
});

/**
 * useMikroFaturalar.test.ts — `mapMikroFatura` SÖZLEŞMESİ (Faz 3 2/n, grup "hook", 2026-09-18). ÖNCE YAZILDI.
 *
 * NEDEN VAR — bu hook, Mikro faturasının Cetpa'daki TEK giriş kapısıdır ve orada sahte sıfır üretiyordu:
 *
 *   tutar:  Number(x.cha_meblag ?? 0) || 0     meblağı NULL gelen fatura ₺0'lık GERÇEK bir fatura oldu
 *   kdv:    Number(x.kdvTutari ?? 0) || 0      satır JOIN'i tutmayan faturanın KDV'si ₺0 "biliniyor" sayıldı
 *   matrah: Number(x.matrah ?? 0) || 0         aynı
 *
 * Sonuç, 8+ tüketiciye sessizce yayılıyordu: Ba/Bs'de cari ₺5.000 eşiğinin ALTINA düşüp vergi
 * beyanından eleniyor, KDV Analizi'nde "₺0 KDV" görünüyor, FinancePanel/Şube P&L ciroyu eksik
 * basıyordu. Panellerin `bilinmeyen` sayaçları (babsKdvAnaliz/kdvAylik) hep 0 kalıyordu çünkü
 * bilinmeyen buraya kadar bile GELMİYORDU.
 *
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen sayı 0 DEĞİL bilinmiyordur → NaN.
 * Toplama `toplaBilinen` ile girer (toplama katılmaz, SAYILIR), ekranda `paraYaz` ile '—' olur.
 *
 * MUTASYON AYIRT EDİCİLİĞİ: aşağıdaki `null`/`''`/`'abc'` vakaları, `|| 0` ya da `?? 0` geri
 * gelirse KIRILIR (0 !== NaN). Meşru ₺0 faturası ayrıca test edilir — "0 da bilinmiyor" diye
 * aşırı düzeltme yapılmadığının kanıtı.
 */
import { describe, it, expect } from 'vitest';
import { mapMikroFatura, VERGI_PNTR_ORAN, type MikroFatura } from './useMikroFaturalar';
import { toplaBilinen, ekranTutari } from '../utils/para';

/** Şirin İnşaat'ın tam okunan satış faturası — diğer fikstürler bunun üstüne yazar. */
const tamKayit: Record<string, unknown> = {
  cha_kod: ' 120-SIRIN ',
  cha_tarihi: '2026-03-14T00:00:00.000Z',
  cha_meblag: 1200,
  cha_evrakno_seri: 'A',
  cha_evrakno_sira: 1001,
  kdvTutari: 200,
  matrah: 1000,
  vergiPntr: '4',
  oranSayisi: 1,
  cha_tip: 0,
  cha_subeno: 2,
  cha_ebelge_turu: 0,
  cha_uuid: 'UUID-1',
};

describe('mapMikroFatura — bilinen alanlar', () => {
  const f = mapMikroFatura('F1', tamKayit);

  it('tam kaydı olduğu gibi okur (davranış parite)', () => {
    expect(f).toMatchObject<Partial<MikroFatura>>({
      id: 'F1', cariKod: '120-SIRIN', tarih: '2026-03-14',
      tutar: 1200, kdv: 200, matrah: 1000,
      faturaNo: 'A-1001', oran: 20, oranKarma: false,
      yon: 'giden', subeNo: 2, ebelgeTuru: 0, uuid: 'UUID-1',
    });
  });

  it('sayısal string kabul eder — Mikro sürücüsü DECIMAL kolonu string döndürebiliyor', () => {
    const f2 = mapMikroFatura('F2', { ...tamKayit, cha_meblag: '1234.50', kdvTutari: ' 205.75 ', matrah: '1028.75' });
    expect(f2.tutar).toBe(1234.5);
    expect(f2.kdv).toBe(205.75);
    expect(f2.matrah).toBe(1028.75);
  });

  it('TÜRKÇE biçimli metin ("1.234,56") BİLİNMEYEN sayılır — ayraç belirsizdir, uydurulmaz', () => {
    // Number('1.234,56') → NaN. Eskiden `|| 0` bunu ₺0 yapıyordu; artık '—' basılır ve SAYILIR.
    // (Sürücü böyle bir metin döndürürse asıl arıza şemadadır — sessiz bir sayı uydurmak onu gizler.)
    expect(Number.isNaN(mapMikroFatura('F2b', { ...tamKayit, cha_meblag: '1.234,56' }).tutar)).toBe(true);
  });

  it('MEŞRU ₺0 faturası 0 KALIR — "0 = bilinmiyor" diye aşırı düzeltilmez', () => {
    const f0 = mapMikroFatura('F0', { ...tamKayit, cha_meblag: 0, kdvTutari: 0, matrah: 0 });
    expect(f0.tutar).toBe(0);
    expect(f0.kdv).toBe(0);
    expect(f0.matrah).toBe(0);
    expect(Number.isNaN(f0.tutar)).toBe(false);
  });
});

describe('mapMikroFatura — bilinmeyen sayı NaN, ASLA 0', () => {
  it('cha_meblag null → tutar NaN (eski `Number(x ?? 0) || 0` ₺0 basıyordu)', () => {
    const f = mapMikroFatura('F3', { ...tamKayit, cha_meblag: null });
    expect(Number.isNaN(f.tutar)).toBe(true);
    expect(f.tutar).not.toBe(0);          // mutasyon ayırt edici: `|| 0` geri gelirse kırılır
  });

  it('cha_meblag alanı hiç yok → tutar NaN', () => {
    const { cha_meblag: _atilan, ...eksik } = tamKayit;
    expect(Number.isNaN(mapMikroFatura('F4', eksik).tutar)).toBe(true);
  });

  it('kdvTutari "" (boş string) → kdv NaN; matrah null → matrah NaN', () => {
    const f = mapMikroFatura('F5', { ...tamKayit, kdvTutari: '', matrah: null });
    expect(Number.isNaN(f.kdv)).toBe(true);
    expect(Number.isNaN(f.matrah)).toBe(true);
    expect(f.tutar).toBe(1200);           // tutar etkilenmez — alanlar BAĞIMSIZ bilinir
  });

  it('sayıya çevrilemeyen metin ("abc") → NaN (Number("abc") zaten NaN; `|| 0` onu 0 yapıyordu)', () => {
    const f = mapMikroFatura('F6', { ...tamKayit, cha_meblag: 'abc', kdvTutari: 'abc' });
    expect(Number.isNaN(f.tutar)).toBe(true);
    expect(Number.isNaN(f.kdv)).toBe(true);
  });

  it('NEGATİF tutar korunur (iade/düzeltme faturası) — `|| 0` bunu bozmuyordu ama koruma altına alınır', () => {
    expect(mapMikroFatura('F7', { ...tamKayit, cha_meblag: -450 }).tutar).toBe(-450);
  });
});

describe('mapMikroFatura — tutar dışı alanlar (parite)', () => {
  it('cha_tip 1 → gelen (alış), 0/eksik → giden (satış)', () => {
    expect(mapMikroFatura('G1', { ...tamKayit, cha_tip: 1 }).yon).toBe('gelen');
    expect(mapMikroFatura('G2', { ...tamKayit, cha_tip: 0 }).yon).toBe('giden');
    expect(mapMikroFatura('G3', {}).yon).toBe('giden');
  });

  it('vergiPntr çözülemezse oran null — %20 VARSAYILMAZ', () => {
    expect(mapMikroFatura('O1', { ...tamKayit, vergiPntr: null }).oran).toBeNull();
    expect(mapMikroFatura('O2', { ...tamKayit, vergiPntr: '9' }).oran).toBeNull();
    expect(mapMikroFatura('O3', { ...tamKayit, vergiPntr: '3' }).oran).toBe(VERGI_PNTR_ORAN['3']);
  });

  it('cha_subeno okunamazsa subeNo NaN — "şube 0" (merkez) sanılıp YANLIŞ şubenin P&L\'ine yazılmaz', () => {
    expect(Number.isNaN(mapMikroFatura('S1', { ...tamKayit, cha_subeno: null }).subeNo)).toBe(true);
    expect(mapMikroFatura('S2', { ...tamKayit, cha_subeno: 0 }).subeNo).toBe(0);   // meşru merkez şubesi
  });

  it('oranSayisi > 1 → karma oran rozeti', () => {
    expect(mapMikroFatura('K1', { ...tamKayit, oranSayisi: 2 }).oranKarma).toBe(true);
    expect(mapMikroFatura('K2', { ...tamKayit, oranSayisi: null }).oranKarma).toBe(false);
  });

  it('evrak no: seri boşsa yalnız sıra; ikisi de boşsa boş metin', () => {
    expect(mapMikroFatura('E1', { ...tamKayit, cha_evrakno_seri: '  ' }).faturaNo).toBe('1001');
    expect(mapMikroFatura('E2', { ...tamKayit, cha_evrakno_seri: '', cha_evrakno_sira: null }).faturaNo).toBe('');
  });

  it('uuid: cha_uuid → cha_ettn → uuid sırası; hiçbiri yoksa undefined (boş metin DEĞİL)', () => {
    expect(mapMikroFatura('U1', { ...tamKayit, cha_uuid: undefined, cha_ettn: 'ETTN-9' }).uuid).toBe('ETTN-9');
    expect(mapMikroFatura('U2', { ...tamKayit, cha_uuid: undefined }).uuid).toBeUndefined();
  });
});

describe('toplaBilinen ile birlikte — tüketicinin göreceği davranış', () => {
  it('bilinmeyen tutarlı fatura toplama GİRMEZ, SAYILIR', () => {
    const faturalar = [
      mapMikroFatura('A', { ...tamKayit, cha_meblag: 1000 }),
      mapMikroFatura('B', { ...tamKayit, cha_meblag: null }),   // Şirin İnşaat, meblağı okunamadı
      mapMikroFatura('C', { ...tamKayit, cha_meblag: 500 }),
    ];
    const t = toplaBilinen(faturalar, f => f.tutar);
    expect(t).toEqual({ toplam: 1500, bilinen: 2, bilinmeyen: 1 });
    expect(ekranTutari(t)).toBe(1500);    // kısmi toplam + sayfa "1 fatura tutarsız" notu
  });

  it('HİÇ bilinen yokken ekran NaN → paraYaz "—" (eski hâl: ₺0)', () => {
    const faturalar = [mapMikroFatura('A', { ...tamKayit, cha_meblag: null })];
    expect(Number.isNaN(ekranTutari(toplaBilinen(faturalar, f => f.tutar)))).toBe(true);
  });
});

/**
 * BAYAT ₺0 KORUMASI (delta turu, 2026-09-18) — sunucudaki `ISNULL(…, 0)` yedeği bugün kalktı,
 * ama o yedek DAHA ÖNCE import edilmiş dokümanlara `kdvTutari: 0` / `matrah: 0` yazdı. Yeniden
 * import edilene kadar hook onları "bilinen 0" okur: Ba/Bs ₺5.000 eşiği, KDV Analizi ve mizan
 * ₺0 KDV'li gerçek bir fatura görür, `bilinmeyen` sayacı 0 kalır. Gece cron'u yalnız son 90 günü
 * yeniliyor, 90 günden eskisi elle import beklemek zorunda.
 *
 * Ayırt edici: `oranSayisi`, satır alt sorgusunun COUNT'udur — satır JOIN'i tuttuysa EN AZ 1,
 * tutmadıysa NULL/eksik. Zincirin ikinci halkası `cha_aratoplam` (matrah) ve `cha_meblag −
 * cha_aratoplam` (KDV). İkisi de okunamıyorsa yeni SQL NULL indirir; eski doküman aynı yerde 0
 * taşır. Koruma YALNIZ TAM 0'a uygulanır — gerçek bir tutar hiçbir koşulda düşürülmez.
 */
describe('mapMikroFatura — 2026-09-18 öncesi importun bayat ₺0\'ı bilinmeyene çevrilir', () => {
  /** Eski import: satır JOIN'i tutmamış (oranSayisi yok) ve başlık ara toplamı da NULL. */
  const bayat: Record<string, unknown> = {
    ...tamKayit, oranSayisi: undefined, cha_aratoplam: null, kdvTutari: 0, matrah: 0,
  };

  it('ne satırı ne ara toplamı okunabilen faturanın ₺0 KDV/matrahı NaN olur', () => {
    const f = mapMikroFatura('B1', bayat);
    expect(Number.isNaN(f.kdv)).toBe(true);
    expect(Number.isNaN(f.matrah)).toBe(true);
    expect(f.kdv).not.toBe(0);            // mutasyon ayırt edici: koruma kalkarsa 0 döner
    expect(f.tutar).toBe(1200);           // cha_meblag bağımsız okunur, etkilenmez
  });

  it('GERÇEK tutar hiçbir koşulda düşürülmez — koruma yalnız TAM 0 için', () => {
    const f = mapMikroFatura('B2', { ...bayat, kdvTutari: 200, matrah: 1000 });
    expect(f.kdv).toBe(200);
    expect(f.matrah).toBe(1000);
  });

  it('satır JOIN\'i tuttuysa (oranSayisi ≥ 1) MEŞRU ₺0 faturası 0 KALIR — istisna/ihracat faturası', () => {
    const f = mapMikroFatura('B3', { ...tamKayit, oranSayisi: 1, cha_aratoplam: null, kdvTutari: 0, matrah: 0 });
    expect(f.kdv).toBe(0);
    expect(f.matrah).toBe(0);
  });

  it('satır yok ama başlık ara toplamı okunuyorsa zincir çalışır — ₺0 KDV meşrudur, 0 kalır', () => {
    const f = mapMikroFatura('B4', { ...tamKayit, oranSayisi: undefined, cha_meblag: 1000, cha_aratoplam: 1000, kdvTutari: 0, matrah: 1000 });
    expect(f.kdv).toBe(0);                // meblağ = ara toplam → KDV gerçekten 0
    expect(f.matrah).toBe(1000);
  });

  it('satır yok, ara toplam VAR ama meblağ okunamıyor: matrah bilinir, KDV bilinmez (alanlar bağımsız)', () => {
    const f = mapMikroFatura('B5', { ...tamKayit, oranSayisi: null, cha_meblag: null, cha_aratoplam: 800, kdvTutari: 0, matrah: 800 });
    expect(f.matrah).toBe(800);
    expect(Number.isNaN(f.kdv)).toBe(true);
  });
});

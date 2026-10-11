// @vitest-environment node
/**
 * magazaBildirim.sahiplenme.test.ts — işçinin süreç içi sahiplenme ANAHTARI (dilim 2a, şartname § 2.10; K9 / Y6 — dilim 2b'de
 * `revize` türüyle CANLANDI, § 10.2 (e)).
 *
 * Kural: `gonderimde` kümesine çıplak `talepId` YAZILMAZ; anahtar `talepId + '|' + tur`dur. 2a'da tek tür `ilk`ti ve anahtarın
 * biçimi dışarıdan gözlenemiyordu (kural yalnız kaynakta kilitliydi). 2b ikinci türü (`revize`) ekledi: aynı talebin ilk ve
 * revize bildirimi birbirini DÜŞÜRMEZ — bu artık davranışla da sınanır (aşağıda; ayrıntılı işçi testleri
 * magazaBildirim.revize.test.ts'te). Aynı türün eşzamanlı iki koşusu ise birbirini çevirir (magazaBildirim.test.ts «süreç içi
 * sahiplenme» bloğu ilk bildirim için; burada revize için).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { kodSatirlari, SRC_KOK } from '../../test/kaynakTarama';

// Gönderici sahte: SMTP bağlantısı HİÇ açılmaz.
vi.mock('../smtpPosta', async (asliniGetir) => {
  const asil = await asliniGetir<typeof import('../smtpPosta')>();
  return { ...asil, smtpGonder: vi.fn() };
});
import { smtpGonder } from '../smtpPosta';
import { magazaBildirimIsle, magazaRevizeBildirimIsle } from './magazaBildirim';
import type { MagazaBildirimDeps } from './magazaBildirim';

const kod = kodSatirlari(join(SRC_KOK, 'server', 'kanal', 'magazaBildirim.ts')).map(s => s.kod);
const metin = kod.join('\n');

describe('magazaBildirim.ts — sahiplenme anahtarı `talepId|tur` (kaynak çiti)', () => {
  it('kümeye çıplak `talepId` ile `has` / `add` / `delete` YOK', () => {
    expect(kod.filter(s => /gonderimde\.(has|add|delete)\(\s*talepId\s*\)/.test(s))).toEqual([]);
  });

  it('küme üç yerde kullanılır (sor · al · bırak) ve üçü de AYNI üreticiden, AYNI türle (`a.tur`) gelen anahtarla — iki tür TEK iskeletten geçer', () => {
    const kullanim = kod.filter(s => /gonderimde\.(has|add|delete)\(/.test(s)).map(s => s.trim());
    expect(kullanim).toHaveLength(3);
    expect(kullanim.filter(s => s.includes('gonderimde.has(anahtar)'))).toHaveLength(1);
    expect(kullanim.filter(s => s.includes('gonderimde.add(anahtar)'))).toHaveLength(1);
    expect(kullanim.filter(s => s.includes('gonderimde.delete(sahiplenmeAnahtari(talepId, a.tur))'))).toHaveLength(1);
    // `anahtar` sahiplenmeden HEMEN önce, aynı üreticiyle ve aynı türle kurulur.
    const al = kod.findIndex(s => s.includes('gonderimde.has(anahtar)'));
    expect(kod[al - 1].trim()).toBe('const anahtar = sahiplenmeAnahtari(talepId, a.tur);');
  });

  it('üretici anahtarı `talepId|tur` biçiminde kurar; tür kümesi TAM iki değer (`ilk`, `revize`) ve iki tür ayarında birer kez geçer', () => {
    expect(metin).toContain('const sahiplenmeAnahtari = (talepId: string, tur: BildirimTuru): string => `${talepId}|${tur}`;');
    expect(metin).toContain("type BildirimTuru = 'ilk' | 'revize';");
    expect(kod.filter(s => /^\s*tur: '(ilk|revize)',$/.test(s)).map(s => s.trim())).toEqual(["tur: 'ilk',", "tur: 'revize',"]);
    // Üreticinin TEK tanımı ve iki çağrısı (al + bırak): başka yerde elle `talepId + '|'` birleştirmesi yok.
    expect(metin.split('sahiplenmeAnahtari(').length - 1).toBe(2);
    expect(metin).not.toMatch(/talepId\s*\+\s*['"`]\|/);
  });

  it('kuyruk iş verisi DEĞİŞMEDİ: yalnız `{ talepId }` (tür iş verisine GİRMEZ — tür kuyruğun kendisidir: iki ayrı kuyruk, iki ayrı işçi)', () => {
    expect(metin).toMatch(/\{ talepId \}/);
    expect(metin).not.toMatch(/\{ talepId, tur\b/);
    expect(metin).not.toMatch(/\bdata\.tur\b|\btur: is\b/);
  });
});

describe('sahiplenme davranışı — aynı talebin ilk ve revize bildirimi birbirini DÜŞÜRMEZ (§ 10.8; K9)', () => {
  const KIMLIK = 'mt-0123456789abcdef0123456789abcdef';
  const SIMDI = '2026-10-10T12:00:00.000Z';
  const gonder = vi.mocked(smtpGonder);
  type Satir = Record<string, unknown>;

  /** `docs` satırının sahtesi: ilk bildirim belgenin tamamını, revize dar sütunları okur; yazımlar ilgili alanı günceller. */
  function duzenek(belge: Satir) {
    const b = structuredClone(belge);
    const yazilan: Array<{ sql: string; params: unknown[] }> = [];
    const havuz = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.startsWith('SELECT data->>')) return { rows: [{ talep_no: b.talepNo, icerik_zamani: b.icerikZamani, revize: structuredClone(b.bildirimRevize) }] };
        if (sql.startsWith('SELECT')) return { rows: [{ data: structuredClone(b) }] };
        yazilan.push({ sql, params });
        const yama = JSON.parse(String(params[2])) as Satir;
        if (sql.includes("'{bildirimRevize}'")) b.bildirimRevize = { ...(b.bildirimRevize as Satir), ...yama };
        else b.bildirim = yama;
        return { rows: [{ data: structuredClone(b) }] };
      }),
    };
    const D: MagazaBildirimDeps = { getPgPool: () => havuz, broadcastDocChange: vi.fn(), appUrl: () => 'https://app.cetpa.com.tr', simdi: () => new Date(SIMDI) };
    return { D, b, yazilan };
  }
  const belge = (): Satir => ({
    companyId: 'c1', talepNo: 'T261010-AB12', olusturma: '2026-10-10T09:00:00.000Z', icerikZamani: '2026-10-10T11:00:00.000Z', icerikSurum: 1,
    musteri: { ad: 'A', il: 'Antalya' }, kalemler: [], talepEdilen: { araToplam: null, kdv: null, toplam: null },
    bildirim: { durum: 'bekliyor', zaman: '2026-10-10T09:00:00.000Z' },
    bildirimRevize: { durum: 'bekliyor', zaman: '2026-10-10T11:00:00.000Z', alanlar: ['not'], kim: { uid: 'u1', ad: 'Ayşe' }, icerikSurum: 1 },
  });
  /** Elle çözülen gönderim: çağrıldığında askıda kalır, `birak()` ile biter. */
  function askidaGonderim() {
    const bekleyenler: Array<() => void> = [];
    gonder.mockImplementation(() => new Promise((coz) => { bekleyenler.push(() => coz({ ok: true })); }));
    return { adet: () => bekleyenler.length, birak: () => { for (const b of bekleyenler.splice(0)) b(); } };
  }
  const bekle = async (kosul: () => boolean): Promise<void> => { for (let i = 0; i < 200 && !kosul(); i += 1) await new Promise<void>((r) => setTimeout(r, 1)); };

  beforeEach(() => { gonder.mockReset(); });

  it('İLK bildirim gönderimi sürerken REVİZE işi `atlandi` / `yeniden-dene` DÖNMEZ: gönderir (iki posta, iki ayrı alan)', async () => {
    const d = duzenek(belge());
    const g = askidaGonderim();
    const ilk = magazaBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false });
    await bekle(() => g.adet() === 1);                        // ilk bildirimin postası askıda: `…|ilk` sahipli
    const revize = magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false });
    await bekle(() => g.adet() === 2);
    expect(g.adet()).toBe(2);                                // revize sahiplenmeye TAKILMADI, kendi postasını başlattı
    g.birak();
    await expect(ilk).resolves.toBe('gitti');
    await expect(revize).resolves.toBe('gitti');
    expect(gonder).toHaveBeenCalledTimes(2);
    expect(String(gonder.mock.calls[0][0].konu)).toBe('Yeni mağaza talebi: T261010-AB12');
    expect(String(gonder.mock.calls[1][0].konu)).toBe('Mağaza talebi revize edildi · T261010-AB12');
    expect((d.b.bildirim as Satir).durum).toBe('gitti');
    expect((d.b.bildirimRevize as Satir).durum).toBe('gitti');
  });

  it('tersi: REVİZE gönderimi sürerken İLK bildirim de gönderir', async () => {
    const d = duzenek(belge());
    const g = askidaGonderim();
    const revize = magazaRevizeBildirimIsle(KIMLIK, d.D);
    await bekle(() => g.adet() === 1);
    const ilk = magazaBildirimIsle(KIMLIK, d.D);
    await bekle(() => g.adet() === 2);
    expect(g.adet()).toBe(2);
    g.birak();
    await expect(revize).resolves.toBe('gitti');
    await expect(ilk).resolves.toBe('gitti');
  });

  it('AYNI türün eşzamanlı ikinci koşusu çevrilir: revize × revize → ikinci posta YOK (kuyruk yolunda `yeniden-dene`, süreç içi yolda `atlandi`)', async () => {
    const d = duzenek(belge());
    const g = askidaGonderim();
    const birinci = magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false });
    await bekle(() => g.adet() === 1);
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).resolves.toBe('yeniden-dene');
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D)).resolves.toBe('atlandi');
    expect(g.adet()).toBe(1);
    g.birak();
    await expect(birinci).resolves.toBe('gitti');
    expect(gonder).toHaveBeenCalledTimes(1);
    // Sahiplenme bırakıldı: sonraki revize koşusu belgeyi okur (`gitti` → atlar), kümeye takılmaz.
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 2, sonMu: false })).resolves.toBe('atlandi');
  });
});

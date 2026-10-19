/**
 * DEĞİŞMEZ — teslimat adresinin SUNUCU okuyucuları yardımcıya BAĞLI (2026-10-10; sipariş penceresinde ülke / il seçimi,
 * şartname `.wf/SARTNAME-teslimat-adresi-v2.md` A2-7 … A2-9 ve «Kaynak çitleri (sunucu)»).
 *
 * Kararların kendisi saf modülde ve birim testli (utils/siparisler/teslimatAdresi + test). İki uç server.ts kapanışında —
 * giriş dosyası içe aktarılamıyor; bağlantı bu yüzden KAYNAKTAN çitlenir:
 *   1) KİMLİKSİZ takip ucu (`GET /api/track/:orderId`): yapısal adres taşıyan kayıtta yanıtın adresi YALNIZ
 *      `takipAdresi(o).metin`dir (il + yurt dışıysa ülke adı). O kayıtta `shippingAddress` «kalan»dır — ilçe, mahalle,
 *      sokak, kapı no — ve eski «son iki parça» maskesi tam da sokak düzeyini dışarı verirdi. `maskAddress(…)` yalnız
 *      yapısal OLMAYAN dalda (eski kayıt) çalışır ve gövdesi değişmedi → eski kayıtta yanıt birebir aynı. Yanıt gövdesi
 *      2026-10-19'dan beri TEK işlevde (`takipYaniti` — şartname «takip kodu + LUCA reddi» TC): kod yolu ve eski yol aynı adres
 *      kararını kullanır; çit o işlevin gövdesine bakar, mağaza reddi uçta yanıttan ÖNCE.
 *   2) LUCA fatura gövdesi KALKTI (2026-10-19, LA — `/api/luca/sync/fatura` her isteğe 400): `teslimatAdresiMetni` artık server.ts'e
 *      içe aktarılmaz; uçta sipariş okunmadığı / adres kurulmadığı ayrıca sabitlenir.
 *   3) «Yazıldı ama bağlanmadı» çiti: yardımcıyı İÇE AKTARAN her sunucu dosyası onu gerçekten ÇAĞIRIYOR.
 * Davranışı uçtan koşan testler: iyzico bloğu → routes/paymentRoutes.iyzicoKapi.test.ts; mağaza eşleyicisi →
 * kanal/shopifyEsleme.test.ts. İstemci okuyucularının çiti ayrıdır (utils/siparisler/teslimatAdresi.cit.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { SRC_KOK as SRC, kodSatirlari, gorece, type KodSatiri } from '../test/kaynakTarama';

const SERVER = join(SRC, '..', 'server.ts');
const ODEME = join(SRC, 'server', 'routes', 'paymentRoutes.ts');
const ESLEME = join(SRC, 'server', 'kanal', 'shopifyEsleme.ts');

const satirlar = (kod: KodSatiri[], desen: RegExp) => kod.filter(s => desen.test(s.kod.trimEnd()));
const tek = (kod: KodSatiri[], desen: RegExp): KodSatiri => {
  const s = satirlar(kod, desen);
  expect(s.map(x => `${x.n}: ${x.kod.trim()}`), String(desen)).toHaveLength(1);
  return s[0];
};
/** Rota işleyicisinin gövdesi: kayıt satırından, aynı girintideki ilk `});` satırına kadar (ikisi dâhil). */
function isleyici(kayitDeseni: RegExp): KodSatiri[] {
  const kod = kodSatirlari(SERVER);
  const bas = tek(kod, kayitDeseni).n;
  const son = kod.find(s => s.n > bas && /^ {2}\}\);$/.test(s.kod.trimEnd()));
  expect(son, 'işleyicinin kapanışı bulunamadı').toBeDefined();
  return kod.filter(s => s.n >= bas && s.n <= (son as KodSatiri).n);
}
const metin = (kod: KodSatiri[]) => kod.map(s => s.kod).join('\n');
const adet = (kod: KodSatiri[], desen: RegExp) => (metin(kod).match(desen) ?? []).length;

/** Üst düzey işlevin gövdesi: tanım satırından ilk `}` satırına kadar (ikisi dâhil). */
function islev(tanimDeseni: RegExp): KodSatiri[] {
  const kod = kodSatirlari(SERVER);
  const bas = tek(kod, tanimDeseni).n;
  const son = kod.find(s => s.n > bas && /^\}$/.test(s.kod.trimEnd()));
  expect(son, 'işlevin kapanışı bulunamadı').toBeDefined();
  return kod.filter(s => s.n >= bas && s.n <= (son as KodSatiri).n);
}

describe('kimliksiz takip ucu — yapısal kayıtta «kalan» dışarı verilmez', () => {
  // Yanıt gövdesi `takipYaniti`'nde (TC); uç onu tek yerden çağırır.
  const g = islev(/^function takipYaniti\(o: Record<string, unknown>, eskiYolKimligi\?: string\): Record<string, unknown> \{$/);
  const uc = isleyici(/^ {2}app\.get\('\/api\/track\/:orderId', trackLimiter, async \(req: Request, res: Response\) => \{$/);

  it('yanıtın adresi `takipAdresi` üzerinden; `maskAddress` YALNIZ yapısal olmayan dalda', () => {
    const karar = tek(g, /^\s*const adres = takipAdresi\(o\);$/);
    const alan = tek(g, /^\s*shippingAddress:\s+adres\.yapisal \? adres\.metin : maskAddress\(o\.shippingAddress\),$/);
    expect(karar.n, 'karar yanıttan ÖNCE verilir').toBeLessThan(alan.n);
    // İşleyicide `shippingAddress`'in tek OKUMASI o satırdaki eski kayıt dalıdır; `takipAdresi(o)` alanı kendi içinde
    // yalnız yapısal alanlara bakarak karara bağlar (kalan ona girmez — teslimatAdresi.test «takipAdresi»).
    expect(adet(g, /\.shippingAddress\b/g)).toBe(1);
    expect(adet(g, /\bmaskAddress\(/g)).toBe(1);
    expect(adet(g, /\btakipAdresi\(/g)).toBe(1);
    // Yanıt nesnesinde ikinci bir adres alanı açılmadı (il / ülke / tam metin ayrı anahtarla sızmasın).
    expect(metin(g)).not.toMatch(/\b(teslimatSehri|teslimatUlke|teslimatAdresiMetni)\b/);
  });

  it('mağaza siparişi karardan ÖNCE 404 alır (o kaynakta `teslimatSehri` «ilçe / il»dir, il değil)', () => {
    const gizli = tek(uc, /^\s*if \(o\.source === MAGAZA_KAYNAGI\) return res\.status\(404\)\.json\(\{ success: false, error: 'Sipariş bulunamadı\.' \}\);$/);
    const yanit = tek(uc, /^\s*res\.json\(\{ success: true, order: takipYaniti\(o, eskiYolKimligi\) \}\);$/);
    expect(gizli.n).toBeLessThan(yanit.n);
    // Uçta adres alanına dokunulmaz; tek yanıt kurucusu `takipYaniti` (server.ts'te tek çağrı).
    expect(metin(uc)).not.toMatch(/shippingAddress|takipAdresi|maskAddress/);
    expect(adet(kodSatirlari(SERVER), /\btakipYaniti\(/g)).toBe(2);   // tanım + uçtaki tek çağrı
  });

  it('eski kayıt maskesi (`maskAddress`) değişmedi ve server.ts\'te başka yerden çağrılmıyor', () => {
    const kod = kodSatirlari(SERVER);
    const tanim = tek(kod, /^function maskAddress\(addr: unknown\): string \| null \{$/).n;
    expect(kod.filter(s => s.n > tanim && s.n <= tanim + 5).map(s => s.kod.trimEnd())).toEqual([
      "  if (typeof addr !== 'string' || !addr.trim()) return null;",
      "  const parts = addr.split(',').map(p => p.trim()).filter(Boolean);",
      "  if (parts.length <= 2) return parts.join(', ') || null;",
      "  return parts.slice(-2).join(', ');",
      '}',
    ]);
    // Tanım + takip ucundaki TEK çağrı.
    expect(adet(kod, /\bmaskAddress\(/g)).toBe(2);
    expect(adet(kod, /\btakipAdresi\(/g)).toBe(1);
  });
});

describe('LUCA fatura gövdesi KALKTI (2026-10-19, LA) — uç siparişi okumaz, adres / gövde kurmaz', () => {
  const g = isleyici(/^ {2}app\.post\('\/api\/luca\/sync\/fatura', requireAuth, requireMfaVerified, requireCollectionAccess\('invoices', 'write'\), async \(_req: Request, res: Response\) => \{$/);

  it('işleyici: 503 «yapılandırılmamış» + 400 kapanış; adres yardımcısı, sipariş okuması ve LUCA çağrısı YOK', () => {
    expect(metin(g)).toMatch(/res\.status\(400\)\.json\(LUCA_FATURA_KAPALI\);/);
    expect(metin(g)).not.toMatch(/teslimatAdresiMetni|shippingAddress|collection\('orders'\)|fetch\(/);
    expect(adet(kodSatirlari(SERVER), /\bteslimatAdresiMetni\b/g)).toBe(0);
  });
});

describe('«yazıldı ama bağlanmadı» — yardımcıyı içe aktaran sunucu dosyası onu çağırıyor', () => {
  // Dosya → [içe aktarma yolu (sunucu kuralı: `.js` uzantılı), çağrılması gereken adlar].
  const BAGLANTI: [string, RegExp, string[]][] = [
    [SERVER, /^import \{ takipAdresi \} from '\.\/src\/utils\/siparisler\/teslimatAdresi\.js';$/, ['takipAdresi']],
    [ODEME, /^import \{ siparisSehri, etkinUlke, ulkeAdi \} from '\.\.\/\.\.\/utils\/siparisler\/teslimatAdresi\.js';$/, ['siparisSehri', 'etkinUlke', 'ulkeAdi']],
    [ESLEME, /^import \{ ulkeKoduMu \} from '\.\.\/\.\.\/utils\/siparisler\/teslimatAdresi\.js';$/, ['ulkeKoduMu']],
  ];
  it.each(BAGLANTI.map(([yol, ...kalan]) => [gorece(yol), yol, ...kalan] as const))('%s', (_ad, yol, iceAktarma, adlar) => {
    const kod = kodSatirlari(yol);
    const satir = tek(kod, iceAktarma).n;
    const govde = kod.filter(s => s.n !== satir);
    for (const ad of adlar) expect(adet(govde, new RegExp(`\\b${ad}\\(`, 'g')), `${ad}( çağrısı`).toBeGreaterThan(0);
  });
});

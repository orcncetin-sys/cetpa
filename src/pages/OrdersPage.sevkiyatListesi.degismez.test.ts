/**
 * Lojistik → "Aktif Sevkiyatlar" listesi (kullanıcı 2026-10-02: "tabloya tıklanmıyor"). Satırlarda `cursor-pointer` + hover vardı
 * ama `onClick` HİÇ yoktu; liste de "Aktif" başlığı altında TÜM siparişleri (hepsi "Teslim edildi") basıyordu. Bileşen 4.000
 * satırlık sayfanın içinde olduğu için davranış kaynak üzerinden sabitlenir.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { yorumsuz } from '../test/degismezTarayici';

const kod = readFileSync(resolve(__dirname, 'OrdersPage.tsx'), 'utf8');
const blok = kod.slice(kod.indexOf('{/* Map + Shipments */}'), kod.indexOf('{/* ── İADE MODAL ── */}'));

describe('OrdersPage — Aktif Sevkiyatlar listesi', () => {
  it('blok bulunuyor (işaretçiler taşınırsa test sessizce boş metne bakmasın)', () => {
    expect(blok.length).toBeGreaterThan(500);
  });
  it('satır tıklanınca sipariş detayı açılır (seç + Siparişler sekmesine geç)', () => {
    expect(blok).toMatch(/<button type="button" key=\{order\.id\}\s+onClick=\{\(\) => \{ setSelectedOrder\(order\); setActiveTab\('orders'\);/);
  });
  it("'orders' sekmesine erişimi olmayan rolde (Lojistik) satır düğme DEĞİL — tıklayınca Pano'ya atmasın", () => {
    expect(blok).toMatch(/return siparisDetayiAcilabilir \? \(\s+<button type="button"/);
    expect(blok).toMatch(/\) : \(\s+<div key=\{order\.id\} className="p-3 rounded-lg border border-transparent">\{icerik\}<\/div>/);
    expect(readFileSync(resolve(__dirname, '../App.tsx'), 'utf8')).toContain("siparisDetayiAcilabilir={canAccess('orders')}");
  });
  it('liste ve harita yalnız sevkiyatı SÜREN siparişleri (istenirse teslim edilenleri) gösterir — ham `orders` basılmaz', () => {
    expect(blok).toContain('sevkiyatListesi.gorunen.map(order =>');
    expect(blok).toContain('<LogisticsMap orders={sevkiyatListesi.harita}');                  // liste + kurulmuş rotanın durakları
    expect(kod).toContain('const harita = [...gorunen, ...orders.filter(o => durak.has(o.id) && !listede.has(o.id))];');
    expect(blok).not.toMatch(/\borders\.map\(/);
    expect(kod).toContain('const suren = orders.filter(sevkiyatiSuruyor);');
  });
  it('`cursor-pointer` taşıyan tek öğe tıklanan satır düğmesidir (tıklanmayan öğede el imleci kalmadı)', () => {
    expect(blok.match(/cursor-pointer/g)).toHaveLength(1);
    const i = blok.indexOf('cursor-pointer');
    const etiketBasi = blok.lastIndexOf('<', i);                                // imleci taşıyan öğenin açılışı
    expect(blok.slice(etiketBasi, etiketBasi + 7)).toBe('<button');
    expect(blok.slice(etiketBasi, i)).toContain('onClick={');
  });
});

/** Özet kartları (kullanıcı 2026-10-02: «kartlar detaya gitmeli»): kart DÜĞMEDİR, sayısı ve listesi AYNI kovadan gelir. */
describe('OrdersPage — sevkiyat özet kartları ve arama', () => {
  const ozet = kod.slice(kod.indexOf('{/* ── Sevkiyat özeti'), kod.indexOf('{/* Map + Shipments */}'));
  it('blok bulunuyor', () => { expect(ozet.length).toBeGreaterThan(500); });
  it('kart düğmedir, tıklayınca kovayı seçer; sayı AYNI kovadan okunur', () => {
    expect(ozet).toMatch(/<button type="button" key=\{s\.kova\} onClick=\{\(\) => sevkiyatKovasiSec\(s\.kova\)\} aria-pressed=\{secili\}/);
    expect(ozet).toContain('{sevkiyatKovalar[s.kova].length}');
  });
  it('kova seçmek ve süzgeci kaldırmak aramayı da temizler (kart sayısı ≠ liste olmasın)', () => {
    const sec = kod.slice(kod.indexOf('const sevkiyatKovasiSec = (kova: SevkiyatKovasi) => {'), kod.indexOf('const sevkiyatListesi = useMemo'));
    expect(sec).toMatch(/setSevkiyatKovasi\(kova\);\s+setSevkiyatArama\(''\);/);
    expect(blok).toContain("onClick={() => { setSevkiyatKovasi('suren'); setSevkiyatArama(''); }}");
  });
  it('arama kutusu BAĞLI (eskiden değeri de işleyicisi de yoktu)', () => {
    expect(kod).toContain('value={sevkiyatArama} onChange={e => setSevkiyatArama(e.target.value)}');
    expect(kod).toContain('kova.filter(o => eslesir(sevkiyatArama,');
  });
  it('gün anahtarı memo bağımlılığıdır (gece yarısından sonra "bugün" kovası bayatlamaz)', () => {
    expect(kod).toContain('const sevkiyatKovalar = useMemo(() => sevkiyatKovalari(orders, sevkiyatBugun), [orders, sevkiyatBugun]);');
    expect(kod).toContain('const sevkiyatBugun = bugunAnahtari();');   // memo / durum içinde DEĞİL: her çizimde yeniden okunur
  });
  it('boş listenin nedeni söylenir (arama / kova / hiç sevkiyat yok)', () => {
    // Koşul + metin + SIRA tek desende (yalnız metni aramak, koşul ters çevrilse de yeşil kalırdı).
    expect(blok).toMatch(/\{sevkiyatArama\.trim\(\) !== ''\s+\? \(currentLanguage === 'tr' \? 'Aramayla eşleşen sevkiyat yok\.'[^\n]*\s+: sevkiyatKovasi !== 'suren'\s+\? \(currentLanguage === 'tr' \? 'Bu listede sipariş yok\.'[^\n]*\s+: currentT\.no_active_orders_found\}/);
  });
});

/** "Klonla" tohumu (2026-10-02 / 03): sipariş penceresi bu tohumla açılır. */
describe('OrdersPage — "Siparişi kopyala" tohumu', () => {
  const i = kod.indexOf('setSiparisTohumu({');
  const tohum = kod.slice(i, kod.indexOf('});', i));
  it('tohum bulunuyor', () => { expect(i).toBeGreaterThan(-1); expect(tohum.length).toBeGreaterThan(200); });
  it('faturasız siparişin TÜRETİLMİŞ `kdvOran: 0`\'ı taşınmaz (kopya faturalıya çevrilince %0 KDV ile kaydedilirdi)', () => {
    expect(tohum).toContain('...(o.faturali ? { kdvOran: o.kdvOran } : {}),');
    expect(tohum).not.toMatch(/^\s*kdvOran: o\.kdvOran,/m);
  });
  it('kalemler HAM geçer (kimlik ve türetilmiş alanlar pencerede `kopyaKalemi` ile kurulur); kaynak toplam ve giriş birimi', () => {
    expect(tohum).toMatch(/kalemler: o\.lineItems \|\| \[\],/);
    expect(tohum).not.toMatch(/-clone-/);
    expect(tohum).not.toMatch(/totalPrice/);
    expect(tohum).toContain('fiyatGirisi: o.fiyatGirisi,');
  });
});

/** Sipariş düzenleme formu (2026-10-07): belgesi kesilmiş siparişte tutar / KDV kilitli; kaydedilecek tutar önizlenir. */
describe('OrdersPage — sipariş düzenleme: belge kilidi ve tutar önizlemesi', () => {
  // YORUMSUZ kaynak: ham metinde arayan çit, blok JSX yorumuna alınsa da yeşil kalırdı.
  const kodY = yorumsuz('OrdersPage.tsx', kod).join('\n');
  it('belge kesildi TEK tanım (bileşen düzeyinde); cari bağı kilidi de onu okur', () => {
    // e-Fatura kolu 2026-10-17'den beri TEK yüklemden ve CANLI kayıttan (şartname «e-Fatura çift kesim» D10; davranışı:
    // OrdersPage.faturaGonderimi.test.tsx B4): numarasız kesilen / gönderimi süren / sonucu bilinmeyen faturada da kilitli.
    expect((kodY.match(/selectedOrder\.irsaliyeGonderildi === true \|\| !!selectedOrder\.irsaliyeNo \|\| mikroFaturasiKesilmisOlabilir\(guncelSiparis\(selectedOrder\)\)\)/g) ?? [])).toHaveLength(1);
    expect(kodY).not.toMatch(/!!selectedOrder\.mikroFaturaNo/);
    expect(kodY).toContain('const belgeKesildi = duzenlenenBelgeKesildi;');
  });
  it('TUTAR ve KDV girdileri belge kesilmişse kapalı', () => {
    expect(kodY).toMatch(/disabled=\{duzenlenenBelgeKesildi\} value=\{editingTutarHam\} onChange=\{e => setEditingTutarHam\(e\.target\.value\)\}/);
    expect(kodY).toMatch(/disabled=\{duzenlenenBelgeKesildi\} value=\{editingKdvHam\} onChange=\{e => setEditingKdvHam\(e\.target\.value\)\}/);
    expect(kodY).toContain('Resmî belge kesilmiş — tutar ve KDV oranı değiştirilemez.');
  });
  it('önizleme KAYITLA AYNI işlevden ve aynı girdilerden; yalnız yazılacak tutar formdakinden farklıysa gösterilir', () => {
    expect(kodY).toContain('const yama = siparisDuzenlemeYamasi({ tutarHam: magazaKilidi ? sayiGirdisi(selectedOrder.totalPrice) : editingTutarHam, kdvHam: editingKdvHam }, selectedOrder);');
    expect(kodY).toMatch(/return yama\.totalPrice === yazilan \? null : \{ toplam: yama\.totalPrice, matrah: yama\.kdvHaricTutar, kdv: yama\.kdvTutari \};/);
    expect(kodY).toMatch(/\{duzenlemeTutarOnizleme !== null && \(\s+<p role="status"/);
    // KAYIT tarafı da aynı girdileri ve aynı `onceki`'yi verir (önizleme kaydedilmeyecek bir tutarı «kaydedilir» diye göstermesin).
    const i = kodY.indexOf("siparisDuzenlemeYamasi<Order['status']>({");
    expect(i).toBeGreaterThan(-1);
    const kayit = kodY.slice(i, kodY.indexOf('updateDoc(', i));
    // Mağaza siparişinde tutar kilitlidir: kayıt da önizleme de formdaki metni değil kayıtlı tutarı verir (aynı ifade).
    expect(kayit).toMatch(/tutarHam: magazaKilidi \? sayiGirdisi\(selectedOrder\.totalPrice\) : editingTutarHam,\s+kdvHam: editingKdvHam,[\s\S]*\}, selectedOrder\);/);
  });
});

/**
 * Lojistik → "Aktif Sevkiyatlar" listesi (kullanıcı 2026-10-02: "tabloya tıklanmıyor"). Satırlarda `cursor-pointer` + hover vardı
 * ama `onClick` HİÇ yoktu; liste de "Aktif" başlığı altında TÜM siparişleri (hepsi "Teslim edildi") basıyordu. Bileşen 4.000
 * satırlık sayfanın içinde olduğu için davranış kaynak üzerinden sabitlenir.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

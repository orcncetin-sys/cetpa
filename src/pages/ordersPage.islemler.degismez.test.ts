/**
 * DEĞİŞMEZ — Siparişler detayındaki işlem düğmeleri (2026-09-25 kullanıcı bildirimleri, MF-383 ekranı). Sayfa
 * bileşeni için çizim düzeneği yok; kurallar KAYNAKTA çitlenir (yorum satırları süzülür). Davranış testleri:
 * utils/siparisler/siparisIslemleri.test.ts, components/siparis/MikroSiparisKalemleri.test.tsx, pano/stokSevkiyat.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { yorumsuz } from '../test/degismezTarayici';

const kod = yorumsuz(readFileSync(join(__dirname, 'OrdersPage.tsx'), 'utf-8')).join('\n');
const crm = yorumsuz(readFileSync(join(__dirname, 'CRMPage.tsx'), 'utf-8')).join('\n');

describe('Siparişler — işlem düğmeleri', () => {
  it('"Edit" / "Delete" sabit İngilizce etiket YOK (dil sözlüğünden)', () => {
    expect(kod).not.toMatch(/\/>\s*Edit\s*</);
    expect(kod).not.toMatch(/\/>\s*Delete\s*</);
    expect(kod).toMatch(/<Edit2 className="w-4 h-4" \/> \{oc\(currentLanguage\)\.duzenle\}/);
    expect(kod).toMatch(/<Trash2 className="w-4 h-4" \/> \{oc\(currentLanguage\)\.sil\}/);
  });
  it('Düzenle SİLME onayıyla açılmaz ("Kaydı Sil" başlığı + "Düzenle" onayı kopyası kalktı)', () => {
    expect(kod).not.toMatch(/confirmLabel:\s*currentT\.edit/);
  });
  it('Mikro kaynaklı kayıt Cetpa\'da düzenlenmez/silinmez — detay ve liste satırı aynı kurala bağlı', () => {
    expect((kod.match(/disabled=\{!yerelDegistirilebilir\((selectedOrder|order)\)\}/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it('sevkiyat: düğme ve pencere aynı kuralla (teslim edilmiş / iptal / açık sevkiyat) — ikinci çit dahil', () => {
    expect(kod).toMatch(/disabled=\{sevkiyatEngeli\(guncelSiparis\(selectedOrder\), shipments\) !== null\}/);
    expect(kod).toMatch(/const o = guncelSiparis\(showQuickShipment\);\s*const engel = sevkiyatEngeli\(o, shipments\);/);
    expect(kod).not.toMatch(/onClick=\{\(\) => setShowQuickShipment\(selectedOrder\)\}/);
  });
  it('Hızlı Sevkiyat penceresi ham kimlik kırpığı ("#mikrof") değil sipariş numarası basar', () => {
    expect(kod).not.toMatch(/#\{showQuickShipment\.id\.slice/);
  });
  it('kalem tablosu ve fiş Mikro kalemini `price` ile okumaz (ortak seçiciler)', () => {
    expect(kod).not.toMatch(/paraYaz\(item\.price\)/);
    expect(kod).not.toMatch(/paraYaz\(li\.price\)/);
    expect(kod).toMatch(/kalemleriMikrodanOkunacak\(o\)/);
  });
  it('tek yazma kapısı (yazilabilirSiparis) Mikro kaydını reddeder; durum seçicileri kilitli; toplu işlem Mikro kaydını atlar', () => {
    expect(kod).toMatch(/if \(ord && !yerelDegistirilebilir\(ord\)\) \{ toast\(yerelDegistirilemezMetni/);
    expect(kod).not.toMatch(/disabled=\{(selectedOrder|order)\.source === 'mikro-siparis'\}/);
    expect(kod).toMatch(/if \(!x \|\| !yerelDegistirilebilir\(x\)\) continue;/);
  });
  it('iç not Mikro kaynaklı siparişe de yazılır (ayrı kapı); fiş Mikro kalemlerini EKRANLA ORTAK modelden basar (K-İSKONTO)', () => {
    expect(kod).toMatch(/if \(!ordersKaydi\(selectedOrder\.id\)\) return;/);
    // Fiş ve ekran aynı modeli kullanır: sütunlar (birim fiyat → iskonto → net), masraf koşulu ve notlar tek yerde.
    // Fişte ayrı hesap (kalemleriCoz / kalemSaglamasi doğrudan) geri gelirse iskonto sütunu bir yüzeyde unutulur.
    expect(kod).toMatch(/mikroKalemTablosu\(mikroKalem505\.kalemler, o\.totalPrice, currentLanguage\)/);
    expect(kod).toMatch(/tablo505\.masraf !== null && tablo505\.masraf > 0/);
    expect(kod).not.toMatch(/\bkalemleriCoz\(|\bkalemSaglamasi\(/);
  });
  it('CRM sayfası da AYNI kural: iki Sil düğmesi + durum seçicisi + işleyiciler', () => {
    expect((crm.match(/disabled=\{!yerelDegistirilebilir\(order\)\}/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((crm.match(/if \(ord && !yerelDegistirilebilir\(ord\)\)/g) ?? []).length).toBe(2);
  });
});

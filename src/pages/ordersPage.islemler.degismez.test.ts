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
  it('Mikro kaynaklı kayıt Cetpa\'da düzenlenmez — detay ve liste satırı aynı kurala bağlı', () => {
    expect((kod.match(/disabled=\{!yerelDegistirilebilir\((selectedOrder|order)\)\}/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it('Sil düğmeleri SİLME kuralına bağlı (K-MF-SİL): MF sunucu ucundan, onay metni geri geleceğini söyler', () => {
    // İki düğme (liste satırı + detay) aynı kural; düzenleme kilidiyle (yerelDegistirilebilir) KARIŞMAZ.
    // Engel TEK kuraldan (kaynak + ROL): Satış/Lojistik silemez — düğme kapalı, gerekçe title'da (delta inceleme 2026-09-25).
    expect((kod.match(/disabled=\{silmeEngelMetni\((selectedOrder|order), userRole, currentLanguage\) !== null\}/g) ?? []).length).toBe(2);
    expect((kod.match(/onClick=\{\(\) => \{ if \(silmeEngelMetni\((selectedOrder|order), userRole, currentLanguage\)\) return; openConfirm/g) ?? []).length).toBe(2);
    // Detay paneli YALNIZ başarıda kapanır (başarısız silmede kapanması "silindi" izlenimi veriyordu).
    expect(kod).toMatch(/handleDeleteOrder\(selectedOrder\.id\)\.then\(ok => \{ if \(ok\) setSelectedOrder\(null\); \}\)/);
    expect(kod).not.toMatch(/handleDeleteOrder\(selectedOrder\.id\); setSelectedOrder\(null\)/);
    expect((kod.match(/message: silmeYolu\((selectedOrder|order)\) === 'mikroSunucu' \? mikroSilOnayMetni\(currentLanguage\)/g) ?? []).length).toBe(2);
    const isleyici = kod.slice(kod.indexOf('const handleDeleteOrder'), kod.indexOf('const applyOrderStock'));
    expect(isleyici).toMatch(/const yol = ord \? silmeYolu\(ord\) : 'yerel';/);
    // MF kaydı istemciden `orders`tan DOĞRUDAN silinmez — mezar kaydını sunucu yazar.
    expect(isleyici.indexOf("if (yol === 'mikroSunucu')")).toBeGreaterThan(-1);
    expect(isleyici.indexOf("if (yol === 'mikroSunucu')")).toBeLessThan(isleyici.indexOf("deleteDoc(doc(db, 'orders'"));
    expect(isleyici).toMatch(/await mikroSiparisiSil\(orderId/);
    silmeIsleyicisiCitleri(isleyici);
    // Dönüş değeri paneli kapatır/açık tutar: hata → false, yerel başarı → true (mutant: ikisi ters — delta 2 inceleme).
    expect(isleyici).toMatch(/toast\(silmeHataMetni\(error, currentLanguage\), 'error'\);[^\n]*\n\s*return false;\s*\}/);
    expect(isleyici).toMatch(/await deleteDoc\(doc\(db, 'orders', orderId\)\);\s*logAuditAction\([^;]*;\s*return true;\s*\} catch/);
    expect(isleyici).toMatch(/if \(engel\) \{ toast\(engel, 'warning'\); return false; \}/);
    expect(isleyici).toMatch(/if \(hata\) \{ toast\(hata, 'error'\); return false; \}/);
  });
  it('sistem notu (silinmişti — geri geldi) detayda ayrı, iç not kutusuna karışmadan gösterilir', () => {
    expect(kod).toMatch(/\{selectedOrder\.sistemNotu && \(/);
    expect(kod).not.toMatch(/setOrderNoteText\([^)]*sistemNotu/);
  });
  it('liste not göstergesi Siparişler + CRM\'de TEK kural (siparisNotMetni) — yalnız `notes`a bakan gösterge kalmadı', () => {
    for (const k of [kod, crm]) {
      expect(k).toMatch(/\{siparisNotMetni\(order\) && \(/);
      expect(k).toMatch(/title=\{siparisNotMetni\(order\)\}/);
      expect(k).not.toMatch(/\{order\.notes && \(/);
      expect(k).not.toMatch(/title=\{order\.notes\}/);
    }
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
    expect(kod).toMatch(/mikroKalemTablosu\(mikroKalem505 && mikroKalem505\.ok \? mikroKalem505\.kalemler : \[\], o\.totalPrice, currentLanguage\)/);
    // Sürüm-2 kalem (import 2026-09-25) fişte de AYNI modelden (kayitliKalemTablosu) — ekranla tek kural (kayitliMikroKalemleri).
    expect(kod).toMatch(/kayitliKalemTablosu\(kayitli505, o\.totalPrice, currentLanguage\)/);
    expect(kod).toMatch(/const kayitli505 = kayitliMikroKalemleri\(o\)/);
    expect(kod).toMatch(/\{kayitliMikroKalemleri\(selectedOrder\) \?/);
    expect(kod).toMatch(/\{kayitliMikroKalemleri\(order\) \?/);   // liste açılır satırı da AYNI kural (inceleme 2026-09-25)
    expect(kod).toMatch(/tablo505\.masraf !== null && tablo505\.masraf > 0/);
    expect(kod).not.toMatch(/\bkalemleriCoz\(|\bkalemSaglamasi\(/);
  });
  it('CRM sayfası da AYNI kural: iki Sil düğmesi silmeYolu, durum seçicisi düzenleme kilidi; işleyiciler', () => {
    expect((crm.match(/disabled=\{silmeEngelMetni\(order, userRole, currentLanguage\) !== null\}/g) ?? []).length).toBe(2);
    expect((crm.match(/disabled=\{!yerelDegistirilebilir\(order\)\}/g) ?? []).length).toBe(1);
    expect((crm.match(/if \(ord && !yerelDegistirilebilir\(ord\)\)/g) ?? []).length).toBe(1);
    const isleyici = crm.slice(crm.indexOf('const handleDeleteOrder'), crm.indexOf('const handleUpdateOrderStatus'));
    expect(isleyici).toMatch(/const yol = ord \? silmeYolu\(ord\) : 'yerel';/);
    expect(isleyici).toMatch(/mikroSilOnayMetni\(currentLanguage\)/);
    expect(isleyici.indexOf("if (yol === 'mikroSunucu')")).toBeGreaterThan(-1);
    expect(isleyici.indexOf("if (yol === 'mikroSunucu')")).toBeLessThan(isleyici.indexOf("deleteDoc(doc(db, 'orders'"));
    silmeIsleyicisiCitleri(isleyici);
    // Onay: MF → silinip geri geleceğini söyleyen metin; öteki yol olağan silme onayı (koşul ters çevrilemez).
    // Vazgeç → HİÇBİR silme yok: onay kapısı onay ifadesinin hemen ardında ve try'dan ÖNCE (satır silinirse eşleşmez).
    expect(isleyici).toMatch(/const onay = yol === 'mikroSunucu'\s*\? await confirmAction\(\{[^}]*message: mikroSilOnayMetni\(currentLanguage\)[^}]*\}\)\s*: await confirmDelete\([^)]*\);\s*if \(!onay\) return;\s*try \{/);
  });
});

/** İki sayfanın silme işleyicisi için ortak çitler (inceleme 2026-09-25: üç mutant ayırt edilmiyordu). */
function silmeIsleyicisiCitleri(isleyici: string): void {
  // (a) 'yok' yolu işleyicide de reddedilir (düğme disabled tek başına yetmez — başka çağıran olabilir), en başta.
  const red = /const engel = ord \? silmeEngelMetni\(ord, userRole, currentLanguage\) : null;\s*if \(engel\) \{ toast\(engel, 'warning'\); return( false)?; \}/;
  const m = isleyici.match(red);
  expect(m, 'engel (kaynak + rol) işleyicide de reddedilir').not.toBeNull();
  expect(isleyici.indexOf(m![0])).toBeLessThan(isleyici.indexOf("if (yol === 'mikroSunucu')"));
  // (c) başarısız silme SESSİZ değil: catch kullanıcıya söyler (eskiden yalnız konsol).
  expect(isleyici).toMatch(/catch \(error\) \{\s*handleFirestoreError\([^;]*;\s*toast\(silmeHataMetni\(error, currentLanguage\), 'error'\);/);
  // (b) sunucu silmesi başarılıysa ERKEN döner — akış yerel deleteDoc'a düşmez; hata toast'la döner.
  expect(isleyici).toMatch(/if \(hata\) \{ toast\(hata, 'error'\); return( false)?; \}\s*toast\(mikroSilindiMetni\(currentLanguage\), 'success'\);[^\n]*\n\s*return( true)?;\s*\}/);
}

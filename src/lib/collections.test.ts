/**
 * collections.test.ts — Koleksiyon sınıflandırmasının DEĞİŞMEZLERİ.
 *
 * NEDEN VAR: bu projedeki en çok tekrarlayan hata sınıfı, yeni bir koleksiyon
 * eklerken onu sınıflandırmayı unutmak. Sonucu SESSİZ: sınıfsız koleksiyon
 * `tenantWhere`'de WHERE eki almaz ve `rowVisible` sonunda `true` döner, yani
 * TÜM kiracılara açık olur — ama hiçbir hata çıkmaz, ekran çalışıyor görünür.
 *
 * Aynı hata en az dört kez yaşandı:
 *   2026-07-30  cariBalances, stockDiscrepancies, syncJobs, auditLog
 *   2026-08-18  mikroSiparisler, stockCounts
 *   2026-08-25  consignments, subscriptions, companies (bu tur)
 *   ayrıca RBAC tarafında: 22 koleksiyon kuralsız kalıp Admin dışı herkeste
 *               "buton çalışmıyor" (sessiz 403) üretti — Araç Ekle böyle bulundu.
 *
 * Bu testler o sessiz arızayı GÜRÜLTÜLÜ hale getirir: sınıflandırılmamış bir
 * koleksiyon artık kırmızı bir test olarak çıkar.
 */
import { describe, it, expect } from 'vitest';
import {
  TENANT_COLLECTIONS, USER_SCOPED_COLLECTIONS, SERVER_ONLY_COLLECTIONS,
  DELIBERATELY_UNSCOPED_COLLECTIONS,
} from './collections';
import {
  isAllowed, hasExplicitRule, STAFF_ROLES, ADMIN_ONLY_COLLECTIONS, APPEND_ONLY_COLLECTIONS,
  PUBLIC_WRITE_COLLECTIONS, type AppRole,
} from './rbac';

/** Admin her şeye yetkili (isAllowed en başta true döner) — bu yüzden
 *  "sessiz 403" sınıfını yakalamak için Admin OLMAYAN bir rol gerekir. */
const ADMIN_OLMAYAN: AppRole[] = STAFF_ROLES.filter(r => r !== 'Admin');

describe('koleksiyon sınıflandırması', () => {
  it('hiçbir koleksiyon iki sınıfta birden değil', () => {
    const sinif: Record<string, string[]> = {};
    const ekle = (ad: string, s: string) => { (sinif[ad] ||= []).push(s); };
    TENANT_COLLECTIONS.forEach(c => ekle(c, 'TENANT'));
    USER_SCOPED_COLLECTIONS.forEach(c => ekle(c, 'USER_SCOPED'));
    SERVER_ONLY_COLLECTIONS.forEach(c => ekle(c, 'SERVER_ONLY'));
    const cakisan = Object.entries(sinif).filter(([, s]) => s.length > 1);
    expect(cakisan, `Birden fazla sınıfta: ${JSON.stringify(cakisan)}`).toEqual([]);
  });

  it('aynı koleksiyon listede iki kez geçmiyor', () => {
    for (const [ad, liste] of Object.entries({ TENANT_COLLECTIONS, USER_SCOPED_COLLECTIONS, SERVER_ONLY_COLLECTIONS })) {
      const tekrar = liste.filter((c, i) => liste.indexOf(c) !== i);
      expect(tekrar, `${ad} içinde tekrar: ${tekrar}`).toEqual([]);
    }
  });

  it('SERVER_ONLY koleksiyonlar TENANT listesinde DEĞİL (aksi halde /api/db\'ye sızar)', () => {
    const sizinti = SERVER_ONLY_COLLECTIONS.filter(c => TENANT_COLLECTIONS.includes(c));
    expect(sizinti).toEqual([]);
  });
});

describe('RBAC — sessiz 403 koruması', () => {
  it('her TENANT koleksiyonunun bir erişim kuralı var', () => {
    // Kuralı olmayan koleksiyon zero-trust yedeğine düşer: Admin OLMAYAN
    // personel yalnız OKUR, yazamaz. İstemci o koleksiyona yazıyorsa kullanıcı
    // "buton çalışmıyor" der ve hiçbir log tutulmaz.
    // NOT: `isAllowed('Manager', ...)` ile ölçmek YANLIŞ olurdu — bir kural
    // Manager'ı BİLEREK dışlayabilir (shareholders yalnız Admin/Corporate,
    // tahsilatKayitlari yalnız Admin/Accounting gibi). Ölçülmesi gereken şey
    // "kural VAR MI", "kim yazabiliyor" değil.
    const kuralsiz = TENANT_COLLECTIONS.filter(c =>
      !hasExplicitRule(c) && !ADMIN_ONLY_COLLECTIONS.has(c) && !APPEND_ONLY_COLLECTIONS.has(c),
    );
    expect(kuralsiz, `Kuralsız TENANT koleksiyonları (zero-trust yedeğine düşer): ${kuralsiz.join(', ')}`).toEqual([]);
  });

  it('istemciden YAZILAN koleksiyonlarda ilgili roller gerçekten yazabiliyor', () => {
    // 2026-08-25'te bu ikisi kuralsızdı: stockCounts'a App.tsx sayım oturumunu
    // arşivliyor, syncJobs'a syncRetryService Mikro retry kuyruğunu yazıyor.
    // Admin dışındaki hiçbir rol yazamıyordu — ikisi de sessizce ölüydü.
    expect(isAllowed('Logistics', 'stockCounts', 'write')).toBe(true);
    expect(isAllowed('Sales', 'syncJobs', 'write')).toBe(true);
  });

  it('dış rollerin (B2B/Dealer) yazma yüzeyi TAM OLARAK B2B portalının ihtiyacı kadar', () => {
    // B2B/Dealer müşteri rolleridir: portalda sipariş verir ve teklif ister —
    // bu üçü BİLEREK açıktır. Test "hiç yazamaz" demiyor (o yanlış olurdu),
    // yüzeyin TAM olarak bu olduğunu sabitliyor: dördüncü bir koleksiyona
    // kazayla yazma izni verilirse (ör. inventory, payrolls, priceLists)
    // müşteri kendi fiyatını/stoğunu düzenleyebilir hale gelir ve bu test kırılır.
    const IZINLI = ['orders', 'quotations', 'recurringOrders'];
    const yazabilen = TENANT_COLLECTIONS
      .filter(c => isAllowed('B2B', c, 'write') || isAllowed('Dealer', c, 'write'))
      .sort();
    expect(yazabilen, `Dış rol yazma yüzeyi değişti: ${yazabilen.join(', ')}`).toEqual([...IZINLI].sort());
  });

  it('hassas koleksiyonları Admin olmayan personel okuyamaz', () => {
    for (const coll of ['tenantInvoices', 'companyStatus', 'invites']) {
      // Bu üçü SERVER_ONLY: /api/db'ye hiç ulaşmaz. Yine de RBAC katmanında da
      // savunma olsun diye ADMIN_ONLY'de olanların okunamadığını doğrularız.
      if (!ADMIN_ONLY_COLLECTIONS.has(coll)) continue;
      for (const rol of ADMIN_OLMAYAN.filter(r => r !== 'Manager')) {
        expect(isAllowed(rol, coll, 'read'), `${rol} ${coll} okuyabiliyor`).toBe(false);
      }
    }
  });
});

describe('Mikro SQL import hedefleri', () => {
  // `makeMikroSqlImport` (mikroRoutes.ts) her import ucuna
  // `requireCollectionAccess(opts.collection, 'write')` uyguluyor. Bu, hedef
  // koleksiyonun sınıflandırılmasını ZORUNLU kılar:
  //   - kuralı yoksa  -> Admin dışındaki herkes import'u tetikleyemez (sessiz 403)
  //   - TENANT değilse -> içeri akan Mikro verisi tüm kiracılara açık kalır
  // 2026-08-25 kod incelemesinde `barkodlar` ve `odemePlanlari` tam olarak bu
  // durumdaydı: kardeşleri (mikroDepolar/Bankalar/Kasalar) listedeyken bu ikisi
  // atlanmıştı ve yetki kapısı eklenince iki import ucu kilitlenecekti.
  const IMPORT_HEDEFLERI = [
    'mikroSiparisler', 'mikroFaturalar', 'mikroCariHareketler', 'inventoryMovements',
    'mikroBankalar', 'mikroKasalar', 'odemePlanlari', 'mikroDepolar',
    'barkodlar', 'mikroFiyatListeleri', 'mikroDemirbaslar', 'mikroMaliyetMerkezleri',
  ];

  it('hepsi TENANT olarak sınıflandırılmış', () => {
    const eksik = IMPORT_HEDEFLERI.filter(c => !TENANT_COLLECTIONS.includes(c));
    expect(eksik, `Sınıfsız import hedefi (kiracılar arası sızar): ${eksik.join(', ')}`).toEqual([]);
  });

  it('hepsinde açık erişim kuralı var (yoksa import ucu Admin dışında 403 döner)', () => {
    const kuralsiz = IMPORT_HEDEFLERI.filter(c =>
      !hasExplicitRule(c) && !ADMIN_ONLY_COLLECTIONS.has(c) && !APPEND_ONLY_COLLECTIONS.has(c));
    expect(kuralsiz, `Kuralsız import hedefi: ${kuralsiz.join(', ')}`).toEqual([]);
  });
});

describe('bilinçli olarak sınıfsız bırakılanlar', () => {
  it('hepsi gerçekten sınıfsız (liste bayatlamamış)', () => {
    // Bu liste "kazayla sınıfsız" ile "bilerek sınıfsız"ı ayırmak için var.
    // Biri sonradan TENANT'a eklenirse bu liste yanıltıcı olur.
    const artikSinifli = DELIBERATELY_UNSCOPED_COLLECTIONS.filter(c =>
      TENANT_COLLECTIONS.includes(c) || USER_SCOPED_COLLECTIONS.includes(c) || SERVER_ONLY_COLLECTIONS.includes(c));
    expect(artikSinifli, `Artık sınıflı ama "bilinçli sınıfsız" listesinde: ${artikSinifli.join(', ')}`).toEqual([]);
  });

  it('halka açık yazma uçları bilinçli-sınıfsız listesinde kayıtlı', () => {
    // PUBLIC_WRITE kimlik doğrulaması olmadan yazılabilir; TENANT olamazlar
    // (yazan kullanıcının kiracısı yok). Bu yüzden sınıfsızlıkları KASITLI.
    for (const c of PUBLIC_WRITE_COLLECTIONS) {
      expect(DELIBERATELY_UNSCOPED_COLLECTIONS, `${c} listede yok`).toContain(c);
    }
  });
});

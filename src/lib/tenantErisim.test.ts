/**
 * tenantErisim.test.ts — /api/db kiracı/kullanıcı kapsam kuralları (Faz 1 4/n, 2026-09-05). ÖNCE YAZILDI.
 *
 * Bu dört kural (listeleme WHERE'i, yazmada damga, sahiplik yüklemi, doküman sahipliği)
 * kiracılar-arası sızıntının TEK savunmasıdır (2026-08-11/22 denetimleri: users listesi
 * filtresizdi, A'nın Admin'i B'nin kullanıcısını silebiliyordu). server.ts'in içinde
 * kapanış olarak durdukları için import edilemiyor, dolayısıyla TESTSİZDİLER. Şimdi saf
 * modülde; kimlik tembel `cid()` getter'ıyla gelir — hangi yolda kiracı sorgusu YAPILMADIĞI
 * da sözleşmenin parçası (ilk çağrı DB'ye gider).
 */
import { describe, it, expect, vi } from 'vitest';
import { TENANT_COLLECTIONS, USER_SCOPED_COLLECTIONS, SERVER_ONLY_COLLECTIONS, DIS_ROL_SATIR_ALANI, DIS_ROL_YAZAMAZ } from './collections';
import { join } from 'path';
import { readdirSync, statSync } from 'fs';
import { kodSatirlari, SRC_KOK } from '../test/kaynakTarama';
import { yasakAlanlariKoru } from './tenantErisim';
import { STAFF_ROLES, EXTERNAL_ROLES, isAllowed, type AppRole } from './rbac';
import { kiraciWhere, kiraciDamgala, sahiplikDenetimli, dokumanSahibiMi, akisSatiriGorunur, akisKovalari, ayarSahibi, ayarAnahtari, ayarSatirlari, satirAlani, satirGorunur, siparisGorebilir, ayrilmisKimlikMi, ayrilmisKimlikAdayi, sahipsizDurumKodu, akisOlayKarari } from './tenantErisim';

const KIRACI = TENANT_COLLECTIONS[0];
const KISI = USER_SCOPED_COLLECTIONS[0];
const SINIFSIZ = 'olmayan_koleksiyon';
// `rol` varsayılanı iç rol (Sales): mevcut sözleşme testleri iç rol davranışını ölçer; dış rol vakaları aşağıda ayrıca.
const kimlik = (ek: { uid?: string; superAdmin?: boolean; rol?: AppRole | null } = {}) => {
  const { rol = 'Sales' as AppRole | null, ...kalan } = ek;
  return { uid: 'u1', cid: vi.fn(async () => 'A'), superAdmin: false, rol: vi.fn(async () => rol), ...kalan };
};

describe('kiraciWhere — listeleme WHERE eki (params $2\'den başlar)', () => {
  it('TENANT: kendi kiracısı VEYA etiketsiz (legacy doc sahibe görünür)', async () => {
    const w = await kiraciWhere(KIRACI, kimlik());
    expect(w.sql).toBe(" AND (data->>'companyId' = $2 OR NOT (data ? 'companyId'))");
    expect(w.params).toEqual(['A']);
  });
  it('USER_SCOPED: kendi uid VEYA etiketsiz; kiracı HİÇ sorulmaz (tembel)', async () => {
    const k = kimlik();
    const w = await kiraciWhere(KISI, k);
    expect(w.sql).toBe(" AND (data->>'userId' = $2 OR NOT (data ? 'userId'))");
    expect(w.params).toEqual(['u1']);
    expect(k.cid).not.toHaveBeenCalled();
  });
  it("users: kendi kiracısı VEYA kendi kaydı (id = $3) — FİLTRESİZ dönmez (2026-08-22 PII sızıntısı)", async () => {
    const w = await kiraciWhere('users', kimlik());
    expect(w.sql).toBe(" AND (data->>'companyId' = $2 OR id = $3)");
    expect(w.params).toEqual(['A', 'u1']);
  });
  it('users: süper-admin de filtrelidir (global okuma /api/superadmin/* işidir)', async () => {
    expect(await kiraciWhere('users', kimlik({ superAdmin: true }))).toEqual({ sql: " AND (data->>'companyId' = $2 OR id = $3)", params: ['A', 'u1'] });
  });
  it('sınıfsız koleksiyon: filtre yok, kiracı sorulmaz (rbac ayrıca karar verir)', async () => {
    const k = kimlik();
    expect(await kiraciWhere(SINIFSIZ, k)).toEqual({ sql: '', params: [] });
    expect(k.cid).not.toHaveBeenCalled();
  });
});

describe('kiraciDamgala — yazmada istemci değeri EZİLİR', () => {
  it("TENANT: istemcinin gönderdiği companyId'ye güvenilmez", async () => {
    expect(await kiraciDamgala(KIRACI, { x: 1, companyId: 'B' }, kimlik())).toEqual({ x: 1, companyId: 'A' });
  });
  it("USER_SCOPED: userId KOŞULSUZ damgalanır (eskiden `!('userId' in data)` şartı vardı — başkasının bildirimi yazılabiliyordu)", async () => {
    const k = kimlik();
    expect(await kiraciDamgala(KISI, { userId: 'u9' }, k)).toEqual({ userId: 'u1' });
    expect(k.cid).not.toHaveBeenCalled();
  });
  it('sınıfsız: dokunulmaz', async () => {
    expect(await kiraciDamgala(SINIFSIZ, { a: 1 }, kimlik())).toEqual({ a: 1 });
  });
});

describe('sahiplikDenetimli — ownsDoc hangi koleksiyonlarda çağrılır', () => {
  it('TENANT, USER_SCOPED ve users evet; sınıfsız hayır', () => {
    expect(sahiplikDenetimli(KIRACI)).toBe(true);
    expect(sahiplikDenetimli(KISI)).toBe(true);
    expect(sahiplikDenetimli('users')).toBe(true);   // iki sette de yok — eskiden 4 yolda atlanıyordu
    expect(sahiplikDenetimli(SINIFSIZ)).toBe(false);
  });
});

describe('dokumanSahibiMi — mevcut doküman sahibin mi', () => {
  it('yeni kayıt (docData yok) → serbest', async () => {
    expect(await dokumanSahibiMi(KIRACI, undefined, kimlik())).toBe(true);
  });
  it('TENANT: etiketsiz VEYA kendi kiracısı → evet; yabancı → HAYIR', async () => {
    expect(await dokumanSahibiMi(KIRACI, { x: 1 }, kimlik())).toBe(true);
    expect(await dokumanSahibiMi(KIRACI, { companyId: 'A' }, kimlik())).toBe(true);
    expect(await dokumanSahibiMi(KIRACI, { companyId: 'B' }, kimlik())).toBe(false);
  });
  it('USER_SCOPED: etiketsiz VEYA kendi uid → evet; başkasınınki → hayır; kiracı sorulmaz', async () => {
    const k = kimlik();
    expect(await dokumanSahibiMi(KISI, { userId: 'u1' }, k)).toBe(true);
    expect(await dokumanSahibiMi(KISI, {}, k)).toBe(true);
    expect(await dokumanSahibiMi(KISI, { userId: 'u2' }, k)).toBe(false);
    expect(k.cid).not.toHaveBeenCalled();
  });
  it('users: kendi kaydı → evet (kiracı sorulmadan); süper-admin → evet; yabancı kiracının kullanıcısı → HAYIR', async () => {
    const k = kimlik();
    expect(await dokumanSahibiMi('users', { companyId: 'Z' }, k, 'u1')).toBe(true);
    expect(k.cid).not.toHaveBeenCalled();
    expect(await dokumanSahibiMi('users', { companyId: 'Z' }, kimlik({ superAdmin: true }), 'u2')).toBe(true);
    expect(await dokumanSahibiMi('users', { companyId: 'A' }, kimlik(), 'u2')).toBe(true);
    expect(await dokumanSahibiMi('users', { companyId: 'B' }, kimlik(), 'u2')).toBe(false);
  });
  it('users: ETİKETSİZ users dokümanı BAŞKASININDIR → hayır (TENANT\'taki etiketsiz esnekliği burada YOK)', async () => {
    expect(await dokumanSahibiMi('users', { name: 'x' }, kimlik(), 'u2')).toBe(false);
  });
  it('sınıfsız → evet', async () => {
    expect(await dokumanSahibiMi(SINIFSIZ, { companyId: 'B' }, kimlik())).toBe(true);
  });
});

describe('akisSatiriGorunur — SSE ikinci kapı (4/n incelemesi: users dalı eksikti)', () => {
  const k = { uid: 'u1', cid: 'A', rol: 'Sales' as AppRole | null };
  it('users: kendi kaydı VEYA kendi kiracısı → evet; yabancı kiracı → HAYIR; ETİKETSİZ → HAYIR', () => {
    expect(akisSatiriGorunur('users', 'u1', { companyId: 'Z' }, k)).toBe(true);
    expect(akisSatiriGorunur('users', 'u2', { companyId: 'A' }, k)).toBe(true);
    expect(akisSatiriGorunur('users', 'u2', { companyId: 'B', email: 'x@b.com' }, k)).toBe(false);
    expect(akisSatiriGorunur('users', 'u2', { name: 'etiketsiz' }, k)).toBe(false);
  });
  it('TENANT ve settings: etiketsiz VEYA kendi kiracısı; USER_SCOPED: etiketsiz VEYA kendi uid', () => {
    expect(akisSatiriGorunur(KIRACI, 'd1', {}, k)).toBe(true);
    expect(akisSatiriGorunur(KIRACI, 'd1', { companyId: 'B' }, k)).toBe(false);
    expect(akisSatiriGorunur('settings', 'B__app', {}, k)).toBe(false);          // settings sahibi KİMLİKTEN (2026-10-02)
    expect(akisSatiriGorunur('settings', 'app', {}, k)).toBe(true);
    expect(akisSatiriGorunur(KISI, 'n1', { userId: 'u2' }, k)).toBe(false);
    expect(akisSatiriGorunur(KISI, 'n1', {}, k)).toBe(true);
  });
  it('sınıfsız → evet; veri yok → evet', () => {
    expect(akisSatiriGorunur(SINIFSIZ, 'x', { companyId: 'B' }, k)).toBe(true);
    expect(akisSatiriGorunur('users', 'u2', undefined, k)).toBe(true);
  });
});

describe('akisKovalari — SSE init SQL kovaları', () => {
  it("users KENDİ kovasında, 'diger'e (filtresiz) DÜŞMEZ; SERVER_ONLY hiçbir kovada değil", () => {
    const kova = akisKovalari(['users', KIRACI, KISI, SINIFSIZ, SERVER_ONLY_COLLECTIONS[0]], 'Sales');
    expect(kova.users).toEqual(['users']);
    expect(kova.diger).toEqual([SINIFSIZ]);
    expect(kova.tenant).toEqual([KIRACI]);
    expect(kova.user).toEqual([KISI]);
    expect([...kova.tenant, ...kova.user, ...kova.users, ...kova.ayar, ...kova.diger]).not.toContain(SERVER_ONLY_COLLECTIONS[0]);
  });
  it("settings KENDİ kovasında — filtresiz 'diger'e düşerse her kiracının `<cid>__*` ayarı diskten okunur (2026-10-02)", () => {
    const kova = akisKovalari(['settings', SINIFSIZ], 'Sales');
    expect(kova.ayar).toEqual(['settings']);
    expect(kova.diger).toEqual([SINIFSIZ]);
    expect(akisKovalari([KIRACI], 'Sales').ayar).toEqual([]);
  });
});

// 2026-10-02 — `settings` sızıntıları (ölçüldü): GET /api/db/settings kiracı süzgeçsizdi (başka kiracının `<cid>__app` dokümanları
// + sırları dökülüyordu); yazma/silmede sahiplik yoktu; akış `data.companyId`'yi kiracı etiketi sanıyordu (Luca firma kimliği!) ve
// firma-bazlı ayarı ham kimlikle gönderdiği için istemci kendi ayarını bulamıyordu. Kural artık DOKÜMAN KİMLİĞİNDEN.
describe('settings — kiracı kuralları kimlikten (2026-10-02 sızıntı düzeltmesi)', () => {
  it('ayarSahibi / ayarAnahtari: `<cid>__anahtar` → sahip + düz anahtar; `__` içermeyen kimlik global', () => {
    expect(ayarSahibi('A__app')).toBe('A');
    expect(ayarAnahtari('A__app')).toBe('app');
    for (const id of ['mikro', 'luca', '', undefined, '__app']) expect(ayarSahibi(id)).toBeNull();
    expect(ayarAnahtari('trendyol')).toBe('trendyol');
  });
  it('kiraciWhere: global ayarlar + YALNIZ kendi firma-bazlı ayarı — FİLTRESİZ dönmez; `data.companyId`\'ye bakmaz', async () => {
    expect(await kiraciWhere('settings', kimlik())).toEqual({ sql: " AND (position('__' in id) = 0 OR left(id, length($2)) = $2)", params: ['A__'] });
  });
  it('sahiplikDenetimli: settings evet (silme yolunda da ownsDoc çağrılsın)', () => {
    expect(sahiplikDenetimli('settings')).toBe(true);
  });
  it('dokumanSahibiMi: başka kiracının firma-bazlı ayarı HAYIR; kendi ve global evet; süper-admin ayrıcalığı yok', async () => {
    expect(await dokumanSahibiMi('settings', { apiKey: 'x' }, kimlik(), 'B__app')).toBe(false);
    expect(await dokumanSahibiMi('settings', { companyId: 'A' }, kimlik(), 'B__app')).toBe(false);          // veri etiketi kimliği EZMEZ
    expect(await dokumanSahibiMi('settings', {}, kimlik(), 'A__app')).toBe(true);
    expect(await dokumanSahibiMi('settings', { apiKey: 'x' }, kimlik(), 'trendyol')).toBe(true);
    expect(await dokumanSahibiMi('settings', {}, kimlik({ superAdmin: true }), 'B__app')).toBe(false);
  });
  it('LUCA: `settings/luca` içindeki `companyId` (Luca firma kimliği) kiracı etiketi DEĞİLDİR — sahibine görünür ve yazılabilir', async () => {
    const luca = { companyId: 'LUCA-FIRMA-77', apiKey: 'k' };
    expect(akisSatiriGorunur('settings', 'luca', luca, { uid: 'u1', cid: 'A', rol: 'Sales' })).toBe(true);
    expect(await dokumanSahibiMi('settings', luca, kimlik(), 'luca')).toBe(true);
  });
  it('akisSatiriGorunur: yabancı kiracının firma-bazlı ayarı akışa çıkmaz — damgası OLMASA da (adminDb yazımı)', () => {
    expect(akisSatiriGorunur('settings', 'B__companyProfile', { name: 'B A.Ş.' }, { uid: 'u1', cid: 'A', rol: 'Sales' })).toBe(false);
    expect(akisSatiriGorunur('settings', 'A__companyProfile', { name: 'A A.Ş.' }, { uid: 'u1', cid: 'A', rol: 'Sales' })).toBe(true);
    // İstemcinin global dokümana yazdığı sahte etiket görünürlüğü KAÇIRAMAZ.
    expect(akisSatiriGorunur('settings', 'trendyol', { companyId: 'B' }, { uid: 'u1', cid: 'A', rol: 'Sales' })).toBe(true);
  });
  it('ayarSatirlari: yabancı düşer; kendi firma-bazlı ayar DÜZ anahtarla; eski global kopya varsa firma-bazlı kazanır', () => {
    const r = ayarSatirlari([
      { id: 'mikro', data: 1 }, { id: 'app', data: 'eski-global' }, { id: 'A__app', data: 'kendi' }, { id: 'B__app', data: 'yabancı' },
      { id: 'A__gib', data: 'gib' }, { id: 'erpHub', data: 'yalnız-global' },
    ], 'A');
    expect(r).toEqual([{ id: 'mikro', data: 1 }, { id: 'erpHub', data: 'yalnız-global' }, { id: 'app', data: 'kendi' }, { id: 'gib', data: 'gib' }]);
  });
});

// 2026-10-02 — DIŞ ROL SATIR SÜZGECİ. `orders` dış rollere (B2B, Bayi) okuma + yazma açıktı ve sunucuda yalnız kiracı süzgeci
// vardı: Bayi kısıtı istemci sorgusundaydı ve sunucuya hiç gitmiyordu → dış rollü kullanıcı kiracının BÜTÜN siparişlerini
// (müşteri adı, adres, tutar, e-posta, telefon) alıyor ve değiştirebiliyordu. Kural: dış rol yalnız `assignedTo === uid` satırı.
describe('dış rol satır süzgeci — orders (2026-10-02)', () => {
  const DIS: Array<AppRole | null> = [...EXTERNAL_ROLES, null];   // rolü çözülemeyen kullanıcı da süzgeçli (kapalı başarısızlık)
  const KENDI = { companyId: 'A', assignedTo: 'u1', customerName: 'Şirin Yapı' };
  const BASKASININ = { companyId: 'A', assignedTo: 'u2', customerName: 'Gizli Müşteri' };
  const ETIKETSIZ = { companyId: 'A', customerName: 'Mikro faturası' };               // Mikro / pazar yeri / mağaza siparişi: sahiplik alanı yok
  const YABANCI_KIRACI = { companyId: 'B', assignedTo: 'u1' };
  const KIRACISIZ = { assignedTo: 'u1' };

  it('harita: her anahtar TENANT koleksiyonu; orders → assignedTo', () => {
    expect(DIS_ROL_SATIR_ALANI.get('orders')).toBe('assignedTo');
    for (const coll of DIS_ROL_SATIR_ALANI.keys()) expect(TENANT_COLLECTIONS, coll).toContain(coll);
  });
  it('satirAlani: dış rol ve ROLSÜZ → alan; HER iç rol → null; süzgeçsiz koleksiyon → null', () => {
    for (const r of DIS) expect(satirAlani('orders', r), String(r)).toBe('assignedTo');
    for (const r of STAFF_ROLES) expect(satirAlani('orders', r), r).toBeNull();
    expect(satirAlani('leads', 'B2B')).toBeNull();
    expect(satirAlani(SINIFSIZ, 'Dealer')).toBeNull();
  });
  it('satirGorunur: dış rol yalnız KENDİ satırını görür — başkasının, etiketsiz, yabancı kiracı, kiracısız → hayır', () => {
    const k = { uid: 'u1', cid: 'A' };
    for (const r of DIS) {
      expect(satirGorunur('orders', r, k, KENDI)).toBe(true);
      for (const d of [BASKASININ, ETIKETSIZ, YABANCI_KIRACI, KIRACISIZ, undefined, { companyId: 'A', assignedTo: null }, { companyId: 'A', assignedTo: 'guest' }]) {
        expect(satirGorunur('orders', r, k, d as Record<string, unknown> | undefined), `${r} ${JSON.stringify(d)}`).toBe(false);
      }
    }
    for (const d of [KENDI, BASKASININ, ETIKETSIZ]) expect(satirGorunur('orders', 'Sales', k, d)).toBe(true);   // iç rol etkilenmez
    expect(satirGorunur('orders', 'B2B', { uid: '', cid: 'A' }, { companyId: 'A', assignedTo: '' })).toBe(false);   // boş uid eşleşmez
  });
  it('kiraciWhere: dış rolde KATI (kiracı VE sahip; etiketsiz yok), alan adı parametre; iç rolde çıktı birebir eskisi', async () => {
    for (const r of DIS) {
      expect(await kiraciWhere('orders', kimlik({ rol: r }))).toEqual({ sql: " AND data->>'companyId' = $2 AND data->>$3 = $4", params: ['A', 'assignedTo', 'u1'] });
    }
    expect(await kiraciWhere('orders', kimlik({ rol: 'Sales' }))).toEqual({ sql: " AND (data->>'companyId' = $2 OR NOT (data ? 'companyId'))", params: ['A'] });
  });
  it('rol TEMBEL: satır süzgeçsiz koleksiyonda hiç sorulmaz', async () => {
    const k = kimlik({ rol: 'B2B' });
    await kiraciWhere('leads', k); await kiraciDamgala('leads', {}, k); await dokumanSahibiMi('leads', { companyId: 'A' }, k);
    expect(k.rol).not.toHaveBeenCalled();
    await kiraciWhere('orders', k);
    expect(k.rol).toHaveBeenCalledTimes(1);
  });
  it('kiraciDamgala: dış rol başkası adına / sahipsiz kayıt açamaz — sahiplik alanı KOŞULSUZ kendi uid\'i; iç rolde dokunulmaz', async () => {
    for (const r of DIS) {
      expect(await kiraciDamgala('orders', { assignedTo: 'u9', companyId: 'B', x: 1 }, kimlik({ rol: r }))).toEqual({ assignedTo: 'u1', companyId: 'A', x: 1 });
      expect(await kiraciDamgala('orders', { x: 1 }, kimlik({ rol: r }))).toEqual({ assignedTo: 'u1', companyId: 'A', x: 1 });
    }
    expect(await kiraciDamgala('orders', { assignedTo: 'u9' }, kimlik({ rol: 'Manager' }))).toEqual({ assignedTo: 'u9', companyId: 'A' });   // yeniden atama serbest
    expect(await kiraciDamgala('orders', { x: 1 }, kimlik({ rol: 'Sales' }))).toEqual({ x: 1, companyId: 'A' });                            // alan uydurulmaz
  });
  it('kiraciDamgala: dış rol pazar yeri eşleştirme alanlarını (DIS_ROL_YAZAMAZ) YAZAMAZ — sessizce düşer; iç rolde kalır; sahiplik damgası yine konur', async () => {
    const govde = { trendyolOrderNo: '1234567890', hepsiburadaOrderId: 'HB-1', customerName: 'x', x: 1 };
    for (const r of DIS) {
      expect(await kiraciDamgala('orders', govde, kimlik({ rol: r }))).toEqual({ customerName: 'x', x: 1, assignedTo: 'u1', companyId: 'A' });
    }
    for (const r of ['Admin', 'Manager', 'Sales'] as const) {
      expect(await kiraciDamgala('orders', govde, kimlik({ rol: r }))).toEqual({ ...govde, companyId: 'A' });
    }
    // Girdi nesnesi değiştirilmez.
    expect(Object.keys(govde)).toEqual(['trendyolOrderNo', 'hepsiburadaOrderId', 'customerName', 'x']);
  });
  it('DIS_ROL_YAZAMAZ: her anahtar satır süzgeçli koleksiyon; alanlar = sunucuda `orders`ı ALANLA arayan her yerin alanları (kanalRoutes + server.ts + src/server/**; kaynak çiti)', () => {
    for (const coll of DIS_ROL_YAZAMAZ.keys()) expect(DIS_ROL_SATIR_ALANI.has(coll), coll).toBe(true);
    expect([...(DIS_ROL_YAZAMAZ.get('orders') ?? [])].sort()).toEqual(['hepsiburadaOrderId', 'shopifyOrderId', 'trendyolOrderNo']);
    const dosyalar: string[] = [join(SRC_KOK, '..', 'server.ts')];
    const gez = (d: string): void => { for (const ad of readdirSync(d)) { const y = join(d, ad); if (statSync(y).isDirectory()) gez(y); else if (/\.ts$/.test(ad) && !/\.test\.ts$/.test(ad)) dosyalar.push(y); } };
    gez(join(SRC_KOK, 'server'));
    const OKUMA_ISTISNASI = new Set(['leadId']);   // server.ts: müşterinin açık siparişleri listesi — yalnız okur, üstüne yazmaz
    const eslesen = new Set<string>();
    for (const y of dosyalar) {
      const kod = kodSatirlari(y).map(s => s.kod).join('\n');
      // Satır kırılması toleranslı (`collection('orders')\n  .where(`); yalnız okuyan alanlar açık istisna kümesinde.
      for (const m of kod.matchAll(/collection\('orders'\)\s*\.where\(\s*'([A-Za-z]+)'/g)) if (!OKUMA_ISTISNASI.has(m[1])) eslesen.add(m[1]);
    }
    // Kodda alanla aranan HER alan listede olmalı (yeni eşleştirme eklenirse DIS_ROL_YAZAMAZ da büyür). Liste kodda artık
    // aranmayan alanı da tutabilir (sunucunun yazdığı alan dış role yine kapalı kalır — ör. Shopify eşleyicisi kimlikle eşleşmeye geçince).
    expect(eslesen.size).toBeGreaterThan(0);
    for (const alan of eslesen) expect(DIS_ROL_YAZAMAZ.get('orders'), alan).toContain(alan);
  });
  it('kiraciDamgala(…, onceki): dış rolün yazamadığı alan kayıtta önceden varsa KORUNUR (PATCH / PUT-merge «siler» değil); istemci değeri ezemez; iç rolde dokunulmaz', async () => {
    const onceki = { trendyolOrderNo: 'X', shopifyOrderId: 'S', customerName: 'eski', assignedTo: 'u1', companyId: 'A' };
    for (const r of DIS) {
      // PATCH-merge: birleşmiş gövde (önceki + yama) gelir; yama alanı değiştirmeye kalksa da önceki değer kalır
      expect(await kiraciDamgala('orders', { ...onceki, trendyolOrderNo: 'EVIL', status: 'x' }, kimlik({ rol: r }), onceki))
        .toEqual({ customerName: 'eski', status: 'x', trendyolOrderNo: 'X', shopifyOrderId: 'S', assignedTo: 'u1', companyId: 'A' });
      // Önceki kayıtta alan yoksa yazılamaz (düşer)
      expect(await kiraciDamgala('orders', { trendyolOrderNo: 'EVIL', x: 1 }, kimlik({ rol: r }), { customerName: 'eski' })).toEqual({ x: 1, assignedTo: 'u1', companyId: 'A' });
      // Önceki yoksa (POST) eski davranış
      expect(await kiraciDamgala('orders', { trendyolOrderNo: 'EVIL', x: 1 }, kimlik({ rol: r }))).toEqual({ x: 1, assignedTo: 'u1', companyId: 'A' });
    }
    expect(await kiraciDamgala('orders', { trendyolOrderNo: 'YENI', x: 1 }, kimlik({ rol: 'Sales' }), onceki)).toEqual({ trendyolOrderNo: 'YENI', x: 1, companyId: 'A' });
    expect(yasakAlanlariKoru('orders', onceki)).toEqual({ trendyolOrderNo: 'X', shopifyOrderId: 'S' });
    expect(yasakAlanlariKoru('orders', undefined)).toEqual({});
    expect(yasakAlanlariKoru('leads', onceki)).toEqual({});
  });
  it('dokumanSahibiMi: dış rol mevcut kayda yalnız KENDİSİNİNSE dokunur; yeni kayıt serbest; iç rol eskisi gibi', async () => {
    for (const r of DIS) {
      expect(await dokumanSahibiMi('orders', KENDI, kimlik({ rol: r }))).toBe(true);
      for (const d of [BASKASININ, ETIKETSIZ, YABANCI_KIRACI, KIRACISIZ]) expect(await dokumanSahibiMi('orders', d, kimlik({ rol: r })), JSON.stringify(d)).toBe(false);
      expect(await dokumanSahibiMi('orders', undefined, kimlik({ rol: r }))).toBe(true);
    }
    for (const d of [KENDI, BASKASININ, ETIKETSIZ, KIRACISIZ]) expect(await dokumanSahibiMi('orders', d, kimlik({ rol: 'Sales' }))).toBe(true);
    expect(await dokumanSahibiMi('orders', YABANCI_KIRACI, kimlik({ rol: 'Sales' }))).toBe(false);
  });
  it('akisSatiriGorunur: canlı akış AYNI kural', () => {
    for (const r of DIS) {
      const k = { uid: 'u1', cid: 'A', rol: r };
      expect(akisSatiriGorunur('orders', 'o1', KENDI, k)).toBe(true);
      for (const d of [BASKASININ, ETIKETSIZ, YABANCI_KIRACI, KIRACISIZ]) expect(akisSatiriGorunur('orders', 'o1', d, k), JSON.stringify(d)).toBe(false);
    }
    const ic = { uid: 'u1', cid: 'A', rol: 'Logistics' as AppRole };
    for (const d of [KENDI, BASKASININ, ETIKETSIZ, KIRACISIZ]) expect(akisSatiriGorunur('orders', 'o1', d, ic)).toBe(true);
  });
  it('akisKovalari: dış rolde orders `satir` kovasında ve `tenant`ta DEĞİL (ayrık); iç rolde tersi', () => {
    for (const r of DIS) {
      const kova = akisKovalari(['orders', 'leads'], r);
      expect(kova.satir).toEqual([{ coll: 'orders', alan: 'assignedTo' }]);
      expect(kova.tenant).toEqual(['leads']);
    }
    const ic = akisKovalari(['orders', 'leads'], 'Accounting');
    expect(ic.satir).toEqual([]);
    expect(ic.tenant).toEqual(['orders', 'leads']);
  });
  it('siparisGorebilir (/api/db dışındaki uçlar): kiracı + dış rolde satır', () => {
    const k = { uid: 'u1', cid: 'A' };
    expect(siparisGorebilir('Sales', k, BASKASININ)).toBe(true);
    expect(siparisGorebilir('Sales', k, ETIKETSIZ)).toBe(true);
    expect(siparisGorebilir('Sales', k, KIRACISIZ)).toBe(true);          // etiketsiz eski kayıt iç role kendi sayılır
    expect(siparisGorebilir('Sales', k, YABANCI_KIRACI)).toBe(false);
    expect(siparisGorebilir('Admin', k, undefined)).toBe(false);
    expect(siparisGorebilir('Dealer', k, KENDI)).toBe(true);
    expect(siparisGorebilir('Dealer', k, BASKASININ)).toBe(false);
    expect(siparisGorebilir('B2B', k, ETIKETSIZ)).toBe(false);
  });
  it('BİLİNÇLİ AÇIK listesi BOŞ: dış rolün YAZABİLDİĞİ, satır süzgeci olmayan TENANT koleksiyonu yok', () => {
    // 2026-10-11 (dış rol kapanışı, D1) — YENİDEN SABİTLENDİ. Eskiden `quotations` ve `recurringOrders` «bilinen açık» diye burada
    // adıyla duruyordu (satır süzgeci yok, dış rol yazıyor): bayi başka müşterinin teklifini değiştirebiliyordu. Kural tablosundan
    // dış rol çıktı; liste boşaldı ve BOŞ kalmalı. Satır süzgecinin kendisi (yukarıdaki testler) derinlemesine savunma olarak
    // DURUYOR: tabloya yanlışlıkla dış rol geri eklenirse `orders` yine yalnız kendi satırını gösterir.
    const acik = TENANT_COLLECTIONS.filter(c => EXTERNAL_ROLES.some(r => isAllowed(r, c, 'write')) && !DIS_ROL_SATIR_ALANI.has(c));
    expect(acik).toEqual([]);
    // Süzgeçli koleksiyon da dış role kapalı — süzgeç ikinci kattır, birincisi kural tablosu.
    for (const coll of DIS_ROL_SATIR_ALANI.keys()) {
      for (const r of EXTERNAL_ROLES) for (const op of ['read', 'write', 'delete'] as const) expect(isAllowed(r, coll, op), `${r} ${coll} ${op}`).toBe(false);
    }
  });
});

describe('ayrilmisKimlikMi — dış rol, sunucunun ürettiği biçimde (`__`) kimliğe yazamaz (kimlik kapma)', () => {
  const DIS: Array<AppRole | null> = [...EXTERNAL_ROLES, null];
  it('dış rol / rolsüz + `__` kimlik + görünür kayıt YOK → engel', () => {
    for (const r of DIS) expect(ayrilmisKimlikMi('orders', 'mikrofat__A__FTR-123', r, false), String(r)).toBe(true);
    expect(ayrilmisKimlikMi('orders', 'shopify__abc', 'Dealer', false)).toBe(true);
  });
  it('"yok" ile "var ama görünmez" AYNI karardır: tek girdi `gorunur` — varlık ayrı bir girdi DEĞİL (sızmaz)', () => {
    expect(ayrilmisKimlikMi.length).toBe(4);
    expect(ayrilmisKimlikMi('orders', 'mikrofat__A__FTR-1', 'B2B', false)).toBe(true);
  });
  it('kendisine GÖRÜNEN kayıt → engel yok (kendi siparişini güncelleyebilir)', () => {
    for (const r of DIS) expect(ayrilmisKimlikMi('orders', 'a__b', r, true), String(r)).toBe(false);
  });
  it('HER iç rol → engel yok (sunucu biçimli kimlikle içe aktarma / onarım iç rolün işidir)', () => {
    for (const r of STAFF_ROLES) expect(ayrilmisKimlikMi('orders', 'mikrofat__A__FTR-123', r, false), r).toBe(false);
  });
  it('`__` içermeyen kimlik ve süzgeçsiz koleksiyon → engel yok', () => {
    expect(ayrilmisKimlikMi('orders', 'rastgeleKimlik20hane', 'Dealer', false)).toBe(false);
    expect(ayrilmisKimlikMi('orders', 'tek_alt_cizgi', 'Dealer', false)).toBe(false);
    expect(ayrilmisKimlikMi('leads', 'a__b', 'Dealer', false)).toBe(false);
    expect(ayrilmisKimlikMi(SINIFSIZ, 'a__b', 'Dealer', false)).toBe(false);
  });
});

describe('ayrilmisKimlikAdayi — rol SORULMADAN önceki ucuz ön eleme (sunucu rolü yalnız aday ise sorar)', () => {
  const ROLLER: Array<AppRole | null> = [...EXTERNAL_ROLES, null, ...STAFF_ROLES];
  it('aday = görünür kayıt YOK + `__` kimlik + satır süzgeçli koleksiyon — üçü birden', () => {
    expect(ayrilmisKimlikAdayi('orders', 'mikrofat__A__FTR-123', false)).toBe(true);
    expect(ayrilmisKimlikAdayi('orders', 'shopify__abc', false)).toBe(true);
    expect(ayrilmisKimlikAdayi('orders', 'mikrofat__A__FTR-123', true)).toBe(false);   // kendisine görünen kayıt
    expect(ayrilmisKimlikAdayi('orders', 'rastgeleKimlik20hane', false)).toBe(false);  // `__` yok
    expect(ayrilmisKimlikAdayi('orders', 'tek_alt_cizgi', false)).toBe(false);
    expect(ayrilmisKimlikAdayi('leads', 'a__b', false)).toBe(false);                   // süzgeçsiz koleksiyon
    expect(ayrilmisKimlikAdayi(SINIFSIZ, 'a__b', false)).toBe(false);
  });
  it('ön eleme kararı DEĞİŞTİRMEZ: aday değilse HİÇBİR rolde engel yok; adaysa engel yalnız dış rol / rolsüzde', () => {
    for (const coll of ['orders', 'leads', SINIFSIZ]) for (const id of ['mikrofat__A__FTR-123', 'rastgeleKimlik20hane']) for (const gorunur of [false, true]) {
      const aday = ayrilmisKimlikAdayi(coll, id, gorunur);
      for (const r of ROLLER) {
        const icRol = r !== null && STAFF_ROLES.includes(r);
        expect(ayrilmisKimlikMi(coll, id, r, gorunur), `${coll} / ${id} / ${gorunur} / ${r}`).toBe(aday && !icRol);
      }
    }
  });
});

describe('sahipsizDurumKodu — sahiplik denetimi başarısız: dış role "yok" ile AYNI yanıt (404), aksi 403', () => {
  const DIS: Array<AppRole | null> = [...EXTERNAL_ROLES, null];
  it('satır süzgeçli HER koleksiyonda dış rol ve ROLSÜZ → 404 (varlık sızmaz)', () => {
    for (const coll of DIS_ROL_SATIR_ALANI.keys()) {
      for (const r of DIS) expect(sahipsizDurumKodu(coll, r), `${coll} / ${r}`).toBe(404);
      expect(sahipsizDurumKodu(coll, undefined), coll).toBe(404);
    }
  });
  it('HER iç rol → 403 (satır süzgeçli koleksiyonda da)', () => {
    for (const coll of DIS_ROL_SATIR_ALANI.keys()) for (const r of STAFF_ROLES) expect(sahipsizDurumKodu(coll, r), `${coll} / ${r}`).toBe(403);
  });
  it('süzgeçsiz koleksiyon → rol ne olursa olsun 403', () => {
    for (const coll of ['leads', KISI, 'users', 'settings', SINIFSIZ]) {
      for (const r of [...DIS, ...STAFF_ROLES]) expect(sahipsizDurumKodu(coll, r), `${coll} / ${r}`).toBe(403);
    }
  });
});

describe('akisOlayKarari — canlı akışta dış rol satır süzgeci (olay başına karar)', () => {
  const BAYI = { uid: 'u1', cid: 'A', rol: 'Dealer' as AppRole };
  const olay = (ek: Record<string, unknown>) => ({ coll: 'orders', id: 's1', type: 'set', cid: 'A', ...ek });

  it('başkasının siparişi → YUT (doküman gövdesi dış role hiç gitmez); küme değişmez', () => {
    const g = new Set<string>();
    expect(akisOlayKarari(olay({ satirSahibi: 'u2' }), BAYI, g)).toBe('yut');
    expect(g.size).toBe(0);
  });
  it('etiketsiz olay (Mikro / pazar yeri / mağaza siparişi: sahiplik alanı yok) → YUT', () => {
    const g = new Set<string>();
    expect(akisOlayKarari(olay({}), BAYI, g)).toBe('yut');
    expect(akisOlayKarari(olay({ satirSahibi: null }), BAYI, g)).toBe('yut');
  });
  it('yabancı kiracının olayı, aynı uid etiketiyle bile → YUT; kiracısız olay → YUT', () => {
    const g = new Set<string>();
    expect(akisOlayKarari(olay({ cid: 'B', satirSahibi: 'u1' }), BAYI, g)).toBe('yut');
    expect(akisOlayKarari(olay({ cid: undefined, satirSahibi: 'u1' }), BAYI, g)).toBe('yut');
    expect(akisOlayKarari(olay({ cid: null, satirSahibi: 'u1' }), BAYI, g)).toBe('yut');
  });
  it('kimliksiz olay → YUT (kimliği olmayan satır "kendi" sayılamaz)', () => {
    expect(akisOlayKarari(olay({ id: undefined, satirSahibi: 'u1' }), BAYI, new Set())).toBe('yut');
  });
  it('kendi siparişi → GÖNDER ve kümeye girer', () => {
    const g = new Set<string>();
    expect(akisOlayKarari(olay({ satirSahibi: 'u1' }), BAYI, g)).toBe('gonder');
    expect([...g]).toEqual(['orders/s1']);
  });
  it('YENİDEN ATAMA: daha önce gönderilmiş satır başkasına geçince → SİL (bir kez); sonraki olaylar YUT', () => {
    const g = new Set<string>();
    akisOlayKarari(olay({ satirSahibi: 'u1' }), BAYI, g);
    expect(akisOlayKarari(olay({ satirSahibi: 'u2' }), BAYI, g)).toBe('sil');
    expect(g.size).toBe(0);
    expect(akisOlayKarari(olay({ satirSahibi: 'u2' }), BAYI, g)).toBe('yut');
  });
  it('init\'te gönderilmiş satır (küme çağıran tarafından doldurulur) görünmez olunca da SİL', () => {
    const g = new Set<string>(['orders/s1']);
    expect(akisOlayKarari(olay({ satirSahibi: 'u2' }), BAYI, g)).toBe('sil');
  });
  it('kendi siparişinin silinmesi → GÖNDER ve kümeden çıkar (sonraki yabancı olay SİL üretmez)', () => {
    const g = new Set<string>(['orders/s1']);
    expect(akisOlayKarari(olay({ type: 'delete', satirSahibi: 'u1' }), BAYI, g)).toBe('gonder');
    expect(g.size).toBe(0);
    expect(akisOlayKarari(olay({ satirSahibi: 'u2' }), BAYI, g)).toBe('yut');
  });
  it('rolü çözülemeyen (null) kullanıcı da süzgeçlidir (kapalı başarısızlık)', () => {
    expect(akisOlayKarari(olay({ satirSahibi: 'u2' }), { uid: 'u1', cid: 'A', rol: null }, new Set())).toBe('yut');
    expect(akisOlayKarari(olay({ satirSahibi: 'u1' }), { uid: 'u1', cid: 'A', rol: null }, new Set())).toBe('gonder');
  });
  it('HER iç rol ve süzgeçsiz koleksiyon → GÖNDER, kümeye DOKUNULMAZ', () => {
    for (const r of STAFF_ROLES) {
      const g = new Set<string>();
      expect(akisOlayKarari(olay({ satirSahibi: 'u2' }), { uid: 'u1', cid: 'A', rol: r }, g), r).toBe('gonder');
      expect(g.size).toBe(0);
    }
    const g = new Set<string>();
    expect(akisOlayKarari({ coll: 'leads', id: 'l1', type: 'set', cid: 'A' }, BAYI, g)).toBe('gonder');
    expect(g.size).toBe(0);
  });
});


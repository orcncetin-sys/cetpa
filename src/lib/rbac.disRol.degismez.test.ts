/**
 * DEĞİŞMEZ — dış rol (B2B, Bayi) ERP'de HİÇBİR koleksiyonda HİÇBİR işlem yapamaz (şartname «dış rol kapanışı» D1 / D2 · T1 / T6).
 *
 * NEDEN VAR (2026-10-11 ölçümü): `Dealer` rolü 12 koleksiyonu okuyor, 6'sına yazıyordu; satır süzgeci yalnız `orders`'taydı.
 * Bayi stok kartını alış maliyeti ve tedarikçisiyle, kiracının BÜTÜN müşterilerinin tekliflerini, fiyat listelerini ve komisyon
 * kurallarını okuyor, herhangi bir teklifi değiştirebiliyordu. Akış (`/api/db/stream`) aynı izin işlevini kullandığı için canlı
 * da alıyordu. Kullanıcı kararı: bayi ekranı ERP'nin DIŞINDA çalışacak; dış rol ERP'de yalnız oturum açar.
 *
 * ÜÇ ÇİT:
 *  1. EXTERNAL_ROLES × HER koleksiyon × okuma / yazma / silme = false. Koleksiyon evreni elle YAZILMAZ: kural tablosunun
 *     anahtarlarından ve bütün sınıf listelerinden türer → yeni koleksiyon eklenince çit kendiliğinden kapsar; `EXTERNAL_ROLES`
 *     büyürse yeni dış rol de kapsanır. Kullanıcı kapsamlı koleksiyonlar DA evrendedir (şartname onları muaf tutuyordu):
 *     akış `requireAuth`'tan geçmez, bu işlevle karar verir — açık kalsalardı dış rol akıştan etiketsiz bildirimleri okurdu.
 *  2. Tablo satırının KENDİSİ dış rol taşımaz. `isAllowed` dış rolü en başta reddettiği için tabloya geri eklenen dış rolü
 *     göstermez; bu çit satıra bakar (mutasyon: `inventory.read`'e 'B2B' ekle → kırmızı).
 *  3. İç rollerin (ve rolsüz hesabın) matrisi tabanla (yayin-11 = a01a254, canlı) HÜCRE HÜCRE aynı: bu tur bir daraltma turu
 *     değildi. Taban `rbac.disRol.tabanMatris.json`'da DONDURULMUŞ duruyor (`git show yayin-11:src/lib/rbac.ts` ile üretildi).
 *
 * TEK istisna `isAllowed`'da değil: kişinin kendi `users/<uid>` belgesi (`isSelfDocAccess` — oturum açılışı). O AYNEN duruyor.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { oku, SRC_KOK } from '../test/kaynakTarama';
import {
  TENANT_COLLECTIONS, USER_SCOPED_COLLECTIONS, SERVER_ONLY_COLLECTIONS, DELIBERATELY_UNSCOPED_COLLECTIONS,
  DIS_ROL_SATIR_ALANI, DIS_ROL_YAZAMAZ,
} from './collections';
import {
  ADMIN_ONLY_COLLECTIONS, APPEND_ONLY_COLLECTIONS, APP_ROLES, EXTERNAL_ROLES, KURALLI_KOLEKSIYONLAR, PUBLIC_WRITE_COLLECTIONS,
  STAFF_ROLES, SUNUCU_YAZAR_COLLECTIONS, hasExplicitRule, isAllowed, isSelfDocAccess, kuralRolleri, type AppRole, type DbOp,
} from './rbac';

const ISLEMLER: readonly DbOp[] = ['read', 'write', 'delete'];
/** Hiçbir listede olmayan ad: kuralsız koleksiyon yedeği (eskiden dış role OKUMA veriyordu). */
const KURALSIZ_ORNEK = 'olmayan_koleksiyon';

/** Koleksiyon evreni — kural tablosu + bilinen BÜTÜN sınıf listeleri (+ kuralsız yedek dal için bir örnek ad). */
const EVREN: readonly string[] = [...new Set<string>([
  ...KURALLI_KOLEKSIYONLAR,
  ...TENANT_COLLECTIONS, ...USER_SCOPED_COLLECTIONS, ...SERVER_ONLY_COLLECTIONS, ...DELIBERATELY_UNSCOPED_COLLECTIONS,
  ...ADMIN_ONLY_COLLECTIONS, ...APPEND_ONLY_COLLECTIONS, ...PUBLIC_WRITE_COLLECTIONS, ...SUNUCU_YAZAR_COLLECTIONS,
  ...DIS_ROL_SATIR_ALANI.keys(), ...DIS_ROL_YAZAMAZ.keys(),
  KURALSIZ_ORNEK,
])].sort();

describe('D2 — dış rol × her koleksiyon × her işlem = false', () => {
  it('evren boş değil ve bütün sınıfları kapsıyor (çit boş kümede geçmesin)', () => {
    expect(EXTERNAL_ROLES.length).toBeGreaterThan(0);
    expect(KURALLI_KOLEKSIYONLAR.length).toBeGreaterThan(150);
    expect(EVREN.length).toBeGreaterThan(KURALLI_KOLEKSIYONLAR.length);
    for (const c of ['inventory', 'quotations', 'orders', 'users', 'settings', 'notifications', 'demoRequests', 'testimonials', 'invites', KURALSIZ_ORNEK]) {
      expect(EVREN, c).toContain(c);
    }
    // Evren kaynağı gerçekten tablo: dışa verilen ad listesi `hasExplicitRule` ile aynı şeyi söylüyor.
    expect(KURALLI_KOLEKSIYONLAR.filter(c => !hasExplicitRule(c))).toEqual([]);
    expect(hasExplicitRule(KURALSIZ_ORNEK)).toBe(false);
  });

  it('hiçbir dış rol hiçbir koleksiyonda okuyamaz / yazamaz / silemez', () => {
    const acik: string[] = [];
    for (const rol of EXTERNAL_ROLES) for (const coll of EVREN) for (const op of ISLEMLER) {
      if (isAllowed(rol, coll, op)) acik.push(`${rol} ${coll} ${op}`);
    }
    expect(acik, `Dış role açık hücre(ler): ${acik.join(' | ')}`).toEqual([]);
  });

  it('kural tablosunun hiçbir satırında dış rol yok (isAllowed erken reddi sökülse de tablo temiz)', () => {
    const kirli: string[] = [];
    for (const coll of KURALLI_KOLEKSIYONLAR) {
      const kural = kuralRolleri(coll);
      expect(kural, coll).not.toBeNull();
      if (!kural) continue;
      for (const op of ['read', 'write'] as const) {
        for (const rol of kural[op]) if (EXTERNAL_ROLES.includes(rol)) kirli.push(`${coll}.${op}: ${rol}`);
      }
    }
    expect(kirli, `Tabloda dış rol: ${kirli.join(' | ')}`).toEqual([]);
    expect(kuralRolleri(KURALSIZ_ORNEK)).toBeNull();
  });

  it('kaynak çiti: tablo satırları dış rolü ne adıyla ne `EXTERNAL_ROLES` yaymasıyla taşır; yedek dalda dış role okuma veren satır yok', () => {
    const kaynak = oku(join(SRC_KOK, 'lib', 'rbac.ts'));
    const bas = kaynak.indexOf('const COLLECTION_PERMISSIONS');
    const son = kaynak.indexOf('\n};', bas);
    expect(bas).toBeGreaterThan(0); expect(son).toBeGreaterThan(bas);
    const satirlar = kaynak.slice(bas, son).split('\n').filter(s => /^\s{2}[A-Za-z0-9_]+: \{ read:/.test(s));
    expect(satirlar.length).toBe(KURALLI_KOLEKSIYONLAR.length);                // ayrıştırma tablonun TAMAMINI görüyor
    const disAdlar = EXTERNAL_ROLES.map(r => `'${r}'`);
    expect(satirlar.filter(s => disAdlar.some(a => s.includes(a)) || s.includes('EXTERNAL_ROLES'))).toEqual([]);
    expect(kaynak).not.toMatch(/EXTERNAL_ROLES\.includes\(role\)\) return op === 'read'/);
    // Erken ret işlevin İLK koşulu: önüne geçen bir dal (ör. herkese açık form) dış role izin verebilirdi.
    const govde = kaynak.slice(kaynak.indexOf('export function isAllowed('));
    const ilkKosul = govde.split('\n').map(s => s.trim()).find(s => s.startsWith('if ('));
    expect(ilkKosul).toBe('if (role !== null && EXTERNAL_ROLES.includes(role)) return false;');
  });

  it('kullanıcı kapsamlı koleksiyonlar: dış role kapalı, HER iç role açık (okuma / yazma / silme) — davranış iç rolde aynı', () => {
    expect(USER_SCOPED_COLLECTIONS.length).toBeGreaterThan(0);
    for (const coll of USER_SCOPED_COLLECTIONS) for (const op of ISLEMLER) {
      for (const rol of EXTERNAL_ROLES) expect(isAllowed(rol, coll, op), `${rol} ${coll} ${op}`).toBe(false);
      for (const rol of STAFF_ROLES) expect(isAllowed(rol, coll, op), `${rol} ${coll} ${op}`).toBe(true);
      expect(isAllowed(null, coll, op), `rolsüz ${coll} ${op}`).toBe(false);
    }
  });

  it('TEK istisna yerinde: kişinin KENDİ users belgesi (isSelfDocAccess) — okuma / yazma açık, silme ve başkasının belgesi kapalı', () => {
    expect(isSelfDocAccess('users', 'bayi-1', 'bayi-1', 'read')).toBe(true);
    expect(isSelfDocAccess('users', 'bayi-1', 'bayi-1', 'write')).toBe(true);
    expect(isSelfDocAccess('users', 'bayi-1', 'bayi-1', 'delete')).toBe(false);
    expect(isSelfDocAccess('users', 'baskasi', 'bayi-1', 'read')).toBe(false);
    expect(isSelfDocAccess('inventory', 'bayi-1', 'bayi-1', 'read')).toBe(false);
    // İstisna tabloda DEĞİL: `users` koleksiyonunun kendisi dış role kapalı.
    for (const rol of EXTERNAL_ROLES) for (const op of ISLEMLER) expect(isAllowed(rol, 'users', op)).toBe(false);
  });
});

// ── T1 — iç rollerin matrisi tabanla aynı ──────────────────────────────────────────────────────────────────────────────────
interface Taban { taban: string; roller: string[]; tabloAnahtarSayisi: number; matris: Record<string, Record<DbOp, string[]>> }
const ROLSUZ = '(rolsüz)';
const taban = JSON.parse(oku(join(SRC_KOK, 'lib', 'rbac.disRol.tabanMatris.json'))) as Taban;
const rolAdi = (r: AppRole | null): string => r ?? ROLSUZ;

/**
 * Tabandan BİLEREK ayrılan iç rol hücreleri — bugün BOŞ. İleride bir iç rol kuralı bilerek değişirse anlık görüntü yeniden
 * ÜRETİLMEZ (o zaman «dış rol kapanışı iç rollere dokunmadı» kanıtı kaybolur); değişen hücre tarihi ve gerekçesiyle buraya yazılır.
 * Biçim: 'koleksiyon işlem rol' (rolsüz için '(rolsüz)').
 */
const TABANDAN_BILEREK_AYRILANLAR: ReadonlySet<string> = new Set<string>([
  // 2026-10-17 — Mikro rol kapısı karar turu H2 (`yayin-14`; bu dalın tabanı ona ilerledi): `eBelgeler` listesi tedarikçi fatura
  // numarasını taşıyor; kullanıcı kararı «Satış görmesin». Dış rol kapanışının değiştirdiği bir hücre DEĞİL.
  'eBelgeler read Sales',
]);

describe('T1 — iç rollerin ve rolsüz hesabın matrisi tabanla (yayin-11) aynı; fark YALNIZ dış rol hücreleri', () => {
  const IC: ReadonlyArray<AppRole | null> = [...STAFF_ROLES, null];

  it('anlık görüntü sağlam: taban sürümü, rol listesi ve kapsam', () => {
    expect(taban.taban).toMatch(/^yayin-11 = a01a254/);
    expect(taban.roller).toEqual([...APP_ROLES.map(rolAdi), ROLSUZ]);                  // rol kümesi tabandan beri değişmedi
    expect(Object.keys(taban.matris).length).toBeGreaterThan(taban.tabloAnahtarSayisi);
    // Taban gerçekten ESKİ kuralı taşıyor (bugünkü kuraldan üretilmiş bir dosya bu kanıtı boşaltırdı).
    expect(taban.matris.inventory.read).toContain('Dealer');
    expect(taban.matris.quotations.write).toContain('B2B');
    expect(taban.matris[KURALSIZ_ORNEK].read).toContain('Dealer');
  });

  it('iç rol ve rolsüz hücrelerin TAMAMI aynı', () => {
    const fark: string[] = [];
    let karsilastirilan = 0;
    for (const [coll, hucre] of Object.entries(taban.matris)) {
      if (!EVREN.includes(coll)) continue;                                              // tabandan sonra kaldırılmış koleksiyon
      for (const op of ISLEMLER) for (const rol of IC) {
        const eski = hucre[op].includes(rolAdi(rol));
        const yeni = isAllowed(rol, coll, op);
        karsilastirilan++;
        const anahtar = `${coll} ${op} ${rolAdi(rol)}`;
        if (eski !== yeni && !TABANDAN_BILEREK_AYRILANLAR.has(anahtar)) fark.push(`${anahtar}: ${eski} → ${yeni}`);
      }
    }
    expect(karsilastirilan).toBeGreaterThan(6000);                                     // ~200 koleksiyon × 3 işlem × 11 kimlik
    expect(fark, `İç rol matrisi tabandan ayrıştı (bilerekse TABANDAN_BILEREK_AYRILANLAR'a yaz): ${fark.join(' | ')}`).toEqual([]);
    // Bilerek ayrılan diye yazılan her hücre gerçekten ayrık olmalı (bayat istisna birikmesin).
    for (const anahtar of TABANDAN_BILEREK_AYRILANLAR) {
      const [coll, op, rol] = anahtar.split(' ');
      const r = rol === ROLSUZ ? null : APP_ROLES.find(x => x === rol) ?? null;
      expect(taban.matris[coll]?.[op as DbOp].includes(rol), anahtar).not.toBe(isAllowed(r, coll, op as DbOp));
    }
  });

  it('kapanan yüzey = tabanda dış role AÇIK olan hücrelerin tamamı (şartnamedeki ölçümle aynı sayılar)', () => {
    const sinifli = new Set([...TENANT_COLLECTIONS, ...USER_SCOPED_COLLECTIONS]);
    const tabanda = (rol: string, op: DbOp, kume: Iterable<string>) => [...kume].filter(c => taban.matris[c]?.[op].includes(rol)).sort();
    // Ölçüm (kapı 2, 2026-10-11): «Bayi 12 koleksiyonu okur, 6'sına yazar»; B2B ayrıca priceOverrides okur, recurringOrders yazar.
    expect(tabanda('Dealer', 'read', sinifli)).toEqual([
      'aiConsents', 'commissionRules', 'cpqQuotes', 'documentTemplates', 'inventory', 'notifications', 'orders', 'priceLists',
      'quotations', 'recurringOrders', 'userOnboarding', 'userPrefs',
    ]);
    expect(tabanda('Dealer', 'write', sinifli)).toEqual(['aiConsents', 'notifications', 'orders', 'quotations', 'userOnboarding', 'userPrefs']);
    expect(tabanda('B2B', 'read', sinifli)).toContain('priceOverrides');
    expect(tabanda('B2B', 'write', sinifli)).toContain('recurringOrders');
    // Bugün: aynı hücrelerin HEPSİ kapalı.
    for (const rol of EXTERNAL_ROLES) for (const op of ISLEMLER) {
      for (const coll of tabanda(rol, op, Object.keys(taban.matris))) expect(isAllowed(rol, coll, op), `${rol} ${coll} ${op}`).toBe(false);
    }
  });
});

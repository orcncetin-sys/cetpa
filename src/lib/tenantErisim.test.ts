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
import { TENANT_COLLECTIONS, USER_SCOPED_COLLECTIONS, SERVER_ONLY_COLLECTIONS } from './collections';
import { kiraciWhere, kiraciDamgala, sahiplikDenetimli, dokumanSahibiMi, akisSatiriGorunur, akisKovalari } from './tenantErisim';

const KIRACI = TENANT_COLLECTIONS[0];
const KISI = USER_SCOPED_COLLECTIONS[0];
const SINIFSIZ = 'olmayan_koleksiyon';
const kimlik = (ek: { uid?: string; superAdmin?: boolean } = {}) => ({ uid: 'u1', cid: vi.fn(async () => 'A'), superAdmin: false, ...ek });

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
  const k = { uid: 'u1', cid: 'A' };
  it('users: kendi kaydı VEYA kendi kiracısı → evet; yabancı kiracı → HAYIR; ETİKETSİZ → HAYIR', () => {
    expect(akisSatiriGorunur('users', 'u1', { companyId: 'Z' }, k)).toBe(true);
    expect(akisSatiriGorunur('users', 'u2', { companyId: 'A' }, k)).toBe(true);
    expect(akisSatiriGorunur('users', 'u2', { companyId: 'B', email: 'x@b.com' }, k)).toBe(false);
    expect(akisSatiriGorunur('users', 'u2', { name: 'etiketsiz' }, k)).toBe(false);
  });
  it('TENANT ve settings: etiketsiz VEYA kendi kiracısı; USER_SCOPED: etiketsiz VEYA kendi uid', () => {
    expect(akisSatiriGorunur(KIRACI, 'd1', {}, k)).toBe(true);
    expect(akisSatiriGorunur(KIRACI, 'd1', { companyId: 'B' }, k)).toBe(false);
    expect(akisSatiriGorunur('settings', 'app', { companyId: 'B' }, k)).toBe(false);
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
    const kova = akisKovalari(['users', KIRACI, KISI, SINIFSIZ, SERVER_ONLY_COLLECTIONS[0]]);
    expect(kova.users).toEqual(['users']);
    expect(kova.diger).toEqual([SINIFSIZ]);
    expect(kova.tenant).toEqual([KIRACI]);
    expect(kova.user).toEqual([KISI]);
    expect([...kova.tenant, ...kova.user, ...kova.users, ...kova.diger]).not.toContain(SERVER_ONLY_COLLECTIONS[0]);
  });
});

/**
 * faturasizSeri.ts — «Faturasız işlem = Mikro seri Q satış faturası» TANIMA kuralı. TEK KAYNAK; saf (istemci + sunucu).
 * Şartname `.wf/SARTNAME-q-serisi-v3.md` Q2 + «Kapı sonrası hükümler — Dilim 1» QH1 (05.11.2026).
 *
 * Kullanıcı kararı K1 (2026-10-10): faturasız satış Mikro'da evrak serisi «Q» olan bir SATIŞ faturasıdır; seri sorulmaz.
 * Seri bir AYAR değil SABİTTİR (v3 Q2-1): canlıda satış faturası serisi yalnız '' ve 'Q' ölçüldü (2026-10-17); seri değişirse
 * tek satır değişir. Kullanıcı (2026-10-19): «Q bir e-dönüşüm serisi değil — Mikro tarafında SQL'e özel açtık».
 *
 * Yön kısıtı (v3 Q2-2): yalnız GİDEN (satış) fatura faturasızdır. Gelen (alış) faturada aynı seri resmî sayılmaya devam eder.
 * Okuyucular `MikroFatura.faturasiz === true` okur (alan `mapMikroFatura`'da TEK yerde türetilir); alanı olmayan girdi
 * faturasız SAYILMAZ (eski fikstür ve eski doküman bugünkü sonucu verir).
 */

/** Faturasız satışın Mikro evrak serisi (K1). */
export const FATURASIZ_SERI = 'Q';

/** Cetpa (PG) tarafında seri karşılaştırma anahtarı: kırpılmış + ASCII büyük harfe katlanmış (şartname Q2: 'q' ile 'Q' aynı
 *  seridir). KOD KİMLİĞİ karşılaştırmasıdır, ekrana basılmaz — burada `toUpperCase()` doğru olandır (CLAUDE.md «karşılaştırmada
 *  tersi geçerli»); saklanan yazım `seri-ozet` `yazimlar` kırılımında AYNEN görünür.
 *  (2026-11-05: `server/mikro/seriOzet.ts`'ten buraya taşındı — istemci de aynı anahtarı kullanır; seriOzet buradan içe aktarır.) */
export const seriAnahtari = (v: unknown): string => String(v ?? '').trim().toUpperCase();

/** Seri faturasız (Q) mı? Kırpılır ve harf büyüklüğü katlanır: 'Q', ' q ', 'Q ' → true; '', 'F', 'LUCA', null → false. */
export const faturasizSeriMi = (seri: unknown): boolean => seriAnahtari(seri) === FATURASIZ_SERI;

/** Mikro faturası faturasız mı: GİDEN (satış) ∧ seri Q. Gelen Q resmî kalır (v3 Q2-2). */
export const faturasizMikroFaturaMi = (f: { yon?: unknown; seri?: unknown }): boolean =>
  f.yon === 'giden' && faturasizSeriMi(f.seri);

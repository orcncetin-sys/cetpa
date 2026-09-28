/**
 * saatTanisi.ts — canlı sunucunun ÜÇ ayrı saatinin tanısı (2026-09-28). Kullanıcı: "tzutil yaptım, doğrula".
 *
 * NEDEN VAR: ODEAWEB Windows sunucusu Pasifik dilimindeydi (bkz. zamanla.ts başlığı). Kullanıcı `tzutil /s "Turkey
 * Standard Time"` + `Restart-Service cetpa` yaptı; ama bunu dışarıdan doğrulayan HİÇBİR uç yoktu (SSH kapalı, bilerek).
 * Üç saat BİRBİRİNDEN BAĞIMSIZ değişir, üçü de ayrı raporlanır:
 *   1. Node süreci — dilimi AÇILIŞTA okur (ICU): tzutil sonrası servis yeniden başlatılmadıysa eski dilimde kalır.
 *      Mikro'ya giden belge tarihi (`govdeFaturaIrsaliye.mikroTarihi`) buna bağlı.
 *   2. PostgreSQL `TimeZone` GUC'u — kurulumda OS'tan kopyalanır, OS değişince KENDİLİĞİNDEN DEĞİŞMEZ
 *      (`ALTER SYSTEM SET timezone = 'Europe/Istanbul'; SELECT pg_reload_conf();`).
 *   3. Mikro'nun SQL Server'ı — `SYSDATETIMEOFFSET()` OS dilimini okur; Mikro'nun kendi damgaları buradan gelir.
 * Salt okuma; hata YUTULMAZ, alanına yazılır (tanı ucu bir parçası okunamadı diye düşmez). Sır / müşteri verisi yok.
 */

export interface SaatTanisi {
  node: { dilim: string | null; ofsetDakika: number; yerel: string };
  pg: { dilim: string | null; simdi: string | null } | { hata: string } | null;
  mikro: { simdi: string | null; yerel: string | null } | { hata: string } | null;
}

export interface SaatTanisiBaglami {
  pgSorgu?: ((sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>) | null;
  /** Mikro yapılandırılmamışsa null → alan null (bilinmiyor ≠ hata). */
  mikroSorgu?: ((sql: string) => Promise<{ rows: Record<string, unknown>[]; hata: string | null }>) | null;
  simdi?: Date;
}

const metin = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const hataMetni = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Bir sorgunun `ms` içinde bitmesini bekler; bitmezse zaman aşımı hatası (tanı ucu asılı kalmasın). */
async function sinirli<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, red) => { t = setTimeout(() => red(new Error(`${ms} ms zaman aşımı`)), ms); })]);
  } finally { if (t) clearTimeout(t); }
}

export async function saatTanisi(b: SaatTanisiBaglami, zamanAsimiMs = 8000): Promise<SaatTanisi> {
  const simdi = b.simdi ?? new Date();
  let dilim: string | null = null;
  try { dilim = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { dilim = null; }
  const node = { dilim, ofsetDakika: simdi.getTimezoneOffset(), yerel: simdi.toString() };

  // İki sorgu PARALEL: en kötü durumda tanı ucu ~zamanAsimiMs bekler (sıralı iken 2×).
  const { pgSorgu, mikroSorgu } = b;
  const pgSozu: Promise<SaatTanisi['pg']> = !pgSorgu ? Promise.resolve(null) : (async () => {
    try {
      const { rows } = await sinirli(pgSorgu("SELECT current_setting('TimeZone') AS dilim, now()::text AS simdi"), zamanAsimiMs);
      return { dilim: metin(rows[0]?.dilim), simdi: metin(rows[0]?.simdi) };
    } catch (e) { return { hata: hataMetni(e) }; }
  })();
  const mikroSozu: Promise<SaatTanisi['mikro']> = !mikroSorgu ? Promise.resolve(null) : (async () => {
    try {
      const r = await sinirli(mikroSorgu('SELECT CONVERT(varchar(40), SYSDATETIMEOFFSET(), 127) AS simdi, CONVERT(varchar(30), GETDATE(), 126) AS yerel'), zamanAsimiMs);
      return r.hata ? { hata: r.hata.slice(0, 200) } : { simdi: metin(r.rows[0]?.simdi), yerel: metin(r.rows[0]?.yerel) };
    } catch (e) { return { hata: hataMetni(e) }; }
  })();
  const [pg, mikro] = await Promise.all([pgSozu, mikroSozu]);
  return { node, pg, mikro };
}

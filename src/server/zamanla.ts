/**
 * Zamanlanmış iş — TEK KAYNAK. Her cron ifadesi Europe/Istanbul takvimiyle okunur.
 *
 * Neden var (2026-09-24, ölçüldü): canlı Windows sunucu Pasifik saat diliminde
 * çalışıyor (PG damgaları -07; gece Mikro senkronunun syncLog satırları
 * 03:20-07 = 13:20 İstanbul). node-cron dilim verilmeyince SÜREÇ saatini
 * kullanır; 2026-07-01 göçünden beri "sabah 08:30" bekçisi 18:30'da, "gece
 * 03:20" Mikro senkronu mesai ortasında koşuyordu. Dilim burada sabitlenir;
 * `cron.schedule` başka yerden çağrılmaz (zamanla.degismez.test.ts tarar).
 *
 * Sunucunun kendi dilimi düzeltilse de bu sarmalayıcı kalır: iş takvimi
 * barındırıcının ayarına bağlı olmamalı (staging, taşınma, yeni makine).
 * Windows Görev Zamanlayıcı'daki yedek görevi (deploy.ps1, 03:30) sunucu-yerel
 * saattedir; bekçinin 26 saatlik tazelik eşiği her iki dilimde de tutar.
 *
 * node-cron kaçırılan koşuyu TELAFİ ETMEZ (runner heartBeat yalnız uyarı loglar):
 * duvar saati İLERİ adımlanırsa (elle saat ayarı, w32tm step) o günkü 03:20 /
 * 08:15 / 08:30 işi sessizce ertesi güne kalır; GERİ adım çift koşu üretmez
 * (ölçüldü, inceleme 2026-09-24). Saat DİLİMİNİ değiştirmek epoch'u değiştirmez,
 * bu sınıfa girmez. Kural: sunucu saatini elle ADIMLAMA; adım olduysa
 * `Restart-Service cetpa` — süreç açılışta tüm heartbeat'leri yeniden kurar.
 * Bkz. deploy/windows/RUNBOOK.md [11].
 */
import cron, { type TaskFn } from 'node-cron';

export const IS_SAAT_DILIMI = 'Europe/Istanbul';

export function zamanla(ifade: string, is: TaskFn): ReturnType<typeof cron.schedule> {
  return cron.schedule(ifade, is, { timezone: IS_SAAT_DILIMI });
}

/**
 * İş takviminde gün anahtarı `YYYY-MM-DD` (Europe/Istanbul). Bir işin TETİĞİ
 * İstanbul'a bağlıyken gövdesinin `getDate()` ile süreç-yerel takvimden gün
 * türetmesi yarım düzeltmedir: 08:30 İstanbul, Pasifik süreçte 22:30 ÖNCEKİ
 * gündür → `opsChecks/<gün>` id'si bir gün geride kalır, "dünkü" kıyası boşa
 * düşer (inceleme 2026-09-24). Gün anahtarı üreten her yer BUNU kullanır.
 */
export function isGunu(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IS_SAAT_DILIMI, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

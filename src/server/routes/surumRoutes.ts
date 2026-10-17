/**
 * surumRoutes.ts — `GET /api/surum`: yayındaki istemci paketinin sürüm kimliği (şartname `.wf/SARTNAME-yeni-surum-bildirimi.md` S2).
 *
 * Açık sekme bu uca 5 dakikada bir ve yeniden görünür olduğunda sorar; yanıt kendi paketine gömülü kimlikten farklıysa ekranın
 * altında «Yeni sürüm yayında» şeridi çıkar (istemci: src/lib/yeniSurum.ts).
 *
 *  • KİMLİKSİZ: giriş ekranında ve dış rol sayfasında da sorulur; yanıt kimseye özel değildir.
 *  • YALNIZ `{ surum }`: sürüm kimliği (16 haneli paket karması) ya da `null`. Sır / ortam / yol / commit bilgisi YOK —
 *    dosyada başka alan olsa da gövdeye girmez; biçimi tutmayan değer `null` sayılır.
 *  • `Cache-Control: no-store`: tarayıcı, hizmet çalışanı ya da vekil eski yanıtı saklamasın (yoksa bildirim hiç çıkmazdı).
 *  • Kaynak `dist/surum.json` (derleme eklentisi yazar: src/derleme/surumEklentisi.ts). Dosya HER istekte okunur — sunucunun o an
 *    verdiği `dist/index.html` ile aynı derlemeden gelsin. Dosya yoksa (geliştirme, eski derleme) `{ surum: null }`: istemci
 *    bildirim göstermez.
 *  • Hız sınırı: KENDİ kovası (`surumLimiter`, server.ts'te kurulur — çit: hizSiniri.degismez.test.ts), yalnız IP. Rota genel
 *    sınırlayıcıdan (`app.use('/api', apiLimiter)`) ÖNCE kaydedilir ve isteği kendisi sonlandırır: bir ofisin bütün sekmeleri
 *    aynı dış IP'den sorar, genel kimliksiz kovada (IP başına 300 / 15 dk) sayılsaydı aynı IP'nin öbür kimliksiz isteklerini
 *    (kur, takip, form) 429'a düşürebilirdi. GET'tir, gövde ayrıştırıcıya gerek yoktur.
 *
 * Bağımlılıklar AÇIK bağlam nesnesiyle gelir (server.ts deseni; ters yönde `import` döngü olurdu).
 */
import { readFile } from 'node:fs/promises';
import type { Express, Request, RequestHandler, Response } from 'express';
import { SURUM_UCU, surumGecerli } from '../../lib/surumKimligi.js';

export interface SurumRouteCtx {
  /** Bu ucun kendi sınırlayıcısı (server.ts). */
  surumLimiter: RequestHandler;
  /** `dist/surum.json`'un tam yolu. */
  surumDosyasi: string;
}

/** Sürüm dosyasını okur; dosya yok / bozuk / biçim dışıysa `null` (hata fırlatmaz). */
export async function surumDosyasiniOku(dosya: string): Promise<string | null> {
  let ham: string;
  try { ham = await readFile(dosya, 'utf8'); } catch { return null; }
  try {
    const veri: unknown = JSON.parse(ham);
    if (!veri || typeof veri !== 'object') return null;
    const surum = (veri as { surum?: unknown }).surum;
    return surumGecerli(surum) ? surum : null;
  } catch { return null; }
}

export function surumRoutes(app: Express, C: SurumRouteCtx): void {
  app.get(SURUM_UCU, C.surumLimiter, async (_req: Request, res: Response) => {
    const surum = await surumDosyasiniOku(C.surumDosyasi);
    res.set('Cache-Control', 'no-store');
    res.json({ surum });
  });
}

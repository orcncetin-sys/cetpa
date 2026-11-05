/**
 * surumluOnbellek.ts — okuma / düşürme yarışına KAPALI küçük süreç içi önbellek (2026-10-21, «müşteri siparişlerim» Tur 2 A parçası
 * incelemesi).
 *
 * YARIŞ: okuma `await` içindeyken kayıt değişir ve değişiklik olayı `dusur` / `temizle`'yi çağırırsa, bekleyen okuma ESKİ değeri
 * önbelleğe yazıp ömrü boyunca (60 sn) yaşatırdı: kapatılan erişim, düşürülen rol, askıya alınan firma ya da yeni açılan iki
 * adımlı doğrulama bir dakika eski hâliyle görünürdü. Çözüm TEK sürüm sayacı: okuma başlarken (ilk `await`ten ÖNCE) sürümü alır;
 * `dusur` / `temizle` sürümü artırır; okuma yalnız sürüm DEĞİŞMEDİYSE önbelleğe yazar. Döndürdüğü değer o okumanın sonucudur
 * (çağıran onu kullanır); bir sonraki çağrı veritabanını yeniden okur.
 *
 * Sayaç ANAHTAR başına değil, örnek başınadır: `dusur(a)` uçuştaki `b` okumasını da önbelleğe yazdırmaz (zararsız — bir sonraki
 * çağrı yeniden okur); `temizle` her anahtarı kapsamak zorunda olduğu için tek sayaç en küçük doğru biçimdir.
 *
 * Kullananlar (kopya YOK): `kanal/magazaPanelKullanici.ts` (`panelKullanicisiKur`) ve `musteriHesap.ts` (`musteriHesapOkuyucuKur`).
 * Okuma HATASI yutulmaz: `oku` fırlatırsa `get` de fırlatır, önbelleğe bir şey yazılmaz (kapı 503).
 */

export interface SurumluOnbellek<T> {
  /** Süresi dolmamış kayıt varsa onu, yoksa `oku()`nun sonucunu verir; okuma sürerken düşürme geldiyse sonuç önbelleğe YAZILMAZ. */
  get: (anahtar: string, oku: () => Promise<T>) => Promise<T>;
  dusur: (anahtar: string) => void;
  temizle: () => void;
}

export interface SurumluOnbellekSecenekleri<T> {
  /** Kaydın ömrü (ms). */
  omurMs: number;
  simdiMs: () => number;
  /** Hangi sonuç önbelleğe yazılır; verilmezse hepsi (bulunmayan / `null` sonuç dâhil). */
  saklansinMi?: (deger: T) => boolean;
}

export function surumluOnbellekKur<T>(s: SurumluOnbellekSecenekleri<T>): SurumluOnbellek<T> {
  const kayitlar = new Map<string, { deger: T; bitis: number }>();
  let surum = 0;
  return {
    async get(anahtar, oku) {
      const kayit = kayitlar.get(anahtar);
      if (kayit && kayit.bitis > s.simdiMs()) return kayit.deger;
      const okumaSurumu = surum;
      const deger = await oku();
      if (surum === okumaSurumu && (s.saklansinMi === undefined || s.saklansinMi(deger))) {
        kayitlar.set(anahtar, { deger, bitis: s.simdiMs() + s.omurMs });
      }
      return deger;
    },
    dusur(anahtar) { surum += 1; kayitlar.delete(anahtar); },
    temizle() { surum += 1; kayitlar.clear(); },
  };
}

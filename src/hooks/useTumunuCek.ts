/**
 * useTumunuCek.ts — "Tümünü Çek" sırasının DURUMU bileşen ömründen BAĞIMSIZ, modül düzeyinde TEK
 * (delta hakem 2026-09-25, bulgu 9 CONFIRMED/orta).
 *
 * NEDEN: döngü `MikroSyncPanel`in yerel state'indeydi ve iptal edilemiyordu. Her arka plan adımı artık işin
 * bitişini bekliyor (adım başına ≤ 30 dk, `isiBaslatVeBekle`) → sıra dakikalar/saatler sürüyor. Panel
 * unmount olunca (ERPHubPanel 'Bağlantı Bilgileri' sekmesi, kart daraltma, Ayarlar'dan çıkış) döngü görünmeden
 * sürüyor, geri dönüşte yerel `tumuRunning` false → düğme yeniden basılabiliyordu → İKİNCİ döngü: önceki
 * arka plan adımları 'Başka bir iş çalışıyor' ile reddediliyor, senkron uçlar (bakiye/mizan/kdv + 4 uç)
 * birincinin koşan işiyle EŞZAMANLI Mikro'ya gidiyordu (Mikro tek servis, eşzamanlı yükte çöküyor);
 * birincinin özeti hiçbir yerde görünmüyordu.
 *
 * KARAR: sıra modül düzeyinde TEK — koşarken ikinci başlatma YOK SAYILIR; panel yeniden açılınca sürmekte
 * olan sıranın adımını ve bitince özetini görür (`useSyncExternalStore`). Sıra sekme ömrüncedir: sekme
 * kapanırsa sıra durur, sunucudaki koşan iş sürer (sunucu kilidi yine tek iş). Adım fonksiyonları başlatan
 * panelin kapanışlarıdır; senkron adımların kart state'i o panel kapandıysa güncellenmez ama hata metni
 * ÖZETE yazılır (MikroSyncPanel `senkronAdim`, bulgu 10).
 */
import { useSyncExternalStore } from 'react';

export interface TumunuCekAdimi { ad: string; calistir: () => Promise<void> }
export interface TumunuCekHatasi { ad: string; metin: string }

/**
 * Adım bunu atarsa sıra DURUR (inceleme bulgusu 2026-09-25): hata özete yazılır, kalan adımlar KOŞTURULMAZ.
 * Kullanım: arka plan adımı zaman aşımına uğradı → sunucudaki iş hâlâ sürüyor ve global kilidi tutuyor;
 * sıra sürseydi sonraki arka plan adımları 'Başka bir iş çalışıyor' alır, senkron adımlar koşan işle
 * EŞZAMANLI Mikro'ya giderdi (Mikro tek servis, eşzamanlı yükte çöküyor).
 */
export class SirayiDurdurHatasi extends Error {
  constructor(metin: string) { super(metin); this.name = 'SirayiDurdurHatasi'; }
}

/** Sıra neden durdu: `oturum` = başlatan kullanıcı artık oturumda değil; `adim` = bir adım SirayiDurdurHatasi attı. */
export interface TumunuCekDurdurma { sebep: 'oturum' | 'adim'; kalan: string[] }

export interface TumunuCekSecenek {
  /**
   * Oturumdaki kullanıcının kimliği (uid; yoksa null). Sıra başlarken okunur, HER adımdan önce yeniden
   * okunur; değiştiyse sıra durur (inceleme bulgusu 2026-09-25): sıra modül düzeyinde yaşadığı için çıkış +
   * başka kullanıcıyla giriş sonrası kalan adımlar YENİ kullanıcının jetonuyla koşar, işler ve denetim kaydı
   * ona yazılırdı. Verilmezse kontrol yapılmaz (testler).
   */
  kimlik?: () => string | null;
}
export interface TumunuCekDurumu {
  calisiyor: boolean;
  /** Koşan adımın adı (düğme metni). */
  adim: string | null;
  /** Son BİTEN sıranın özeti; yeni sıra başlayınca silinir (eski özet yeni koşuya aitmiş gibi durmasın). */
  ozet: { ok: number; hatalar: TumunuCekHatasi[]; durduruldu?: TumunuCekDurdurma } | null;
}

const BOS: TumunuCekDurumu = { calisiyor: false, adim: null, ozet: null };
let durum: TumunuCekDurumu = BOS;
/** Sıfırlama kuşağı: `tumunuCekSifirla` sonrası eski sıranın geç gelen güncellemeleri yok sayılır. */
let kusak = 0;
const dinleyiciler = new Set<() => void>();

function yayinla(): void { for (const d of dinleyiciler) d(); }
/** Yalnız kendi kuşağının sırası yazar. */
function yaz(k: number, yeni: TumunuCekDurumu): void {
  if (k !== kusak) return;
  durum = yeni;
  yayinla();
}

/**
 * Sırayı başlatır; zaten koşuyorsa `null` döner (ikinci döngü YOK). Adımlar SIRAYLA koşar (Mikro eşzamanlı
 * yükte çöküyor); bir adım hata verirse DURMAZ, adı + metni özete yazılır. İKİ istisna sırayı durdurur ve
 * kalan adımları `ozet.durduruldu.kalan`a yazar: adım `SirayiDurdurHatasi` atarsa ve `secenek.kimlik`
 * başlangıçtakinden farklı dönerse. Dönen söz ASLA reject etmez.
 */
export function tumunuCekBaslat(adimlar: TumunuCekAdimi[], secenek: TumunuCekSecenek = {}): Promise<void> | null {
  if (durum.calisiyor) return null;
  const k = kusak;
  const { kimlik } = secenek;
  const baslatan = kimlik ? kimlik() : null;
  yaz(k, { calisiyor: true, adim: null, ozet: null });
  const kos = async (): Promise<void> => {
    let ok = 0;
    const hatalar: TumunuCekHatasi[] = [];
    let durduruldu: TumunuCekDurdurma | undefined;
    try {
      for (let i = 0; i < adimlar.length; i++) {
        const adim = adimlar[i];
        if (k !== kusak) return;   // sıfırlandı — eski sıra DURUR (sonraki adımı başlatmaz)
        if (kimlik && kimlik() !== baslatan) {
          durduruldu = { sebep: 'oturum', kalan: adimlar.slice(i).map(a => a.ad) };
          break;
        }
        yaz(k, { calisiyor: true, adim: adim.ad, ozet: null });
        try { await adim.calistir(); ok++; }
        catch (e) {
          hatalar.push({ ad: adim.ad, metin: e instanceof Error ? e.message : String(e) });
          if (e instanceof SirayiDurdurHatasi) {
            durduruldu = { sebep: 'adim', kalan: adimlar.slice(i + 1).map(a => a.ad) };
            break;
          }
        }
      }
    } finally {
      yaz(k, { calisiyor: false, adim: null, ozet: { ok, hatalar, ...(durduruldu ? { durduruldu } : {}) } });
    }
  };
  return kos();
}

const abone = (dinleyici: () => void) => {
  dinleyiciler.add(dinleyici);
  return () => { dinleyiciler.delete(dinleyici); };
};
const anlik = () => durum;

/** Sıranın canlı durumu — tüketici: MikroSyncPanel (düğme + özet). */
export function useTumunuCek(): TumunuCekDurumu {
  return useSyncExternalStore(abone, anlik, anlik);
}

/** TEST DİKİŞİ: modül durumu testler arasında sızmasın (koşan sıra kuşak değişince durur). */
export function tumunuCekSifirla(): void {
  kusak++;
  durum = BOS;
  yayinla();
}

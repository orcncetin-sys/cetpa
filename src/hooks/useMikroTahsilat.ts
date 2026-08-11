/**
 * useMikroTahsilat.ts — Mikro cari hareketlerinden AÇIK ALACAK (tahsilat) türet.
 *
 * Neden var: Muhasebe → Tahsilat ekranı yalnız elle girilen `tahsilatKayitlari`
 * koleksiyonunu okuyordu; Mikro'daki gerçek borç/alacak hareketleri ekrana hiç
 * düşmüyordu (KPI'lar ve yaşlandırma sıfır görünüyordu). Cari Ekstre'de aynı
 * yaşlandırma tek cari için zaten hesaplanıyordu — burada TÜM cariler için.
 *
 * YÖNTEM (standart FIFO mahsuplaşma):
 *   borç (cha_tip=0) = Cetpa'nın alacağı (satış faturası, borç dekontu)
 *   alacak (cha_tip=1) = tahsilat/iade
 *   Alacaklar EN ESKİ borçtan başlayarak kapatılır; kapanmayan borç bakiyesi
 *   "açık alacak"tır, yaşı da o borcun vadesinden (yoksa tarihinden) sayılır.
 *
 * Bakiye işareti kuralı: eksi = Cetpa borçlu. Burada yalnız Cetpa'nın ALACAKLI
 * olduğu (pozitif kalan) kalemler tahsilat listesine girer.
 */
import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from '../lib/dbClient';
import { db } from '../firebase';

export interface AcikAlacak {
  id: string;
  cariKod: string;
  belgeNo: string;
  aciklama: string;
  /** Hareketin kendi tarihi (fatura tarihi). 'YYYY-MM-DD' */
  tarih: string;
  /** Vade — Mikro'da varsa cha_vade_tarihi, yoksa `tarih`. 'YYYY-MM-DD' */
  vade: string;
  /** Belgenin ilk tutarı. */
  tutar: number;
  /** Mahsuplaşma sonrası kapanan kısım. */
  tahsilEdilen: number;
  /** Kalan açık bakiye (tutar - tahsilEdilen), her zaman > 0. */
  acik: number;
  /** Vadeye göre gecikme günü (negatifse henüz vadesi gelmemiş). */
  gecikmeGun: number;
}

interface HamHareket {
  id: string;
  cariKod: string;
  tarih: string;
  vade: string;
  tip: number;      // 0 = borç, 1 = alacak
  meblag: number;
  belgeNo: string;
  aciklama: string;
}

const gun = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86_400_000);

/** mikroCariHareketler'i dinleyip FIFO mahsuplaşmayla açık alacakları döndür. */
export function useMikroTahsilat(enabled: boolean): { acikAlacaklar: AcikAlacak[]; yuklendi: boolean } {
  const [hareketler, setHareketler] = useState<HamHareket[]>([]);
  const [yuklendi, setYuklendi] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const unsub = onSnapshot(
      collection(db, 'mikroCariHareketler'),
      (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => {
        setHareketler(snap.docs.map(d => {
          const x = d.data();
          const tarih = String(x.cha_tarihi ?? '').slice(0, 10);
          const seri = String(x.cha_evrakno_seri ?? '').trim();
          const sira = x.cha_evrakno_sira;
          return {
            id: d.id,
            cariKod: String(x.cha_kod ?? '').trim(),
            tarih,
            // Vade kolonu bu Mikro kurulumunda olmayabilir → fatura tarihine düş.
            vade: String(x.cha_vade_tarihi ?? '').slice(0, 10) || tarih,
            tip: Number(x.cha_tip ?? 0),
            meblag: Number(x.cha_meblag ?? 0) || 0,
            belgeNo: [seri, sira].filter(v => v !== '' && v != null).join('-'),
            aciklama: String(x.cha_aciklama ?? '').trim(),
          };
        }));
        setYuklendi(true);
      },
      () => { setHareketler([]); setYuklendi(true); },
    );
    return () => unsub();
  }, [enabled]);

  const acikAlacaklar = useMemo(() => {
    const bugun = new Date();
    bugun.setHours(0, 0, 0, 0);

    // Cari bazında grupla
    const cariler = new Map<string, HamHareket[]>();
    for (const h of hareketler) {
      if (!h.cariKod || !h.tarih || !h.meblag) continue;
      const liste = cariler.get(h.cariKod);
      if (liste) liste.push(h); else cariler.set(h.cariKod, [h]);
    }

    const sonuc: AcikAlacak[] = [];
    for (const [, liste] of cariler) {
      liste.sort((a, b) => a.tarih.localeCompare(b.tarih));

      // Borçları sırayla kuyruğa al, alacakları en eskiden başlayarak düş.
      const acikBorclar: { h: HamHareket; kalan: number }[] = [];
      for (const h of liste) {
        if (h.tip === 0) {
          acikBorclar.push({ h, kalan: Math.abs(h.meblag) });
        } else {
          let kredi = Math.abs(h.meblag);
          for (const b of acikBorclar) {
            if (kredi <= 0) break;
            const dus = Math.min(b.kalan, kredi);
            b.kalan -= dus;
            kredi   -= dus;
          }
          // Artan kredi = peşin/avans; açık alacak üretmez, yok sayılır.
        }
      }

      for (const b of acikBorclar) {
        // Kuruş altı kalıntılar mahsuplaşma yuvarlamasından gelir — gerçek borç değil.
        if (b.kalan < 0.01) continue;
        const vd = new Date(b.h.vade);
        sonuc.push({
          id: b.h.id,
          cariKod: b.h.cariKod,
          belgeNo: b.h.belgeNo,
          aciklama: b.h.aciklama,
          tarih: b.h.tarih,
          vade: b.h.vade,
          tutar: Math.abs(b.h.meblag),
          tahsilEdilen: Math.abs(b.h.meblag) - b.kalan,
          acik: b.kalan,
          gecikmeGun: Number.isNaN(vd.getTime()) ? 0 : gun(bugun, vd),
        });
      }
    }
    sonuc.sort((a, b) => b.gecikmeGun - a.gecikmeGun);
    return sonuc;
  }, [hareketler]);

  return { acikAlacaklar, yuklendi };
}

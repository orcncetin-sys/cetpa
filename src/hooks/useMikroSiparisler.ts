import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from '../lib/dbClient';
import { db } from '../firebase';
import { bilinenSayi } from '../utils/para';

export interface MikroSiparis {
  id: string;
  tarih: string;
  evrakNo: string;
  cariKodu: string;
  /**
   * Sipariş tutarı — **`NaN` = BİLİNMİYOR** (2026-09-19 delta bulgusu).
   *
   * Eskiden `Number(d.sip_tutar || 0)` idi: Mikro aynasında `sip_tutar` NULL gelen kayıt
   * (`mikroMirror.ts:405` `numOrNull`) "bilinen ₺0" oluyor ve meşru sıfırdan ayırt
   * edilemiyordu. Aynı sipariş Pano'da (ham kolonu okuyan `mikroBirlesim`) "1 kayıt tutarsız"
   * diye '—' basılırken, OrdersPage Mikro sekmesinde ve PurchasingModule'de "₺0,00" tutarlı
   * bir sipariş gibi listeleniyor, KPI/CSV toplamlarına 0 olarak giriyordu.
   *
   * Okuyan taraf `Number.isFinite` ile süzmeli; ham kolon (`sip_tutar`) `...d` ile
   * dokümanda zaten duruyor.
   */
  tutar: number;
  tip: number; // 0 = Alınan (Satış), 1 = Verilen (Alış) vs.
  [key: string]: any;
}

export function useMikroSiparisler(enabled: boolean = true): MikroSiparis[] {
  const [data, setData] = useState<MikroSiparis[]>([]);

  useEffect(() => {
    if (!enabled) return;

    const q = query(
      collection(db, 'mikroSiparisler'),
      orderBy('sip_tarih', 'desc'),
      limit(2000)
    );

    const unsub = onSnapshot(q, (snap) => {
      const records = snap.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          tarih: d.sip_tarih || '',
          evrakNo: [d.sip_evrakno_seri, d.sip_evrakno_sira].filter(Boolean).join(''),
          cariKodu: d.sip_musteri_kod || '',
          tutar: bilinenSayi(d.sip_tutar) ? Number(d.sip_tutar) : NaN,   // `|| 0` bilinmeyeni ₺0 yapıyordu
          tip: Number(d.sip_tip || 0),
          ...d
        } as MikroSiparis;
      });
      setData(records);
    }, (error) => {
      console.error('Mikro siparişleri dinlenirken hata:', error);
    });

    return () => unsub();
  }, [enabled]);

  return data;
}

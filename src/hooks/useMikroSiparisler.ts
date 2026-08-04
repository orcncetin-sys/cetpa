import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from '../lib/dbClient';
import { db } from '../firebase';

export interface MikroSiparis {
  id: string;
  tarih: string;
  evrakNo: string;
  cariKodu: string;
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
          tutar: Number(d.sip_tutar || 0),
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

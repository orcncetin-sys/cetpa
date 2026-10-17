import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { useAppStore } from '../store/appStore';
import { ucKapisindanGecer } from '../lib/mikroUcKapilari';

export interface MikroUretimRecetesi {
  rec_kod: string;
  rec_isim: string;
  rec_ana_stok_kod: string;
  rec_cinsi: number;
  rec_create_date: string;
  [key: string]: any;
}

/**
 * Mikro üretim reçeteleri (`POST /api/mikro/pull/uretim-receteleri` — uç `bom` koleksiyonuna YAZAR).
 *
 * ROL KAPISI (karar turu 2026-10-11 — K5, İ3, İ4): ucun sunucudaki kapısı `bom` yazma kuralıdır. Kanca kendi kapısını
 * ortak tablodan (`lib/mikroUcKapilari.ts`) sorar; rol geçemiyorsa açılış çağrısı HİÇ yapılmaz. Eskiden Üretim ekranını
 * açan her rol bu ucu çağırıyor, kapıdan geçemeyen rolün 403'ü aşağıdaki `console.error` ile yutuluyordu (sessiz 403).
 * Tek çağıran `BOMPanel`; bileşen değişmedi — kapıyı kanca bilir, çağıran unutamaz.
 *
 * Geçen rolde gerçek arıza (ağ, 5xx) konsola yazılmaya devam eder: çağıran bileşen bu kancadan hata okumuyor ve ekranın
 * verisi `bom` koleksiyonundan geliyor (uç satır döndürmez). Açılıştaki gizli import (şartname § 6 A2) ayrı iş.
 */
export function useMikroUretimReceteleri() {
  const yetkili = ucKapisindanGecer(useAppStore(s => s.userRole), 'POST /api/mikro/pull/uretim-receteleri');
  const [receteler, setReceteler] = useState<MikroUretimRecetesi[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // İ3: rol kapıdan geçemiyorsa istek ATILMAZ (oturum beklenmez, jeton istenmez).
    if (!yetkili) return;
    let active = true;

    async function fetchReceteler() {
      try {
        const user = auth.currentUser;
        if (!user) {
          if (active) setLoading(false);
          return;
        }

        const token = await user.getIdToken();
        const res = await fetch('/api/mikro/pull/uretim-receteleri', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({})
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (json.success && json.data && active) {
          setReceteler(json.data as MikroUretimRecetesi[]);
        }
      } catch (err) {
        console.error('Failed to fetch Mikro Uretim Receteleri:', err);
      } finally {
        if (active) setLoading(false);
      }
    }

    // Try fetching when mounted
    auth.authStateReady().then(() => {
      fetchReceteler();
    });

    return () => { active = false; };
  }, [yetkili]);

  // Kapıdan geçemeyen rolde çekim hiç başlamaz → «yükleniyor» da değildir.
  return { receteler, loading: yetkili && loading };
}

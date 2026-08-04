import { useState, useEffect } from 'react';
import { auth } from '../firebase';

export interface MikroUretimRecetesi {
  rec_kod: string;
  rec_isim: string;
  rec_ana_stok_kod: string;
  rec_cinsi: number;
  rec_create_date: string;
  [key: string]: any;
}

export function useMikroUretimReceteleri() {
  const [receteler, setReceteler] = useState<MikroUretimRecetesi[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, []);

  return { receteler, loading };
}

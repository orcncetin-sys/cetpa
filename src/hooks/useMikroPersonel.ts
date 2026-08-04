import { useState, useEffect } from 'react';
import { authFetch } from '../services/authFetch';

export interface MikroPersonel {
  mikroPersKod: string;
  name: string;
  surname: string;
  email: string;
  phone: string;
  department: string;
  position: string;
  salary: number;
  startDate: string;
  status: string;
  tcId: string;
}

export function useMikroPersonel() {
  const [data, setData] = useState<MikroPersonel[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPersonel = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/mikro/pull/personel', { method: 'POST' });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setData(json.data);
      } else {
        throw new Error(json.error || 'Personel verisi alınamadı');
      }
    } catch (err: any) {
      console.error('Personel fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPersonel();
  }, []);

  return { data, loading, refetch: fetchPersonel };
}

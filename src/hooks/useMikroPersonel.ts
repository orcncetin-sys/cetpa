import { useState, useEffect } from 'react';
import { apiCall } from '../lib/api';
import { toast } from 'react-hot-toast';

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
      const res = await apiCall('/api/mikro/pull/personel', { method: 'POST' });
      if (res.success && Array.isArray(res.data)) {
        setData(res.data);
      } else {
        throw new Error(res.error || 'Personel verisi alınamadı');
      }
    } catch (err: any) {
      console.error('Personel fetch error:', err);
      toast.error(err.message || 'Mikro personel listesi çekilirken hata oluştu');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPersonel();
  }, []);

  return { data, loading, refetch: fetchPersonel };
}

/**
 * Mikro faturasından türeyen siparişin kalemleri Cetpa'ya aktarılmamışsa (2026-09-25 kullanıcı bildirimi: MF-383
 * "sipariş kalemleri gelmemiş") Mikro'dan canlı okunur. Kalıcı çözüm importun boş kalemleri geri doldurması (ayrı iş);
 * bu hook o güne kadar — ve import sonrası kalemleri hâlâ eksik kalan kayıtlarda — ekranı doğru tutar.
 */
import { useEffect, useState } from 'react';
import { kalemleriMikrodanOkunacak, mikroFaturaKalemleriGetir } from '../services/mikroFaturaKalemleri';

type Durum = 'gerekmez' | 'yukleniyor' | 'hazir' | 'hata';

export function useMikroSiparisKalemleri(
  o: Parameters<typeof kalemleriMikrodanOkunacak>[0],
  tr: boolean,
): { durum: Durum; kalemler: Record<string, unknown>[]; hata: string | null } {
  const evrak = kalemleriMikrodanOkunacak(o);
  const anahtar = evrak ? `${evrak.seri}|${evrak.sira}|${evrak.yon}` : null;
  const [sonuc, setSonuc] = useState<{ anahtar: string; kalemler: Record<string, unknown>[] | null; hata: string | null } | null>(null);

  useEffect(() => {
    if (!evrak || !anahtar) return;
    let iptal = false;
    void mikroFaturaKalemleriGetir(evrak, tr).then(r => {
      if (iptal) return;
      setSonuc(r.ok ? { anahtar, kalemler: r.kalemler, hata: null } : { anahtar, kalemler: null, hata: r.hata });
    });
    return () => { iptal = true; };
    // `evrak` anahtardan türer; anahtar değişmeden yeniden çekilmez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anahtar, tr]);

  if (!anahtar) return { durum: 'gerekmez', kalemler: [], hata: null };
  if (!sonuc || sonuc.anahtar !== anahtar) return { durum: 'yukleniyor', kalemler: [], hata: null };
  if (sonuc.hata !== null) return { durum: 'hata', kalemler: [], hata: sonuc.hata };
  return { durum: 'hazir', kalemler: sonuc.kalemler ?? [], hata: null };
}

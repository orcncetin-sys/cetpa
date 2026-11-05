/**
 * BakiyeDamgasi.tsx: «son bakiye çekimi: {tarih}» satırı (şartname «Mikro bağlantı A» A3.4 / A4.6, 2026-11-05). Metin ve 48 saat
 * eşiği `utils/muhasebe/bakiyeDamgasi`'nde (tek kaynak); bu bileşen yalnız çizer: bayatsa sarı, değilse gri. Zaman yoksa hiçbir şey.
 * Kullananlar: RiskPanel (Toplam Riskli Bakiye kartı), MuhasebePage (Finansal Oranlar, Bilanço alacak / borç satırı).
 * Siparişler «Alacak Toplam» kartı metni dizgeye gömdüğü için saf işlevi doğrudan çağırır.
 */
import { bakiyeDamgasi } from '../../utils/muhasebe/bakiyeDamgasi';

export default function BakiyeDamgasi({ sonMs, dil, className = '' }: { sonMs: number | null; dil: 'tr' | 'en'; className?: string }) {
  const d = bakiyeDamgasi(sonMs, Date.now(), dil);
  if (!d) return null;
  return (
    <p data-bakiye-damgasi={d.bayat ? 'bayat' : 'taze'} className={`text-[10px] ${d.bayat ? 'text-amber-600 font-semibold' : 'text-gray-400'} ${className}`}>
      {d.metin}
    </p>
  );
}

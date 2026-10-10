/**
 * UlkeSecici.tsx — teslimat ÜLKESİ seçicisi. Ortak bileşen: Yeni Sipariş ve Sipariş Düzenle pencereleri AYNI bileşeni
 * kullanır (2026-10-10; kullanıcı isteği 2026-10-09: «şehir ve ülke seçtir droplist (otomatik liste yap)»).
 *
 * LİSTE: kodlar `/geo/cities/_index.json` isteğinden (`useCountryList`), adlar `Intl.DisplayNames`'ten gelir. İstek
 * gecikir / başarısız olursa (çevrim dışı) kanca `[]` döner — bu yüzden:
 *   • 'Türkiye' satırı kancadan BAĞIMSIZ, sabit İLK satırdır (ada göre sıralı listede 220. sırada olurdu; indeks gelmese
 *     de seçili ve görünür — sipariş kaydedilebilir).
 *   • Seçili kod TR değilse ve listede (henüz) yoksa o kod için de tek satır eklenir. Denetimli `<select>` listede
 *     olmayan değeri gösteremez: kayıt 'DE' iken ekranda 'Türkiye' görünürdü.
 *
 * `deger` kayıttaki HAM değerdir (pencere `etkinUlke` UYGULAMADAN verir). Düzenlenebilir kipte gösterilen değer
 * `etkinUlke(deger)`: seçici HİÇ boş olmaz, alanı olmayan eski kayıt 'Türkiye' görünür (görünüm — adrese dokunulmadıkça
 * kayda yazılmaz; karşılaştırma `formKayit.siparisDuzenlemeYamasi`'nda). `saltOkunur` kipte (mağaza kilidi) seçici DEĞİL salt okunur
 * metin kutusu çizilir ve 'Türkiye' VARSAYILMAZ: kod yoksa «—» (mağaza kaydında ülke bilinmiyordur).
 *
 * Etiket pencere tarafındadır: `<label htmlFor={id}>`.
 */
import { useCountryList } from '../../hooks/useWorldGeo';
import { etkinUlke, ulkeAdi, ulkeKoduMu } from '../../utils/siparisler/teslimatAdresi';

export interface UlkeSeciciProps {
  id: string;
  /** Kayıttaki HAM ülke kodu (ISO2) — yoksa `undefined`. */
  deger: string | undefined;
  onDegis: (kod: string) => void;
  saltOkunur?: boolean;
  dil: 'tr' | 'en';
  className?: string;
}

const VARSAYILAN_SINIF = 'apple-input w-full text-sm';

/** Seçici satırının adı. Ad çözülemezse kodun kendisi — YALNIZ seçicide (adres metnine ham kod basılmaz). */
const satirAdi = (kod: string, dil: 'tr' | 'en'): string => ulkeAdi(kod, dil) ?? kod;

function UlkeListesi({ id, deger, onDegis, dil, className }: Omit<UlkeSeciciProps, 'saltOkunur'>) {
  const liste = useCountryList(dil);
  const secili = etkinUlke(deger);
  const digerleri = liste.filter(u => u.code !== 'TR');
  const seciliListede = secili === 'TR' || digerleri.some(u => u.code === secili);
  return (
    <select id={id} value={secili} onChange={e => onDegis(e.target.value)} className={className}>
      <option value="TR">{ulkeAdi('TR', dil) ?? 'Türkiye'}</option>
      {!seciliListede && <option value={secili}>{satirAdi(secili, dil)}</option>}
      {digerleri.map(u => <option key={u.code} value={u.code}>{u.name}</option>)}
    </select>
  );
}

export default function UlkeSecici({ id, deger, onDegis, saltOkunur = false, dil, className = VARSAYILAN_SINIF }: UlkeSeciciProps) {
  if (saltOkunur) {
    // Kanca çağrılmaz: kilitli kayıtta ülke listesi istenmez. Kod yok / geçersizse «—» — `etkinUlke` burada UYGULANMAZ
    // (o, bilinmeyeni 'TR' sayar; mağaza kaydında ülke bilinmiyordur).
    return <input id={id} type="text" readOnly value={ulkeKoduMu(deger) ? satirAdi(deger, dil) : '—'} className={className} />;
  }
  return <UlkeListesi id={id} deger={deger} onDegis={onDegis} dil={dil} className={className} />;
}

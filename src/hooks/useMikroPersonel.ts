import { useState, useEffect } from 'react';
import { authFetch } from '../services/authFetch';
import { useAppStore } from '../store/appStore';
import { ucKapisindanGecer } from '../lib/mikroUcKapilari';

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

/**
 * Çekimin sonucu — çağıran (İK ekranındaki «Mikro'dan Senkronize Et» düğmesi) hatayı GÖRÜR.
 *  - `yazilan`: sunucunun `employees` koleksiyonuna yazdığı personel sayısı; yanıt taşımıyorsa `null` (BİLİNMİYOR, sıfır değil).
 *  - `data`: uç bugün satır DÖNDÜRMEZ (yalnız koleksiyona yazar) → boş dizi; alan, uç satır döndürürse dolsun diye duruyor.
 *  - `neden: 'yetki'`: rol ucun kapısından geçemiyor — istek ATILMADI.
 *  - `neden: 'yapilandirilmamis'`: Mikro bağlantısı kurulmamış (arıza değil, kurulum durumu).
 */
export type MikroPersonelCekimi =
  | { ok: true; data: MikroPersonel[]; yazilan: number | null; not: string | null }
  | { ok: false; neden: 'yetki' | 'yapilandirilmamis' | 'hata'; hata: string };

interface PersonelYaniti {
  success?: boolean;
  data?: unknown;
  written?: unknown;
  note?: unknown;
  error?: unknown;
  notConfigured?: boolean;
}

const YETKI_YOK: MikroPersonelCekimi = { ok: false, neden: 'yetki', hata: 'Bu rol Mikro personel çekimini başlatamaz.' };

/** Tek istek, tek karar: HTTP durumu ile gövde birlikte okunur; hiçbir dal hatayı yutmaz. */
async function personelCek(): Promise<MikroPersonelCekimi> {
  try {
    const res = await authFetch('/api/mikro/pull/personel', { method: 'POST' });
    // Gövde JSON olmayabilir (IIS / ARR 502 HTML sayfası) — o zaman durum kodu konuşur.
    const json = await res.json().catch(() => null) as PersonelYaniti | null;
    if (json?.notConfigured) return { ok: false, neden: 'yapilandirilmamis', hata: 'Mikro yapılandırılmamış.' };
    if (!res.ok || json?.success !== true) {
      return { ok: false, neden: 'hata', hata: typeof json?.error === 'string' && json.error ? json.error : `HTTP ${res.status}` };
    }
    return {
      ok: true,
      data: Array.isArray(json.data) ? json.data as MikroPersonel[] : [],
      yazilan: typeof json.written === 'number' && Number.isFinite(json.written) ? json.written : null,
      not: typeof json.note === 'string' && json.note ? json.note : null,
    };
  } catch (e) {
    return { ok: false, neden: 'hata', hata: e instanceof Error && e.message ? e.message : 'Sunucuya ulaşılamadı.' };
  }
}

/**
 * Mikro personel çekimi (`POST /api/mikro/pull/personel` — uç `employees` koleksiyonuna YAZAR).
 *
 * ROL KAPISI (karar turu 2026-10-11 — K4 / H5, İ3, İ4): ucun sunucudaki kapısı `employees` yazma kuralıdır. Kanca kendi
 * kapısını ortak tablodan (`lib/mikroUcKapilari.ts`) sorar; rol geçemiyorsa açılış çağrısı da `refetch` de İSTEK ATMAZ.
 * Eskiden İK ekranını açan her rol bu ucu çağırıyor, 403 `console.error` ile yutuluyor, düğme boş liste üzerinde dönüp
 * yeşil «0 güncellendi, 0 eklendi» basıyordu (sessiz 403 + sahte başarı). Çağıran `yetkili`'ye bakar, düğmeyi çizmez.
 *
 * Hata YUTULMAZ: `refetch` sonucu döndürür; son arıza `hata`'da durur (açılış çağrısınınki de). Eski sürüm BAŞARILI
 * yanıtı da hata sayıyordu (uç `data` döndürmez; `Array.isArray(json.data)` hep yanlıştı) — başarı ölçütü artık `success`.
 *
 * Açılıştaki gizli import (şartname § 6 A2) ayrı iş: bu tur yalnız kapı. Rol depodan gelir (`appStore`); kodda rol adı
 * da koleksiyon adı da geçmez — kapı, ucun ortak tablodaki anahtarıyla sorulur.
 */
export function useMikroPersonel() {
  const yetkili = ucKapisindanGecer(useAppStore(s => s.userRole), 'POST /api/mikro/pull/personel');
  const [data, setData] = useState<MikroPersonel[]>([]);
  /** Son çekimin ARIZASI. «Mikro yapılandırılmamış» burada durmaz (kurulum durumu); onu `refetch` sonucu söyler. */
  const [hata, setHata] = useState<string | null>(null);
  /** Düğmeden (`refetch`) başlatılan çekim sürüyor. */
  const [istekte, setIstekte] = useState(false);
  /** Açılış çağrısı sonuçlandı — kapıdan geçen rolde çağrı ekranla birlikte başlar, o ana dek «yükleniyor». */
  const [acilisBitti, setAcilisBitti] = useState(false);

  const fetchPersonel = async (): Promise<MikroPersonelCekimi> => {
    if (!yetkili) return YETKI_YOK;
    setIstekte(true);
    const sonuc = await personelCek();
    sonucuIsle(sonuc, setData, setHata);
    setIstekte(false);
    return sonuc;
  };

  // Açılış çağrısı; rol sonradan gelirse (deponun varsayılan rolü kapıdan geçmez) kapıdan geçtiği an yapılır.
  // Rol kapıdan geçemez hâle gelirse ya da ekran kapanırsa yoldaki yanıt işlenmez.
  useEffect(() => {
    if (!yetkili) return;
    let aktif = true;
    void personelCek().then(sonuc => {
      if (!aktif) return;
      sonucuIsle(sonuc, setData, setHata);
      setAcilisBitti(true);
    });
    return () => { aktif = false; };
  }, [yetkili]);

  return { data, loading: yetkili && (istekte || !acilisBitti), hata, yetkili, refetch: fetchPersonel };
}

/** Çekim sonucunu kanca durumuna yazar: başarıda satırlar, arızada hata metni (başarı ve «yapılandırılmamış» hatayı siler). */
function sonucuIsle(
  sonuc: MikroPersonelCekimi,
  setData: (d: MikroPersonel[]) => void,
  setHata: (h: string | null) => void,
): void {
  if (sonuc.ok) setData(sonuc.data);
  setHata(!sonuc.ok && sonuc.neden === 'hata' ? sonuc.hata : null);
}

/**
 * ArkaPlanIsiKarti.tsx — Mikro arka plan import kartı: düğme + `jobs/<isAdi>` ilerlemesi + sayaçlar + hata
 * (mikro-import-arkaplan istemci şartnamesi §B2, 2026-09-24).
 *
 * `MikroSyncPanel`'deki "Stok Miktarlarını Çek" kartının (tek arka plan işi) GENELLEŞTİRİLMİŞ hâli: artık
 * stok, cari, stok-miktar ve 12 SQL ucu (15 kart) aynı bileşen. `useArkaPlanIsi` YALNIZ burada çağrılır;
 * panel `'jobs'` okumaz. Başlatma yanıtı `baslatmaYanitiniYorumla` ile okunur — kart kendi tablosunu yazmaz.
 *
 * İKİ AYRI OLAY (2026-08-28 dersi, eski panel yorumu AYNEN): "başlatılamadı" (BU deneme, `baslatmaHatasi`,
 * role=alert) ile "son koşu hatası" (ÖNCEKİ koşunun `is.error`'ı, amber) karıştırılmaz; eskiden ikisi tek
 * state'e merge edilip kırmızı "başlatılamadı" ile yeşil "2375/2375 tamamlandı" aynı anda görünüyordu.
 * Üçüncü hâl `bilgi` (role=status, gri): "zaten çalışıyor" / "başka bir iş çalışıyor" — hata DEĞİL (K-C).
 *
 * SAHTE KESİNLİK YASAĞI: sayaçlar yalnız `typeof === 'number' && Number.isFinite` iken basılır
 * (`sayiMetni`/`sonluSayi`, tek tanım); `?? 0` / `?? '?'` YOK. `total` bilinmiyorsa belirsiz çubuk.
 * `0` değerli özet sayaçları basılmaz (0 = sorun yok, "bilgi yok" değil).
 * BİLİNMEYEN ≠ UYGULANMAYAN (delta hakem 2026-09-25, bulgu 12): '—' yalnız "bu iş bu alanı yazar ama henüz
 * bilinmiyor" demektir. Stok/cari `total` yazmaz → bitmiş işte '/—' basılmaz (koşarken basılır: bilinmiyor);
 * `sayfa` ve `satir` AYRI AYRI, yalnız sonlu iken basılır (cari `satir` yazmaz — '— satır' yalan olurdu).
 * BAŞLANGIÇTAN GEÇEN SÜRE (bulgu 11): koşarken `startedAt` okunabiliyorsa 'N dk önce başladı' — asılı/yetim
 * iş uzun süren işten ayırt edilsin (eskiden yalnız düğme tooltip'indeydi, dokunmatikte görünmüyordu).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw, Download } from 'lucide-react';
import { useArkaPlanIsi, baslatmaYanitiniYorumla, type ArkaPlanIsi } from '../../hooks/useArkaPlanIsi';
import type { MikroIsBaslatmaYaniti } from '../../services/mikroService';
import { sayiMetni, sonluSayi } from '../../utils/sayiMetni';
import { zamanMs } from '../../utils/zaman';

/** Koşan işte "N dk önce başladı" tazeleme aralığı — dakika çözünürlüğü için 30 sn yeter. */
const SURE_TAZELEME_MS = 30_000;

export interface ArkaPlanIsiKartiProps {
  /** = mikroIsAdi(route) — `jobs/<isAdi>` doküman id'si (tek sözlük; literal YAZILMAZ). */
  isAdi: string;
  baslik: string;
  aciklama: string;
  dugmeMetni: string;
  baslat: () => Promise<MikroIsBaslatmaYaniti>;
  disabled: boolean;
  /** disabled iken düğme altı notu; verilmezse 'Mikro bağlantısı gerekli'. */
  disabledNotu?: string;
  lang: string;
  gorunum?: { icon?: ReactNode; iconBg?: string; buttonColor?: string };
  /** İş-özel özet (stok: fiyat rehberi; miktar: depo dağılımı) — dokümanı alır, karta gömülmez. */
  ekOzet?: (is: ArkaPlanIsi) => ReactNode;
}

/** Sonlu ve > 0 ise değer, değilse null — "0 basılmaz" kuralı için. */
const pozitif = (v: unknown): number | null => {
  const n = sonluSayi(v);
  return n !== null && n > 0 ? n : null;
};

export default function ArkaPlanIsiKarti({
  isAdi, baslik, aciklama, dugmeMetni, baslat, disabled, disabledNotu, lang, gorunum, ekOzet,
}: ArkaPlanIsiKartiProps) {
  const t = lang === 'tr';
  const { is, okumaHatasi } = useArkaPlanIsi(isAdi);
  const [baslatiyor, setBaslatiyor] = useState(false);
  /** BU denemenin başlatma hatası — `is.error` (ÖNCEKİ koşu) ile karıştırılmaz (dosya başlığı). */
  const [baslatmaHatasi, setBaslatmaHatasi] = useState<string | null>(null);
  /** Hata olmayan başlatma notu ("zaten çalışıyor" / "başka bir iş çalışıyor") + TIKLAMA ANINDAKİ bitiş damgası +
   *  'başka iş' ise O işin adı (notun gizlenmesi için o işin kaydı da izlenir). */
  const [bilgi, setBilgi] = useState<{ metin: string; bitisMs: number | null; baskaIs: string | null; tiklamaMs: number } | null>(null);
  /** Bu notun aboneliğinde X'in `running:true` görüntüsü GÖRÜLDÜ mü (kalıcı silme yalnız gerçek bir bitiş geçişinde). */
  const baskaIsKosuGoruldu = useRef(false);
  const bitisMs = zamanMs(is?.finishedAt);
  // Delta hakem 2026-09-25 (ikinci tur): 'Başka bir iş çalışıyor: X' notu X bittikten sonra da kalıyordu — kart
  // yalnız KENDİ işine bakıyordu. Not açıkken X'in kaydı izlenir; X durunca not gizlenir.
  const { is: baskaIsKaydi } = useArkaPlanIsi(bilgi?.baskaIs ?? null);

  async function handleBaslat() {
    // Tıklama anının bitiş damgası: not, iş BUNDAN SONRA yeni bir damgayla biterse gizlenir (aşağıda `bilgiGorunur`).
    const tiklamaBitisMs = bitisMs;
    const tiklamaMs = Date.now();
    setBaslatiyor(true);
    // Yeni deneme, eski denemenin hatasını ve notunu SİLER. Aksi hâlde bir kez başarısız olan çağrının
    // mesajı ekranda süresiz kalıyordu.
    setBaslatmaHatasi(null);
    setBilgi(null);
    try {
      const y = await baslat();
      const yorum = baslatmaYanitiniYorumla(y, isAdi, t);
      if (yorum.tur === 'hata') setBaslatmaHatasi(yorum.metin);
      else if (yorum.metin) {   // bilgi (başka iş) ya da bekle+metin (zaten çalışıyor)
        baskaIsKosuGoruldu.current = false;
        setBilgi({ metin: yorum.metin, bitisMs: tiklamaBitisMs, baskaIs: yorum.tur === 'bilgi' ? (y.job ?? null) : null, tiklamaMs });
      }
      // bekle + metin yok: ilerleme kancadan gelir, kart bir şey basmaz
    } catch (e) {
      setBaslatmaHatasi(e instanceof Error ? e.message : String(e));
    } finally {
      setBaslatiyor(false);
    }
  }

  const calisiyor = is?.running === true;
  // İnceleme bulgusu 2026-09-25: "Zaten çalışıyor — ilerleme aşağıda." notu iş BİTTİKTEN sonra da kalıyor, yeşil
  // 'tamamlandı' satırının üstünde çelişkili duruyordu. TÜRETİLMİŞ koşul (olay değil — delta hakem: yanıt bitiş
  // olayından SONRA gelirse effect bir daha tetiklenmezdi): tıklamadan sonra YENİ bir bitiş damgası geldiyse gizli.
  const kendiIsiBitti = bilgi !== null && bitisMs !== null && bitisMs !== bilgi.bitisMs;
  const baskaIsDurgun = bilgi !== null && bilgi.baskaIs !== null && baskaIsKaydi?.running === false;
  const bilgiGorunur = bilgi !== null && !kendiIsiBitti && !baskaIsDurgun;
  // KALICI silme (delta hakem 2026-09-25, 3. ve 4. tur). Türetilmiş koşul tek başına yetmiyordu: iş YENİDEN başlayınca
  // eski tıklamanın notu geri geliyordu. Ama X için her `running:false` görüntüsüne güvenilmez: sunucu kilidi X'in
  // kaydını yazmadan ÖNCE alır, yeni abonelik X'in ÖNCEKİ koşusunun bayat 'bitti' görüntüsünü alabilir — bunda kalıcı
  // silme notu yok ederdi (not yalnız türetilmiş olarak gizlenir, `running:true` gelince geri döner). X notu yalnız
  // (a) bu abonelikte `running:true` görülüp sonra durunca ya da (b) X'in bitiş damgası tıklamadan SONRAYSA silinir.
  // BİLİNEN SINIR (hakem, PLAUSIBLE): (b) sunucu damgasını İSTEMCİ saatiyle karşılaştırır; saat farkı + X'in tıklamadan
  // hemen sonra (tek gidiş-dönüş içinde) bitmesi birlikte gerekirse not ya geç silinir ya erken. Etki yalnız bu bilgi
  // notu; saatten bağımsız çözüm sunucunun `alreadyRunning` yanıtına koşan işin başlangıç anını eklemesi olurdu.
  useEffect(() => {
    if (bilgi === null) return;
    if (kendiIsiBitti) { setBilgi(null); return; }
    if (bilgi.baskaIs === null || !baskaIsKaydi) return;
    if (baskaIsKaydi.running === true) { baskaIsKosuGoruldu.current = true; return; }
    if (baskaIsKaydi.running === false) {
      const xBitisMs = zamanMs(baskaIsKaydi.finishedAt);
      if (baskaIsKosuGoruldu.current || (xBitisMs !== null && xBitisMs >= bilgi.tiklamaMs)) setBilgi(null);
    }
  }, [bilgi, kendiIsiBitti, baskaIsKaydi]);
  /** Koşarken başlangıç anı (ms); okunamıyorsa null → süre BASILMAZ (uydurulmaz). */
  const baslangicMs = calisiyor ? zamanMs(is?.startedAt) : null;
  const [simdiMs, setSimdiMs] = useState(() => Date.now());
  useEffect(() => {
    if (baslangicMs === null) return;
    setSimdiMs(Date.now());
    const zamanlayici = setInterval(() => setSimdiMs(Date.now()), SURE_TAZELEME_MS);
    return () => clearInterval(zamanlayici);
  }, [baslangicMs]);
  const gecenDk = baslangicMs !== null ? Math.max(0, Math.floor((simdiMs - baslangicMs) / 60_000)) : null;
  const processed = sonluSayi(is?.processed);
  const total = sonluSayi(is?.total);
  const yuzde = processed !== null && total !== null && total > 0 ? Math.round((processed / total) * 100) : null;
  const sayfa = sonluSayi(is?.sayfa);
  const satir = sonluSayi(is?.satir);
  const sonSayfaMs = sonluSayi(is?.sonSayfaMs);
  const durationMs = sonluSayi(is?.durationMs);
  const bozukKayit = pozitif(is?.bozukKayit);
  const zamanAsimiKayit = pozitif(is?.zamanAsimiKayit);
  const zamanAsimiSayfa = pozitif(is?.zamanAsimiSayfa);
  /** Gri genel özet: sonlu ve > 0 olanlar. */
  const griSayaclar: { etiket: string; deger: number }[] = [
    { etiket: t ? 'oluşturuldu' : 'created', deger: pozitif(is?.created) },
    { etiket: t ? 'güncellendi' : 'updated', deger: pozitif(is?.updated) },
    { etiket: t ? 'hata' : 'errors', deger: pozitif(is?.errors) },
    { etiket: t ? 'GUID\'siz satır' : 'rows without GUID', deger: pozitif(is?.guidsizSatir) },
    { etiket: t ? 'fiyatlı ürün' : 'with price', deger: pozitif(is?.fiyatliUrun) },
  ].flatMap(x => (x.deger === null ? [] : [{ etiket: x.etiket, deger: x.deger }]));
  const sayacSatiriVar = calisiyor || processed !== null || total !== null;
  const cubukVar = calisiyor || yuzde !== null;
  const hataVar = typeof is?.error === 'string' && is.error !== '';
  const note = typeof is?.note === 'string' && is.note !== '' ? is.note : null;

  return (
    <div role="group" aria-label={baslik} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3 flex flex-col">
      <div className="flex items-center gap-3">
        {gorunum?.icon && (
          <div className={`w-9 h-9 ${gorunum.iconBg ?? 'bg-gray-50'} rounded-xl flex items-center justify-center`}>
            {gorunum.icon}
          </div>
        )}
        <h4 className="font-bold text-sm text-gray-900">{baslik}</h4>
      </div>
      <p className="text-[11px] text-gray-400 leading-relaxed flex-1">{aciklama}</p>

      {/* BU denemenin sonucu. `is.error` (ÖNCEKİ koşunun sunucu hatası) ile karıştırılmaz. */}
      {baslatmaHatasi && (
        <p role="alert" className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          {t ? 'İş başlatılamadı: ' : 'Could not start: '}<b>{baslatmaHatasi}</b>
        </p>
      )}
      {bilgiGorunur && (
        <p role="status" className="text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">{bilgi.metin}</p>
      )}
      {okumaHatasi && (
        <p className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          {t ? 'İş durumu okunamadı: ' : 'Could not read job status: '}<b>{okumaHatasi}</b>
        </p>
      )}

      {is && (
        <div className="space-y-1.5">
          {/* Başlatma başarısız olduysa aşağıdaki ilerleme BU denemeye ait DEĞİL — geçmiş bir koşunun
              kaydıdır. Etiketlenmezse kullanıcı "başlatılamadı" ile "2375/2375 tamamlandı"yı aynı olay sanıyor. */}
          {baslatmaHatasi && !calisiyor && (
            <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
              {t
                ? 'Aşağıdaki sonuç ÖNCEKİ bir koşuya aittir; bu deneme başlatılamadı.'
                : 'The result below is from a PREVIOUS run; this attempt did not start.'}
            </p>
          )}
          {cubukVar && (
            <div
              role="progressbar"
              aria-label={t ? `${baslik} ilerleme` : `${baslik} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              {...(yuzde !== null ? { 'aria-valuenow': yuzde } : {})}
              aria-busy={calisiyor && yuzde === null}
              className="w-full h-2 bg-gray-100 rounded-full overflow-hidden"
            >
              {yuzde !== null ? (
                <div
                  className={`h-full transition-all duration-500 ${calisiyor ? 'bg-[#1a3a5c]' : 'bg-emerald-500'}`}
                  style={{ width: `${yuzde}%` }}
                />
              ) : (
                // Belirsiz çubuk: total bilinmiyor (SQL koşarken hep böyle) — sayı UYDURULMAZ.
                <div className="h-full w-1/3 bg-[#1a3a5c]/60 rounded-full animate-pulse" />
              )}
            </div>
          )}
          {sayacSatiriVar && (
            <p className="text-[11px] text-gray-500">
              {/* '/toplam' koşarken bilinmiyor ('—'); bitmiş işte toplam yoksa bu iş yazmıyor → basılmaz. */}
              {sayiMetni(processed)}{(total !== null || calisiyor) && <>/{sayiMetni(total)}</>} {t ? 'işlendi' : 'processed'}
              {sayfa !== null && <span> · {t ? 'sayfa' : 'page'} {sayfa}</span>}
              {satir !== null && <span> · {satir} {t ? 'satır' : 'rows'}</span>}
              {sonSayfaMs !== null && <span> · {t ? 'son sayfa' : 'last page'} {Math.round(sonSayfaMs / 1000)} sn</span>}
              {gecenDk !== null && (
                <span> · {gecenDk < 1
                  ? (t ? 'az önce başladı' : 'started just now')
                  : (t ? `${gecenDk} dk önce başladı` : `started ${gecenDk} min ago`)}</span>
              )}
              {!calisiyor && !hataVar && <span className="text-emerald-600 font-semibold"> · {t ? 'tamamlandı' : 'done'}</span>}
            </p>
          )}
          {(griSayaclar.length > 0 || durationMs !== null || zamanAsimiSayfa !== null) && (
            <p className="text-[11px] text-gray-500 flex flex-wrap gap-x-3">
              {griSayaclar.map(x => <span key={x.etiket}>{x.etiket}: <b>{x.deger}</b></span>)}
              {zamanAsimiSayfa !== null && <span>{zamanAsimiSayfa} {t ? 'sayfa daraltıldı' : 'pages narrowed'}</span>}
              {durationMs !== null && <span>⏱ {Math.round(durationMs / 1000)}s</span>}
            </p>
          )}
          {bozukKayit !== null && (
            <p className="text-[11px] text-amber-800 bg-amber-50 rounded-lg px-2 py-1.5">
              ⚠ {bozukKayit} {t ? 'bozuk kayıt atlandı' : 'broken records skipped'}
            </p>
          )}
          {zamanAsimiKayit !== null && (
            <p className="text-[11px] text-amber-800 bg-amber-50 rounded-lg px-2 py-1.5">
              ⚠ {zamanAsimiKayit} {t ? 'kayıt zaman aşımıyla ATLANDI — import EKSİK, yeniden çalıştırın' : 'records SKIPPED on timeout — import INCOMPLETE, run again'}
            </p>
          )}
          {is.truncated === true && (
            <p className="text-[11px] text-amber-800 bg-amber-50 rounded-lg px-2 py-1.5">
              ⚠ {t ? 'SAYFA TAVANINA ÇARPTI — veri eksik' : 'PAGE CAP HIT — data incomplete'}
            </p>
          )}
          {note && (
            <p className={`text-[11px] ${note.startsWith('UYARI:') ? 'text-amber-800 bg-amber-50 rounded-lg px-2 py-1.5' : 'text-gray-500'}`}>{note}</p>
          )}
          {ekOzet?.(is)}
        </div>
      )}

      {/* ÖNCEKİ koşunun SUNUCU hatası (iş kaydından). "başlatılamadı" kutusundan farklıdır. */}
      {hataVar && !calisiyor && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          {t ? '⚠ Son koşu hatası: ' : '⚠ Last run error: '}{is?.error}
        </p>
      )}

      {/* `calisiyor` düğmeyi KİLİTLEMEZ (hakem bulgusu 2026-09-25): deploy/çökme sonrası doküman running:true
          kalabilir (`calisanlar` Map'i sıfırlanır). Sunucu artık açılışta bu kayıtları kapatıyor
          (arkaPlanIsi.ts `yetimIsleriKapat`, delta bulgu 1/11) ama tarama düşebilir (PG erişilemez) — istemci
          kilidi o durumda kalıcı sızardı. Kilidin otoritesi SUNUCU: gerçekten koşan işte tıklama 'Zaten
          çalışıyor' bilgisi döner, yetim kayıtta iş temiz başlar. Yalnız BU istek sürerken (`baslatiyor`)
          kapalı — çift tıklama iki istek atmasın. */}
      <button
        onClick={handleBaslat}
        disabled={baslatiyor || disabled}
        title={calisiyor
          ? (t
            ? 'Sunucu kilidi karar verir: iş gerçekten koşuyorsa "Zaten çalışıyor" döner; yarıda kalmış kayıtsa (sunucu yeniden başladı) iş yeniden başlar.'
            : 'The server lock decides: if the job is really running you get "Already running"; if the record is stale (server restarted) the job starts again.')
          : undefined}
        className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-white text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${gorunum?.buttonColor ?? 'bg-[#1a3a5c] hover:bg-[#1a3a5c]/90'}`}
      >
        {calisiyor ? (
          <><RefreshCw className="w-4 h-4 animate-spin" />{t ? 'Çalışıyor…' : 'Running…'}</>
        ) : baslatiyor ? '…' : (
          <><Download className="w-4 h-4" />{dugmeMetni}</>
        )}
      </button>

      {disabled && !calisiyor && (
        <p className="text-[10px] text-center text-gray-400">
          {disabledNotu ?? (t ? 'Mikro bağlantısı gerekli' : 'Mikro connection required')}
        </p>
      )}
    </div>
  );
}

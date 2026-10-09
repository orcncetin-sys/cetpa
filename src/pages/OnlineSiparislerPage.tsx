/**
 * OnlineSiparislerPage — "Online Siparişler" üst sekmesi (`online-siparisler`; şartname online-siparis 2026-10-02 §4 + v2).
 *
 * Çevrim içi mağazadan (Shopify webhook) gelen siparişlerin AYRI takip ekranı. Veri yeni bir abonelik DEĞİL: App'in
 * zaten dinlediği `orders` listesi prop olarak gelir, `magazaSiparisiMi` (`source === 'shopify_webhook'`) ile süzülür.
 * Bütün hesaplar saf modülde (utils/siparisler/magazaSiparisi.ts — testli); bu dosya yalnız çizer.
 *
 * SALT OKUNUR: bu ekran hiçbir şey yazmaz. Durum değiştirme, ödeme işaretleme, sevkiyat vb. sipariş DETAYINDA yapılır;
 * satıra tıklanınca `onSiparisAc` çağrılır (App: `setSelectedOrder` + `setActiveTab('orders')` — Global Arama ve
 * Lojistik sevkiyat listesinin kullandığı yolun aynısı; detay OrdersPage'in `selectedOrder` görünümünde yaşar).
 *
 * BAĞLANTI ŞERİDİ: `GET /api/shopify/baglanti`. 403 / 404 (uç henüz yayında değil) → şerit GİZLENİR; ilk okumada ağ
 * hatası / beklenmeyen gövde → şerit hiç çizilmez; sayfa çalışmaya devam eder. Durum sipariş sayısı değişince,
 * dakikada bir (sekme görünürken) ve sekme yeniden görünür olunca tazelenir; tazelemedeki GEÇİCİ hata eldeki durumu
 * silmez, geciken ESKİ yanıt da yenisini ezmez (istek sırası). Yanıtta sır yoktur; çözücü de yalnız bildiği alanları alır.
 * İMZA REDDİ: bildirim geldi ama imzası tutmadıysa şerit uyarır (kural kartla ortak: `guncelImzaReddiMs`). Uyarı yalnız
 * BİLGİDİR — yeşil «Mağaza bağlı» etiketi düşmez (uç kimliksiz; uydurma bir istek sağlıklı bağlantıyı düşürememeli).
 * Şeridi görenlerin çoğu bağlantıyı düzenleyemez: metin sırrı kontrol etmeyi değil yöneticiye haber vermeyi söyler.
 *
 * SAHTE KESİNLİK YOK: TRY dışı / tutarı okunamayan sipariş toplama girmez, kaç tane olduğu toplamın altında yazılır;
 * bilinmeyen tutar, kalem sayısı ve durum '—' basılır.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Search, Settings, ShoppingBag } from 'lucide-react';
import ModuleHeader from '../components/ModuleHeader';
import { authFetch } from '../services/authFetch';
import type { Order } from '../types';
import { oc } from '../i18n/ortak';
import { osc } from '../i18n/onlineSiparis';
import { paraYaz } from '../utils/currency';
import { ekranTutari } from '../utils/para';
import { gorunenSiparisNo, siparisTarih } from '../utils/siparis';
import { bugunAnahtari, tarihSaatYaz, zamanMs } from '../utils/zaman';
import {
  MAGAZA_SUZGECLERI, baglantiYanitiniCoz, guncelImzaReddiMs, kalemSayisi, kargoRozeti, magazaListesi, magazaOzeti, magazaSiparisleri,
  magazaTutarMetni, odemeRozeti, suzgecSayilari,
  type MagazaBaglantisi, type MagazaRozeti, type MagazaSuzgeci, type RozetTonu,
} from '../utils/siparisler/magazaSiparisi';

interface Props {
  /** App'in dinlediği TÜM siparişler; mağaza siparişleri burada süzülür. */
  orders: readonly Order[];
  currentLanguage: 'tr' | 'en';
  /** Sipariş detayını aç (App: `setSelectedOrder(o)` + `setActiveTab('orders')`). */
  onSiparisAc: (siparis: Order) => void;
  /**
   * Ayarlar sekmesine git. Yalnız bağlantıyı DÜZENLEYEBİLEN role verilir (Yönetici / süper-admin; App.tsx) — verilmezse
   * düğme yerine "yönetici kurar" notu çıkar. Ayarlar'ı açabilen ama kartı düzenleyemeyen role (Manager) VERİLMEZ.
   */
  ayarlaraGit?: () => void;
}

/** Bağlantı durumu: `gizli` = bilinmiyor (yükleniyor / yetki yok / uç yok / hata) → şerit çizilmez. */
type BaglantiHali = { hal: 'gizli' } | { hal: 'hazir'; baglanti: MagazaBaglantisi };

/** Bağlantı şeridinin ve "Bugün" kutusunun yoklama aralığı. */
const TAZELEME_MS = 60_000;

const TON_SINIFI: Record<RozetTonu, string> = {
  yesil: 'bg-emerald-50 text-emerald-700',
  sari: 'bg-amber-50 text-amber-700',
  mavi: 'bg-blue-50 text-blue-700',
  kirmizi: 'bg-red-50 text-red-700',
  gri: 'bg-gray-100 text-gray-600',
};

function Rozet({ rozet, ipucu }: { rozet: MagazaRozeti; ipucu?: string }) {
  if (rozet.metin === '—') return <span className="text-gray-400">—</span>;
  return (
    <span title={ipucu} className={`inline-block whitespace-nowrap text-[11px] font-bold px-2 py-0.5 rounded-full ${TON_SINIFI[rozet.ton]}`}>
      {rozet.metin}
    </span>
  );
}

function OzetKutusu({ baslik, deger, alt, children }: { baslik: string; deger: string; alt: string; children?: React.ReactNode }) {
  return (
    <div role="group" aria-label={baslik} className="apple-card p-4">
      <p className="text-[11px] font-bold text-gray-500">{baslik}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{deger}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{alt}</p>
      {children}
    </div>
  );
}

export default function OnlineSiparislerPage({ orders, currentLanguage, onSiparisAc, ayarlaraGit }: Props) {
  const t = osc(currentLanguage);
  const o = oc(currentLanguage);
  const [suzgec, setSuzgec] = useState<MagazaSuzgeci>('tumu');
  const [arama, setArama] = useState('');
  const [baglanti, setBaglanti] = useState<BaglantiHali>({ hal: 'gizli' });

  // "Bugün" kutusunun günü DURUMDUR: gece yarısını bu ekranda geçiren sekmede `orders` değişmeden gün döner ve
  // yalnız `[magaza]`ya bağlı özet DÜNÜN sayısını göstermeye devam ederdi. Dakikada bir + sekme görünür olunca
  // yoklanır (arka plandaki sekmede zamanlayıcı kısılır); anahtar aynı kaldıkça `setGun` yeniden çizim üretmez.
  const [gun, setGun] = useState(() => bugunAnahtari());
  useEffect(() => {
    const yokla = () => setGun(bugunAnahtari());
    const zamanlayici = window.setInterval(yokla, TAZELEME_MS);
    document.addEventListener('visibilitychange', yokla);
    return () => {
      window.clearInterval(zamanlayici);
      document.removeEventListener('visibilitychange', yokla);
    };
  }, []);

  const magaza = useMemo(() => magazaSiparisleri(orders), [orders]);
  // `gun` gövdede okunmaz ama bağımlılıktır: `magazaOzeti` "şimdi"yi kendi okur, gün dönünce yeniden hesaplanmalı.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ozet = useMemo(() => magazaOzeti(magaza), [magaza, gun]);
  const sayilar = useMemo(() => suzgecSayilari(magaza), [magaza]);
  const liste = useMemo(() => magazaListesi(magaza, suzgec, arama), [magaza, suzgec, arama]);

  // Bağlantı durumu — ÜÇ tetik: (1) açılış + sipariş sayısı değişimi, (2) dakikada bir, yalnız sekme GÖRÜNÜRKEN,
  // (3) sekme yeniden görünür olunca hemen. Yalnız (1) yetmez: bildirim işlenirken hata olursa sipariş YAZILMAZ, sayı
  // değişmez — şeridin en gerekli olduğu an (bildirim geliyor, sipariş düşmüyor) o tetiği hiç çalıştırmaz; mevcut
  // siparişe gelen olaylar (ödendi / kargolandı) da sayıyı değiştirmediği için "son bildirim" bayat kalırdı.
  // GİZLEME yalnız 403 / 404'te (yetki yok / uç yok). Başka hata (ağ, 5xx, beklenmeyen gövde) ELDEKİ durumu korur:
  // ilk okumada elde bir şey yoktur, şerit zaten çizilmez; sonraki turlarda geçici bir hata görünen şeridi silmez.
  // İSTEK SIRASI: aynı kurulumda tetikler üst üste binebilir (dakikalık tur yanıt beklerken sekme görünür olur). Yanıtlar
  // atıldıkları sırayla dönmek zorunda değil; ekrana yazılmış olandan ESKİ isteğin geciken yanıtı atılır — yoksa yeni durumu
  // (ör. az önce görünen «son hata») bir sonraki tura kadar eskisiyle ezerdi. Ölçüt «en son atılan» değil «yazılandan eski»:
  // en son istek ağ hatasıyla düşerse ondan önce atılmış geçerli yanıt yine yazılır (hata eldeki durumu korur).
  useEffect(() => {
    let iptal = false;
    let sonTur = 0;         // atılan isteklerin sırası
    let yazilanTur = 0;     // ekrana yazılmış en yeni isteğin sırası
    const cek = () => {
      const tur = ++sonTur;
      authFetch('/api/shopify/baglanti')
        .then(async yanit => {
          if (yanit.status === 403 || yanit.status === 404) return 'gizle' as const;
          return yanit.ok ? baglantiYanitiniCoz(await yanit.json()) : null;
        })
        .then(b => {
          if (iptal || tur < yazilanTur || !b) return;
          yazilanTur = tur;
          setBaglanti(b === 'gizle' ? { hal: 'gizli' } : { hal: 'hazir', baglanti: b });
        })
        .catch(() => { /* geçici hata: eldeki durum korunur */ });
    };
    const gorunurse = () => { if (document.visibilityState === 'visible') cek(); };
    cek();
    const zamanlayici = window.setInterval(gorunurse, TAZELEME_MS);
    document.addEventListener('visibilitychange', gorunurse);
    return () => {
      iptal = true;
      window.clearInterval(zamanlayici);
      document.removeEventListener('visibilitychange', gorunurse);
    };
  }, [magaza.length]);

  const bagli = baglanti.hal === 'hazir' ? baglanti.baglanti : null;
  const imzaReddiMs = bagli?.durum ? guncelImzaReddiMs(zamanMs(bagli.durum.sonImzaReddi), zamanMs(bagli.durum.sonBildirim)) : null;
  const suzgecEtiketi: Record<MagazaSuzgeci, string> = {
    'tumu': o.tumu,
    'odeme-bekliyor': t.odeme_bekliyor,
    'hazirlanacak': t.hazirlanacak,
    'kargoda': o.kargoda,
    'teslim-edildi': o.teslim_edildi,
    'iptal': t.iptal_edilen,
  };

  const toplamaGirmeyen = ozet.tutar.bilinmeyen;
  const girmeyenKirilimi = [
    ozet.tryDisi > 0 ? `${ozet.tryDisi} ${t.try_disi}` : '',
    ozet.tutarsiz > 0 ? `${ozet.tutarsiz} ${t.tutari_bilinmiyor}` : '',
  ].filter(Boolean).join(', ');

  return (
    <motion.div key="online-siparisler" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
      <ModuleHeader title={t.online_siparisler} subtitle={t.alt_baslik} icon={ShoppingBag} />

      {/* ── Bağlantı durumu şeridi — yalnız durum BİLİNİYORSA; "kurulmamış + hiç sipariş yok" hâlinde yönlendirme
             aşağıdaki boş durumda verilir (aynı uyarı iki kez basılmaz). ── */}
      {bagli && (bagli.configured || magaza.length > 0) && (
        <div role="status" aria-label={t.magaza_baglantisi} className="apple-card px-4 py-3 text-sm">
          {bagli.configured ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="flex items-center gap-1.5 font-bold text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                {t.magaza_bagli}{bagli.shopDomain ? ` · ${bagli.shopDomain}` : ''}
              </span>
              <span className="text-gray-600">
                {/* Ret güncelken «henüz bildirim gelmedi» DENMEZ: bildirim geliyor ve reddediliyor (uyarı satırı aşağıda). */}
                {t.son_bildirim}: {bagli.durum?.sonBildirim
                  ? tarihSaatYaz(bagli.durum.sonBildirim, undefined, currentLanguage)
                  : imzaReddiMs !== null ? '—' : t.henuz_bildirim_gelmedi}
              </span>
              {bagli.durum?.sonSiparisNo && <span className="text-gray-600">{t.son_siparis}: {bagli.durum.sonSiparisNo}</span>}
              {bagli.durum && bagli.durum.toplamBildirim !== null && (
                <span className="text-gray-600">{t.toplam_bildirim}: {bagli.durum.toplamBildirim}</span>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-center gap-1.5 font-bold text-amber-700">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                {t.magaza_baglantisi_kurulmamis}
              </span>
              {ayarlaraGit
                ? <button type="button" onClick={ayarlaraGit} className="apple-button-secondary"><Settings className="w-4 h-4" aria-hidden="true" />{t.baglantiyi_kur}</button>
                : <span className="text-gray-600">{t.kurulum_yonetici}</span>}
            </div>
          )}
          {bagli.configured && !bagli.webhookSirriKayitli && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />{t.imza_sirri_kayitli_degil}
            </p>
          )}
          {bagli.configured && imzaReddiMs !== null && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              {t.imza_dogrulanamadi.replace('{zaman}', tarihSaatYaz(imzaReddiMs, undefined, currentLanguage))}
            </p>
          )}
          {bagli.configured && bagli.durum?.sonHata && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {t.son_hata}{bagli.durum.sonHataZamani ? ` (${tarihSaatYaz(bagli.durum.sonHataZamani, undefined, currentLanguage)})` : ''}: {bagli.durum.sonHata}
              </span>
            </p>
          )}
        </div>
      )}

      {magaza.length === 0 ? (
        /* ── Boş durum: hiç mağaza siparişi yok ── */
        <div className="apple-card p-10 text-center">
          <ShoppingBag className="w-10 h-10 mx-auto text-gray-300" aria-hidden="true" />
          {bagli && !bagli.configured ? (
            <>
              <h3 className="mt-3 font-bold" style={{ color: 'var(--text-primary)' }}>{t.magaza_baglantisi_kurulmamis}</h3>
              <p className="mt-1 text-sm text-gray-500 max-w-md mx-auto">{ayarlaraGit ? t.kurulum_aciklamasi : t.kurulum_yonetici}</p>
              {ayarlaraGit && (
                <button type="button" onClick={ayarlaraGit} className="apple-button-primary inline-flex mt-4">
                  <Settings className="w-4 h-4" aria-hidden="true" />{t.baglantiyi_kur}
                </button>
              )}
            </>
          ) : (
            <>
              <h3 className="mt-3 font-bold" style={{ color: 'var(--text-primary)' }}>{t.henuz_online_siparis_yok}</h3>
              {/* Bağlantı durumu bilinmiyorsa (şerit gizli) "mağaza bağlı" DENMEZ — yansız cümle. */}
              <p className="mt-1 text-sm text-gray-500">{bagli ? t.ilk_siparis_burada_gorunur : t.magazadan_siparis_gelince}</p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* ── Özet kutuları ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            <OzetKutusu baslik={o.bugun} deger={String(ozet.bugun)} alt={t.bugun_gelen_siparis} />
            <OzetKutusu baslik={t.odeme_bekleyen} deger={String(ozet.odemeBekleyen)} alt={t.parasi_henuz_alinmadi} />
            <OzetKutusu
              baslik={t.hazirlanacak}
              deger={String(ozet.hazirlanacak)}
              alt={ozet.hazirlanacakOdemeBekleyen > 0 ? `${t.kargoya_verilmedi} · ${t.odeme_bekleyen}: ${ozet.hazirlanacakOdemeBekleyen}` : t.kargoya_verilmedi}
            />
            <OzetKutusu baslik={o.kargoda} deger={String(ozet.kargoda)} alt={t.kargoya_verildi} />
            <OzetKutusu baslik={o.toplam_tutar} deger={paraYaz(ekranTutari(ozet.tutar))} alt={t.iptal_haric_tl}>
              {toplamaGirmeyen > 0 && (
                <p role="note" className="mt-1 text-[11px] font-bold text-amber-700">
                  {t.siparis_toplama_girmedi.replace('{n}', String(toplamaGirmeyen))}{girmeyenKirilimi ? ` (${girmeyenKirilimi})` : ''}
                </p>
              )}
            </OzetKutusu>
          </div>

          {/* ── Durum çipleri + arama ── */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div role="group" aria-label={t.durum_suzgeci} className="flex flex-wrap gap-2">
              {MAGAZA_SUZGECLERI.map(k => (
                <button
                  key={k} type="button" aria-pressed={suzgec === k} onClick={() => setSuzgec(k)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${suzgec === k ? 'bg-brand text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                >
                  {suzgecEtiketi[k]} <span className={suzgec === k ? 'opacity-80' : 'text-gray-400'}>{sayilar[k]}</span>
                </button>
              ))}
            </div>
            <div className="relative lg:ml-auto lg:w-80">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
              <input
                type="search" value={arama} onChange={e => setArama(e.target.value)}
                aria-label={t.siparis_ara} placeholder={t.arama_yer_tutucu}
                className="apple-input w-full pl-10"
              />
            </div>
          </div>

          {/* ── Tablo (dar ekranda yatay kayar) ── */}
          {liste.length === 0 ? (
            <div className="apple-card p-8 text-center">
              <p className="text-sm text-gray-500">{t.suzgece_uyan_siparis_yok}</p>
              <button type="button" onClick={() => { setSuzgec('tumu'); setArama(''); }} className="apple-button-secondary inline-flex mt-3">{t.suzgeci_temizle}</button>
            </div>
          ) : (
            <div className="apple-card">
              <div className="overflow-x-auto">
                <table className="apple-table min-w-[820px]">
                  <thead>
                    <tr>
                      <th>{o.siparis_no}</th>
                      <th>{o.tarih}</th>
                      <th>{o.musteri}</th>
                      <th>{o.odeme}</th>
                      <th>{t.kargo}</th>
                      <th className="text-right">{t.kalem_baslik}</th>
                      <th className="text-right">{o.tutar}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liste.map(siparis => {
                      const no = gorunenSiparisNo(siparis);
                      const odeme = odemeRozeti(siparis, currentLanguage);
                      const kargo = kargoRozeti(siparis, currentLanguage);
                      const kalem = kalemSayisi(siparis);
                      const tutar = magazaTutarMetni(siparis);
                      return (
                        <tr key={siparis.id} onClick={() => onSiparisAc(siparis)} className="cursor-pointer">
                          <td className="whitespace-nowrap">
                            {/* Klavye / ekran okuyucu yolu: satırın tıklanması fareye özgü; düğme aynı işi yapar. */}
                            <button
                              type="button" title={t.siparis_detayini_ac}
                              onClick={e => { e.stopPropagation(); onSiparisAc(siparis); }}
                              className="font-bold text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
                            >
                              {no}
                            </button>
                          </td>
                          <td className="whitespace-nowrap text-gray-600">{tarihSaatYaz(siparisTarih(siparis), undefined, currentLanguage)}</td>
                          <td>
                            <div className="font-medium">{siparis.customerName || '—'}</div>
                            {siparis.teslimatSehri && <div className="text-xs text-gray-500">{siparis.teslimatSehri}</div>}
                          </td>
                          <td>
                            <Rozet rozet={odeme} ipucu={odeme.magazadaki ? `${t.cetpada_odendi_isaretlendi} · ${t.magazadaki_durum}: ${odeme.magazadaki}` : undefined} />
                          </td>
                          <td>
                            <Rozet rozet={kargo} ipucu={kargo.magazadaki ? `${t.magazadaki_durum}: ${kargo.magazadaki}` : undefined} />
                          </td>
                          <td className="text-right tabular-nums">{kalem === null ? '—' : kalem}</td>
                          <td className="text-right whitespace-nowrap">
                            <span className="font-bold tabular-nums">{tutar.metin}</span>
                            {tutar.birimEki && <span className="ml-1.5 text-[10px] font-bold text-gray-500">{tutar.birimEki}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

/**
 * ShopifyBaglantiKarti.tsx — Ayarlar → Entegrasyonlar: online mağaza (Shopify) webhook bağlantısı (2026-10-02).
 *
 * NEDEN VAR: eski "Shopify" kartı erişim belirtecini ve API sırrını istemcinin okuyabildiği `settings/app` dokümanına
 * yazıyor, kayıtlı değeri forma geri okuyor ve "Bağlı" rozetini yalnız alanın dolu olmasına bakarak gösteriyordu.
 * Bu kartın üç kuralı:
 *   1. SIR YALNIZ SUNUCUDA. İmza sırrı alanı yalnız YAZMA içindir: değeri bu bileşenin yerel durumundan gelir, her zaman
 *      boş başlar ve kayıtlı sırra hiçbir yoldan bağlanmaz. Sunucu sırrı döndürmez; döndürse bile `baglantiOku` yalnız
 *      bilinen alanları alır — yanıttaki fazladan alan duruma ve ekrana giremez.
 *   2. SAHTE KESİNLİK YOK. "Bağlı" rozeti yalnız en az bir bildirim ALINMIŞSA görünür. Kayıt var ama bildirim yoksa
 *      "Doğrulanmadı"; durum okunamadıysa rozet hiç yok. Bilinmeyen sayı/tarih '—' basılır, 0 uydurulmaz.
 *      İMZA REDDİ (2026-10-07): bildirim GELDİ ama imzası tutmadıysa sunucu yalnız `durum.sonImzaReddi` zamanını yazar.
 *      Kart bunu "henüz bildirim alınmadı"dan AYIRIR — yanlış yapıştırılmış sırda bildirimler geliyor ve reddediliyordur,
 *      kullanıcı sorunu mağaza tarafında aramasın. Ret satırı yalnız BİLGİDİR: rozeti değiştirmez (uç kimliksiz;
 *      uydurma bir istek sağlıklı bağlantının "Bağlı" rozetini düşürememeli).
 *   3. YALNIZ Admin DÜZENLER. Ayarlar sekmesini Manager da açabiliyor; o yalnız durumu görür (sunucu kapısı da aynı:
 *      POST uçları Admin dışına 403 döner — buradaki gizleme kolaylıktır, güvenlik sunucudadır).
 *
 * Uçlar (sunucu sözleşmesi; kanalRoutes): GET /api/shopify/baglanti · POST /api/shopify/baglanti ·
 * POST /api/shopify/baglanti/kaldir. Yazma uçları bilerek POST: IIS WebDAV PUT/DELETE'i kesebiliyor.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, RefreshCw, ShoppingBag, Trash2 } from 'lucide-react';
import { authFetch } from '../services/authFetch';
import { confirmAction } from '../lib/confirm';
import { tarihSaatYaz, zamanMs } from '../utils/zaman';
import { guncelImzaReddiMs } from '../utils/siparisler/magazaSiparisi';
import { useToast } from './Toast';
import { oc } from '../i18n/ortak';
import { sb } from '../i18n/shopifyBaglanti';

interface Props {
  currentLanguage: 'tr' | 'en';
  userRole: string;
  /** Süper-admin (platform sahibi) rolü Admin olmasa da düzenler — sunucu ona izin veriyor. */
  superYonetici?: boolean;
}

interface ShopifyDurum {
  /** epoch ms; çözülemeyen/olmayan zaman `null` (bilinmiyor) */
  sonBildirimMs: number | null;
  sonTopic: string | null;
  sonSiparisNo: string | null;
  sonSonuc: string | null;
  sonHata: string | null;
  sonHataZamaniMs: number | null;
  sonApiSurumu: string | null;
  toplamBildirim: number | null;
  /** İmzası tutmayan son bildirimin zamanı (epoch ms); hiç ret yoksa `null`. */
  sonImzaReddiMs: number | null;
}

interface ShopifyBaglanti {
  configured: boolean;
  shopDomain: string | null;
  webhookSirriKayitli: boolean;
  webhookAdresi: string | null;
  durum: ShopifyDurum | null;
}

const nesne = (v: unknown): Record<string, unknown> | null =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const metin = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const sayi = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Sunucu yanıtını bilinen alanlara indirir. Biçim tutmuyorsa `null` (çağıran "durum okunamadı" der).
 * Yalnız burada sayılan alanlar alınır: yanıtta sır taşıyan fazladan bir alan olsa bile bileşen durumuna GİRMEZ.
 */
function baglantiOku(govde: unknown): ShopifyBaglanti | null {
  const g = nesne(govde);
  if (!g || g.success !== true || typeof g.configured !== 'boolean') return null;
  const yol = metin(g.webhookYolu);
  const d = nesne(g.durum);
  return {
    configured: g.configured,
    shopDomain: metin(g.shopDomain),
    webhookSirriKayitli: g.webhookSirriKayitli === true,
    // Sunucu tam adresi bilmiyorsa (APP_URL tanımsız) istemci kendi kökünden kurar.
    webhookAdresi: metin(g.webhookAdresi) ?? (yol ? `${window.location.origin}${yol}` : null),
    durum: d && {
      sonBildirimMs: zamanMs(d.sonBildirim),
      sonTopic: metin(d.sonTopic),
      sonSiparisNo: metin(d.sonSiparisNo),
      sonSonuc: metin(d.sonSonuc),
      sonHata: metin(d.sonHata),
      sonHataZamaniMs: zamanMs(d.sonHataZamani),
      sonApiSurumu: metin(d.sonApiSurumu),
      toplamBildirim: sayi(d.toplamBildirim),
      sonImzaReddiMs: zamanMs(d.sonImzaReddi),
    },
  };
}

/** Hata yanıtındaki `{ success: false, error }` metni; yoksa `null`. */
const sunucuHatasi = (govde: unknown): string | null => metin(nesne(govde)?.error);

/** Yanıt gövdesi JSON değilse (ör. IIS'in HTML hata sayfası) `null`. */
async function govdeOku(r: Response): Promise<unknown> {
  try { return await r.json(); } catch { return null; }
}

/** `sonSonuc` kodu → ekran etiketi. Bilinmeyen kod ham hâliyle basılır (büyütülmeden). */
function sonucEtiketi(kod: string, dil: 'tr' | 'en'): string {
  const t = sb(dil);
  switch (kod) {
    case 'olusturuldu': return t.siparis_olusturuldu;
    case 'guncellendi': return t.siparis_guncellendi;
    case 'atlandi': return t.atlandi;
    case 'test': return t.test_bildirimi;
    case 'hata': return t.islenemedi;
    default: return kod;
  }
}

type Okuma = 'yukleniyor' | 'hazir' | 'yasak' | 'hata';

export default function ShopifyBaglantiKarti({ currentLanguage, userRole, superYonetici = false }: Props) {
  const t = sb(currentLanguage);
  const o = oc(currentLanguage);
  const toast = useToast();
  // Sunucu kapısıyla AYNI kural (routes/shopifyRoutes `yalnizYonetici`): Yönetici ya da süper-admin.
  const duzenleyebilir = userRole === 'Admin' || superYonetici;

  const [okuma, setOkuma] = useState<Okuma>('yukleniyor');
  const [baglanti, setBaglanti] = useState<ShopifyBaglanti | null>(null);
  const [alanAdi, setAlanAdi] = useState('');
  // İmza sırrı: YALNIZ kullanıcının bu oturumda yazdığı değer. Sunucudan gelen hiçbir şey buraya yazılmaz.
  const [sir, setSir] = useState('');
  const [mesgul, setMesgul] = useState<'kaydet' | 'kaldir' | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [kopya, setKopya] = useState<'tamam' | 'olmadi' | null>(null);
  const [yenileniyor, setYenileniyor] = useState(false);

  const adresRef = useRef<HTMLInputElement>(null);
  const kopyaZamanlayici = useRef<number | null>(null);
  const takili = useRef(true);
  const adresId = useId();
  const alanAdiId = useId();
  const sirId = useId();

  useEffect(() => {
    takili.current = true;
    return () => {
      takili.current = false;
      if (kopyaZamanlayici.current !== null) window.clearTimeout(kopyaZamanlayici.current);
    };
  }, []);

  /** `alanAdiniYaz`: ilk yüklemede ve kaydet/kaldır sonrasında; "Yenile"de değil (yazılmakta olan alan adı ezilmesin). */
  const uygula = useCallback((b: ShopifyBaglanti, alanAdiniYaz: boolean) => {
    setBaglanti(b);
    setOkuma('hazir');
    if (alanAdiniYaz) setAlanAdi(b.shopDomain ?? '');
  }, []);

  const yukle = useCallback(async (alanAdiniYaz: boolean) => {
    try {
      const r = await authFetch('/api/shopify/baglanti');
      const b = r.ok ? baglantiOku(await govdeOku(r)) : null;
      if (!takili.current) return;
      if (b) uygula(b, alanAdiniYaz);
      else { setBaglanti(null); setOkuma(r.status === 403 ? 'yasak' : 'hata'); }
    } catch {
      if (!takili.current) return;
      setBaglanti(null);
      setOkuma('hata');
    }
  }, [uygula]);

  useEffect(() => { void yukle(true); }, [yukle]);

  const hataGoster = (mesaj: string) => { setHata(mesaj); toast(mesaj, 'error'); };

  const yenile = async () => {
    // İlk okuma başarısızsa form hiç doldurulmadı: yeniden denemede alan adı da yazılır.
    const ilkOkuma = okuma !== 'hazir';
    if (ilkOkuma) setOkuma('yukleniyor');
    setYenileniyor(true);
    try { await yukle(ilkOkuma); } finally { if (takili.current) setYenileniyor(false); }
  };

  const kopyala = async () => {
    const adres = baglanti?.webhookAdresi;
    if (!adres) return;
    let sonuc: 'tamam' | 'olmadi' = 'tamam';
    try {
      await navigator.clipboard.writeText(adres);
    } catch {
      // Pano yok / izin yok (http, eski tarayıcı): adres seçili bırakılır, kullanıcı elle kopyalar.
      sonuc = 'olmadi';
      adresRef.current?.focus();
      adresRef.current?.select();
    }
    if (!takili.current) return;
    setKopya(sonuc);
    if (kopyaZamanlayici.current !== null) window.clearTimeout(kopyaZamanlayici.current);
    kopyaZamanlayici.current = window.setTimeout(() => setKopya(null), sonuc === 'tamam' ? 2000 : 6000);
  };

  const kaydet = async () => {
    if (!duzenleyebilir || mesgul) return;
    const shopDomain = alanAdi.trim();
    const webhookSecret = sir.trim();
    if (!shopDomain) { hataGoster(t.magaza_alan_adini_gir); return; }
    if (!webhookSecret && !baglanti?.webhookSirriKayitli) { hataGoster(t.ilk_kurulumda_imza_sirri_zorunlu); return; }
    setMesgul('kaydet');
    setHata(null);
    try {
      const r = await authFetch('/api/shopify/baglanti', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Boş sır alanı gövdeye HİÇ girmez: sunucuda "alan yok" = kayıtlı sır korunur.
        body: JSON.stringify(webhookSecret ? { shopDomain, webhookSecret } : { shopDomain }),
      });
      const govde = await govdeOku(r);
      if (!takili.current) return;
      if (!r.ok || nesne(govde)?.success !== true) {
        hataGoster(sunucuHatasi(govde) ?? `${t.baglanti_kaydedilemedi} (HTTP ${r.status})`);
        return;
      }
      // Kayıt başarılı: yazılan sır artık sunucuda — istemcide tutulmaz.
      setSir('');
      const b = baglantiOku(govde);
      if (b) uygula(b, true); else await yukle(true);
      toast(t.shopify_baglantisi_kaydedildi, 'success');
    } catch (e) {
      if (!takili.current) return;
      hataGoster(e instanceof Error && e.message ? `${t.baglanti_kaydedilemedi}: ${e.message}` : t.baglanti_kaydedilemedi);
    } finally {
      if (takili.current) setMesgul(null);
    }
  };

  const kaldir = async () => {
    if (!duzenleyebilir || mesgul) return;
    const onay = await confirmAction({
      title: t.shopify_baglantisi_kaldirilsin_mi,
      message: t.kaldirma_onay_metni,
      confirmLabel: o.kaldir,
      variant: 'danger',
    });
    if (!onay || !takili.current) return;
    setMesgul('kaldir');
    setHata(null);
    try {
      const r = await authFetch('/api/shopify/baglanti/kaldir', { method: 'POST' });
      const govde = await govdeOku(r);
      if (!takili.current) return;
      if (!r.ok || nesne(govde)?.success !== true) {
        hataGoster(sunucuHatasi(govde) ?? `${t.baglanti_kaldirilamadi} (HTTP ${r.status})`);
        return;
      }
      setSir('');
      await yukle(true);
      toast(t.shopify_baglantisi_kaldirildi, 'success');
    } catch (e) {
      if (!takili.current) return;
      hataGoster(e instanceof Error && e.message ? `${t.baglanti_kaldirilamadi}: ${e.message}` : t.baglanti_kaldirilamadi);
    } finally {
      if (takili.current) setMesgul(null);
    }
  };

  const durum = baglanti?.durum ?? null;
  // "Bildirim alındı" = sunucunun durum kaydında en az bir bildirim izi var. Yalnız kayıt (alan adı + sır) yetmez.
  const bildirimAlindi = !!durum && (durum.sonBildirimMs !== null || (durum.toplamBildirim !== null && durum.toplamBildirim > 0));
  // Güncel imza reddi: ret, son KABUL edilen bildirimden yeniyse ya da hiç bildirim yoksa. Kural Online Siparişler şeridiyle
  // ORTAK yardımcıda (`guncelImzaReddiMs`) — burada yeniden yazılmaz.
  const imzaReddiMs = durum ? guncelImzaReddiMs(durum.sonImzaReddiMs, durum.sonBildirimMs) : null;
  const kayitVar = !!baglanti && (baglanti.configured || baglanti.webhookSirriKayitli || !!baglanti.shopDomain);
  const etiket = 'text-[10px] font-bold text-gray-400 uppercase';
  const rozet = 'text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0';

  return (
    <section aria-label="Shopify" className="apple-card p-5 flex flex-col gap-4 md:col-span-2">
      {/* Başlık + rozet */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center shrink-0">
          <ShoppingBag className="w-4.5 h-4.5 text-green-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-sm">Shopify</h3>
          <p className="text-[11px] text-[#86868B]">{t.online_magaza_siparis_bildirimleri}</p>
        </div>
        {okuma === 'hazir' && baglanti && (
          !baglanti.configured
            ? <span className={`${rozet} bg-gray-100 text-gray-500`}>{o.bagli_degil}</span>
            : bildirimAlindi
              ? <span className={`${rozet} bg-green-100 text-green-600`}>{o.bagli}</span>
              : <span className={`${rozet} bg-amber-100 text-amber-700`}>{t.dogrulanmadi}</span>
        )}
        <button
          type="button"
          onClick={() => { void yenile(); }}
          disabled={okuma === 'yukleniyor' || yenileniyor || mesgul !== null}
          aria-label={o.yenile}
          title={o.yenile}
          className="p-1.5 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${okuma === 'yukleniyor' || yenileniyor ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {okuma === 'yukleniyor' && (
        <p role="status" className="text-xs text-gray-400">{o.yukleniyor}</p>
      )}

      {(okuma === 'hata' || okuma === 'yasak') && (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-amber-50 text-amber-800 px-3 py-2.5 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{t.baglanti_durumu_okunamadi}</p>
            {okuma === 'yasak' && <p>{t.bu_rol_baglanti_durumunu_goremez}</p>}
          </div>
        </div>
      )}

      {okuma === 'hazir' && baglanti && (
        <>
          {/* Durum */}
          <div className="rounded-xl bg-gray-50 px-3 py-3 space-y-2">
            <p className={etiket}>{t.baglanti_durumu}</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">{t.baglanti}</dt>
                <dd className="font-semibold text-gray-800">{baglanti.configured ? t.kuruldu : t.kurulmadi}</dd>
              </div>
              {!duzenleyebilir && (
                <>
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500">{t.magaza_alan_adi}</dt>
                    <dd className="font-mono font-semibold text-gray-800 break-all text-right">{baglanti.shopDomain ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500">{t.imza_sirri}</dt>
                    <dd className="font-semibold text-gray-800">{baglanti.webhookSirriKayitli ? t.kayitli : t.kayitli_degil}</dd>
                  </div>
                </>
              )}
              {bildirimAlindi && durum && (
                <>
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500">{t.son_bildirim}</dt>
                    <dd className="font-semibold text-gray-800">{tarihSaatYaz(durum.sonBildirimMs, undefined, currentLanguage)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500">{t.son_olay_turu}</dt>
                    <dd className="font-semibold text-gray-800 text-right">
                      <span className="font-mono">{durum.sonTopic ?? '—'}</span>
                      {durum.sonSonuc && <span className="text-gray-500 font-normal"> · {sonucEtiketi(durum.sonSonuc, currentLanguage)}</span>}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500">{t.son_siparis_no}</dt>
                    <dd className="font-mono font-semibold text-gray-800">{durum.sonSiparisNo ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500">{t.toplam_bildirim}</dt>
                    <dd className="font-mono font-semibold text-gray-800">
                      {durum.toplamBildirim !== null ? durum.toplamBildirim.toLocaleString(currentLanguage === 'tr' ? 'tr-TR' : 'en-US') : '—'}
                    </dd>
                  </div>
                  {durum.sonApiSurumu && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500">{t.api_surumu}</dt>
                      <dd className="font-mono font-semibold text-gray-800">{durum.sonApiSurumu}</dd>
                    </div>
                  )}
                </>
              )}
            </dl>
            {baglanti.configured && imzaReddiMs !== null ? (
              <p className="text-xs font-semibold text-amber-700">
                {t.imza_dogrulanamadi.replace('{zaman}', tarihSaatYaz(imzaReddiMs, undefined, currentLanguage))}
              </p>
            ) : baglanti.configured && !bildirimAlindi && (
              <p className="text-xs font-semibold text-amber-700">{t.henuz_bildirim_alinmadi}</p>
            )}
            {durum?.sonHata && (
              <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-bold">
                    {t.son_hata}
                    {durum.sonHataZamaniMs !== null && <span className="font-normal"> · {tarihSaatYaz(durum.sonHataZamaniMs, undefined, currentLanguage)}</span>}
                  </p>
                  <p className="break-words">{durum.sonHata}</p>
                </div>
              </div>
            )}
          </div>

          {!duzenleyebilir && (
            <p className="text-[11px] text-gray-500">{t.yalniz_yonetici_duzenleyebilir}</p>
          )}

          {duzenleyebilir && (
            <>
              {/* Webhook adresi — salt okunur, kopyalanır */}
              {baglanti.webhookAdresi && (
                <div className="space-y-1">
                  <label htmlFor={adresId} className={etiket}>{t.webhook_adresi}</label>
                  <div className="flex items-center gap-2">
                    <input
                      id={adresId}
                      ref={adresRef}
                      type="text"
                      readOnly
                      value={baglanti.webhookAdresi}
                      onFocus={e => e.currentTarget.select()}
                      className="apple-input flex-1 min-w-0 font-mono text-xs"
                    />
                    <button type="button" onClick={() => { void kopyala(); }} className="apple-button-secondary text-xs">
                      {kopya === 'tamam' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {kopya === 'tamam' ? t.kopyalandi : o.kopyala}
                    </button>
                  </div>
                  {kopya === 'olmadi' && <p role="status" className="text-[11px] text-amber-700">{t.kopyalanamadi}</p>}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor={alanAdiId} className={etiket}>{t.magaza_alan_adi}</label>
                  <input
                    id={alanAdiId}
                    type="text"
                    value={alanAdi}
                    onChange={e => { setAlanAdi(e.target.value); setHata(null); }}
                    placeholder="magaza-adi.myshopify.com"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={mesgul !== null}
                    className="apple-input w-full font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor={sirId} className={etiket}>{t.imza_sirri}</label>
                    {baglanti.webhookSirriKayitli && (
                      <span className={`${rozet} bg-green-100 text-green-600`}>{t.kayitli}</span>
                    )}
                  </div>
                  {/* Yalnız yazma: değer yerel `sir` durumundan gelir, kayıtlı sırra bağlanmaz (bkz. dosya başı, kural 1). */}
                  <input
                    id={sirId}
                    type="password"
                    value={sir}
                    onChange={e => { setSir(e.target.value); setHata(null); }}
                    placeholder={t.imza_anahtarini_yapistir}
                    autoComplete="new-password"
                    spellCheck={false}
                    disabled={mesgul !== null}
                    className="apple-input w-full font-mono text-xs"
                  />
                  <p className="text-[11px] text-gray-500">
                    {baglanti.webhookSirriKayitli ? t.bos_birakirsan_mevcut_sir_korunur : t.ilk_kurulumda_zorunlu}
                  </p>
                </div>
              </div>

              {hata && (
                <p role="alert" className="rounded-xl bg-red-50 text-red-700 px-3 py-2 text-xs font-semibold break-words">{hata}</p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => { void kaydet(); }} disabled={mesgul !== null} className="apple-button-primary">
                  {mesgul === 'kaydet' ? o.kaydediliyor_2 : o.kaydet}
                </button>
                {kayitVar && (
                  <button type="button" onClick={() => { void kaldir(); }} disabled={mesgul !== null} className="apple-button-secondary text-red-600">
                    <Trash2 className="w-3.5 h-3.5" />
                    {mesgul === 'kaldir' ? t.kaldiriliyor : t.baglantiyi_kaldir}
                  </button>
                )}
              </div>

              {/* Kurulum adımları */}
              <div className="rounded-xl border border-gray-100 px-3 py-3 space-y-2">
                <p className={etiket}>{t.shopify_da_kurulum}</p>
                <ol className="list-decimal pl-4 space-y-1 text-xs text-gray-600">
                  <li>{t.adim_webhook_olustur}</li>
                  <li>{t.adim_bicim_ve_adres}</li>
                  <li>{t.adim_olaylar}</li>
                  <li>{t.adim_imza_anahtari}</li>
                </ol>
                <p className="text-[11px] text-gray-500">{t.ilk_bildirim_geldiginde_dogrulanir}</p>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

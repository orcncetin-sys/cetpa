/**
 * MusteriHesabiYonetimi.tsx — Yönetici ekranının (`pages/AdminPage.tsx` «Kullanıcılar») müşteri / bayi hesabı parçaları (2026-10-21, şartname
 * `.wf/SARTNAME-musteri-siparislerim.md` K3, H7, H8, H9, H18).
 *
 *   • `MusteriCariSecimi` — «Kullanıcı Ekle (manuel)»da dış rol (B2B / Bayi) seçilince ZORUNLU cari seçimi (`CustomerCombobox` yeniden
 *     kullanılır). Serbest yazım KABUL EDİLMEZ: yazı değişince seçili `leadId` sıfırlanır, yalnız listeden seçim atar.
 *   • `useMusteriHesaplari` — `GET /api/admin/musteri-hesaplari` (kiracının bağları; ham cari kodu DÖNMEZ). Yalnız Yönetici için çağrılır.
 *   • `MusteriHesapHucresi` — kullanıcı tablosunda dış rol satırının rol hücresi: rol seçicisi YERİNE rozet + firma + cari kodu durumu +
 *     «Erişimi kapat / aç» + «Cari bağla / Cari kodunu tazele». İki işlem de ONAY penceresinden geçer (iptalde istek GİTMEZ).
 *
 * KAPI: istemcide de yalnız Yönetici (`yonetici` niteliği; sunucuda üç uç zaten yalnız Yönetici — `routes/musteriHesapRoutes`). Metinler
 * dürüst: erişim kapatma kişinin MAĞAZA (bayi ekranı) oturumlarını kapatır; «tüm cihazlardan çıkış» gibi ERP oturumunu anında
 * kapattığını söyleyen metin YAZILMAZ (Firebase yenileme iptali elde kalan kimlik belirtecini en çok 1 saat yaşatır).
 */
import { useEffect, useState } from 'react';
import CustomerCombobox from './CustomerCombobox';
import { authFetch } from '../services/authFetch';
import { methodTunnel } from '../lib/dbClient';
import { oc } from '../i18n/ortak';
import type { Lead } from '../types';

type Dil = 'tr' | 'en';
type CariKodDurumu = 'yok' | 'uyusuyor' | 'farkli';

/** Sunucu listesinin bir satırı (`routes/musteriHesapRoutes` `GET /api/admin/musteri-hesaplari`). */
export interface MusteriHesapSatiri {
  uid: string;
  leadId: string;
  firma: string;
  durum: 'acik' | 'kapali';
  cariKodDurumu: CariKodDurumu;
}
export type MusteriHesapOkumasi =
  | { tur: 'okunuyor' }
  | { tur: 'hata' }
  | { tur: 'tamam'; hesaplar: ReadonlyMap<string, MusteriHesapSatiri> };

export interface CariSecimi { metin: string; leadId: string | null }
export const BOS_CARI_SECIMI: CariSecimi = { metin: '', leadId: null };

type OnayPenceresi = (opts: { title: string; message: string; confirmLabel?: string; variant?: 'danger' | 'default'; onConfirm: () => void }) => void;

const nesne = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? { ...v } : {});
const KOD_DURUMLARI: readonly CariKodDurumu[] = ['yok', 'uyusuyor', 'farkli'];

/** Liste yanıtını çözer (SAF): türüne uymayan satır atılır; gövde biçimsizse `null`. */
export function musteriHesapListesiCoz(govde: unknown): MusteriHesapSatiri[] | null {
  const hesaplar = nesne(govde).hesaplar;
  if (!Array.isArray(hesaplar)) return null;
  const sonuc: MusteriHesapSatiri[] = [];
  for (const ham of hesaplar) {
    const h = nesne(ham);
    const kodDurumu = KOD_DURUMLARI.find(k => k === h.cariKodDurumu);
    if (typeof h.uid !== 'string' || typeof h.leadId !== 'string' || (h.durum !== 'acik' && h.durum !== 'kapali') || kodDurumu === undefined) continue;
    sonuc.push({ uid: h.uid, leadId: h.leadId, firma: typeof h.firma === 'string' ? h.firma : '', durum: h.durum, cariKodDurumu: kodDurumu });
  }
  return sonuc;
}

/** Kiracının müşteri hesabı bağları. `etkin` değilse (Yönetici değil / sekme kapalı) istek GİTMEZ. `yenile()` listeyi yeniden çeker. */
export function useMusteriHesaplari(etkin: boolean): { okuma: MusteriHesapOkumasi; yenile: () => void } {
  const [okuma, setOkuma] = useState<MusteriHesapOkumasi>({ tur: 'okunuyor' });
  const [sayac, setSayac] = useState(0);
  useEffect(() => {
    if (!etkin) return;
    let gecerli = true;
    void (async () => {
      try {
        const r = await authFetch('/api/admin/musteri-hesaplari');
        const govde: unknown = await r.json();
        if (!gecerli) return;
        const liste = r.ok ? musteriHesapListesiCoz(govde) : null;
        setOkuma(liste === null ? { tur: 'hata' } : { tur: 'tamam', hesaplar: new Map(liste.map(h => [h.uid, h])) });
      } catch {
        if (gecerli) setOkuma({ tur: 'hata' });
      }
    })();
    return () => { gecerli = false; };
  }, [etkin, sayac]);
  return { okuma, yenile: () => { setSayac(n => n + 1); } };
}

/** Dış rol satırının rozet metni (yalnız B2B / Bayi satırında çağrılır; Yönetici ekranının «Bayi» adıyla aynı). */
export function musteriRolAdi(rol: unknown, dil: Dil): string {
  if (rol === 'Dealer') return dil === 'tr' ? 'Bayi' : 'Dealer';
  return 'B2B';
}

/** Lead'in GÜNCEL kırpılmış Mikro cari kodu (bu ekrandaki lead listesinden); yoksa `null`. */
function leadCariKodu(leads: readonly Lead[], leadId: string): string | null {
  const lead = leads.find(l => l.id === leadId);
  const kod = lead && typeof lead.mikroCariKod === 'string' ? lead.mikroCariKod.trim() : '';
  return kod === '' ? null : kod;
}

/** Yanıt gövdesinden kullanıcıya gösterilecek ret metni (4xx `error`); yoksa genel metin. */
function retMetni(durumKodu: number, govde: unknown, dil: Dil): string {
  const hata = nesne(govde).error;
  if (durumKodu >= 400 && durumKodu < 500 && typeof hata === 'string' && hata.trim() !== '') return hata;
  return dil === 'tr' ? 'İşlem yapılamadı. Biraz sonra yeniden deneyin.' : 'The action could not be completed. Try again shortly.';
}

// ── «Kullanıcı Ekle (manuel)»: dış rol için ZORUNLU cari seçimi ────────────────────────────────────────────────────────
export function MusteriCariSecimi({ leads, dil, secim, onSecim }: {
  leads: Lead[]; dil: Dil; secim: CariSecimi; onSecim: (s: CariSecimi) => void;
}) {
  return (
    <div className="mt-2 space-y-1" data-musteri-cari="">
      <p className="text-xs font-medium text-gray-600">
        {dil === 'tr' ? 'Cari (zorunlu) — müşteri hesabı yalnız seçilen carinin siparişlerini görür' : 'Customer account (required) — the customer sees only this account’s orders'}
      </p>
      <CustomerCombobox
        leads={leads}
        value={secim.metin}
        // Serbest yazım kabul edilmez: yazı değişince seçim düşer; yalnız listeden seçim `leadId` atar.
        onChange={metin => onSecim({ metin, leadId: null })}
        onSelect={lead => onSecim({ metin: lead.company || lead.name, leadId: lead.id })}
        placeholder={dil === 'tr' ? 'Cari ara (firma ya da kişi adı)' : 'Search customer (company or name)'}
        inputClassName="apple-input w-full text-sm pl-9"
        renderSecondaryLine={lead => [lead.company, typeof lead.mikroCariKod === 'string' ? lead.mikroCariKod : ''].filter(p => p !== '').join(' · ')}
        emptyText={dil === 'tr' ? 'Bu ekranda cari yok.' : 'No customers on this screen.'}
      />
      {secim.leadId === null && (
        <p className="text-[10px] text-amber-700">{dil === 'tr' ? 'Listeden bir cari seçin.' : 'Pick a customer from the list.'}</p>
      )}
    </div>
  );
}

// ── Kullanıcı tablosu: dış rol satırının rol hücresi ──────────────────────────────────────────────────────────────────
export function MusteriHesapHucresi({ uid, rolAdi, dil, yonetici, okuma, leads, openConfirm, onDegisti }: {
  uid: string;
  /** Rozet metni (ör. «Bayi»). */
  rolAdi: string;
  dil: Dil;
  /** Yalnız Yönetici / süper yönetici: değilse yalnız rozet. */
  yonetici: boolean;
  okuma: MusteriHesapOkumasi;
  leads: Lead[];
  openConfirm: OnayPenceresi;
  /** Başarılı yazımdan sonra liste yeniden çekilsin. */
  onDegisti: () => void;
}) {
  const [mesgul, setMesgul] = useState(false);
  const [mesaj, setMesaj] = useState<{ tip: 'ok' | 'hata'; metin: string } | null>(null);
  const [baglama, setBaglama] = useState<CariSecimi | null>(null);
  const tr = dil === 'tr';
  const rozet = <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700">{rolAdi}</span>;
  if (!yonetici) return rozet;
  if (okuma.tur !== 'tamam') {
    return (
      <div className="flex flex-col items-center gap-1">
        {rozet}
        <span className="text-[10px] text-gray-500">
          {okuma.tur === 'okunuyor' ? (tr ? 'Müşteri bilgisi okunuyor…' : 'Reading customer details…') : (tr ? 'Müşteri bilgisi okunamadı.' : 'Customer details could not be read.')}
        </span>
      </div>
    );
  }
  const hesap = okuma.hesaplar.get(uid) ?? null;

  /** `PUT /api/admin/musteri-hesaplari/:uid` (IIS tüneli). Aynı `leadId` = cari kodunu tazeleme. */
  const bagYaz = async (leadId: string): Promise<void> => {
    setMesgul(true); setMesaj(null);
    try {
      const t = methodTunnel('PUT');
      const r = await authFetch(`/api/admin/musteri-hesaplari/${encodeURIComponent(uid)}`, {
        method: t.method, headers: { 'Content-Type': 'application/json', ...t.header }, body: JSON.stringify({ leadId }),
      });
      const govde: unknown = await r.json().catch(() => null);
      if (!r.ok) { setMesaj({ tip: 'hata', metin: retMetni(r.status, govde, dil) }); return; }
      const mf = nesne(govde).mfSayisi;
      setMesaj({
        tip: 'ok',
        metin: mf === 0
          ? (tr ? 'Cari bağı yazıldı. Bu cari koduyla Mikro faturası siparişi yok.' : 'Customer link saved. There are no Mikro invoice orders with this account code.')
          : (tr ? 'Cari bağı yazıldı.' : 'Customer link saved.'),
      });
      setBaglama(null);
      onDegisti();
    } catch {
      setMesaj({ tip: 'hata', metin: retMetni(0, null, dil) });
    } finally { setMesgul(false); }
  };
  /** `POST /api/admin/musteri-hesaplari/:uid/durum`. */
  const durumYaz = async (durum: 'acik' | 'kapali'): Promise<void> => {
    setMesgul(true); setMesaj(null);
    try {
      const r = await authFetch(`/api/admin/musteri-hesaplari/${encodeURIComponent(uid)}/durum`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ durum }),
      });
      const govde: unknown = await r.json().catch(() => null);
      if (!r.ok) { setMesaj({ tip: 'hata', metin: retMetni(r.status, govde, dil) }); return; }
      setMesaj({ tip: 'ok', metin: durum === 'kapali' ? (tr ? 'Erişim kapatıldı.' : 'Access closed.') : (tr ? 'Erişim açıldı.' : 'Access opened.') });
      onDegisti();
    } catch {
      setMesaj({ tip: 'hata', metin: retMetni(0, null, dil) });
    } finally { setMesgul(false); }
  };

  const erisimDugmesi = (h: MusteriHesapSatiri) => {
    const kapat = h.durum === 'acik';
    return (
      <button
        type="button"
        disabled={mesgul}
        onClick={() => openConfirm(kapat
          ? {
            title: tr ? 'Erişimi kapat' : 'Close access',
            message: tr
              ? 'Bu kişinin mağaza oturumları hemen kapanır; erişim yeniden açılana kadar bayi ekranına giriş yapamaz.'
              : 'This person’s store sessions close immediately; they cannot sign in to the dealer screen until access is opened again.',
            confirmLabel: tr ? 'Erişimi kapat' : 'Close access',
            variant: 'danger',
            onConfirm: () => { void durumYaz('kapali'); },
          }
          : {
            title: tr ? 'Erişimi aç' : 'Open access',
            message: tr
              ? 'Kişi bayi ekranına e-posta ve şifresiyle yeniden girebilir.'
              : 'The person can sign in to the dealer screen again with their email and password.',
            confirmLabel: tr ? 'Erişimi aç' : 'Open access',
            onConfirm: () => { void durumYaz('acik'); },
          })}
        className={kapat
          ? 'text-[10px] font-bold px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40'
          : 'text-[10px] font-bold px-2 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-40'}
      >
        {kapat ? (tr ? 'Erişimi kapat' : 'Close access') : (tr ? 'Erişimi aç' : 'Open access')}
      </button>
    );
  };
  const tazeleDugmesi = (h: MusteriHesapSatiri) => {
    const guncel = leadCariKodu(leads, h.leadId);
    return (
      <button
        type="button"
        disabled={mesgul}
        onClick={() => openConfirm({
          title: tr ? 'Cari kodunu tazele' : 'Refresh account code',
          message: tr
            ? `Lead'in güncel Mikro cari kodu: ${guncel ?? 'yok'}. Kod değişirse kişinin açık mağaza oturumu kapanır, yeniden şifreyle girmesi gerekir.`
            : `The lead’s current Mikro account code: ${guncel ?? 'none'}. If the code changes, the person’s open store session closes and they must sign in again with their password.`,
          confirmLabel: tr ? 'Tazele' : 'Refresh',
          onConfirm: () => { void bagYaz(h.leadId); },
        })}
        className="text-[10px] font-bold px-2 py-1 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40"
      >
        {tr ? 'Cari kodunu tazele' : 'Refresh account code'}
      </button>
    );
  };

  const kodSatiri = (h: MusteriHesapSatiri): string => {
    if (h.cariKodDurumu === 'yok') return tr ? 'Mikro cari kodu yok — yalnız ERP siparişleri görünür.' : 'No Mikro account code — only ERP orders are visible.';
    if (h.cariKodDurumu === 'farkli') return tr ? 'Lead\'in cari kodu değişti — «Cari kodunu tazele» ile güncelleyin.' : 'The lead’s account code changed — update it with “Refresh account code”.';
    const kod = leadCariKodu(leads, h.leadId);
    return kod === null ? (tr ? 'Cari kodu uyuşuyor.' : 'Account code matches.') : (tr ? `Cari kodu: ${kod}` : `Account code: ${kod}`);
  };

  return (
    <div className="flex flex-col items-center gap-1 text-[11px]" data-musteri-hucre={uid}>
      {rozet}
      {hesap === null ? (
        <>
          <span className="text-amber-700">{tr ? 'Cari bağı yok — bayi ekranına giremez.' : 'No customer link — cannot sign in to the dealer screen.'}</span>
          {baglama === null ? (
            <button type="button" disabled={mesgul} onClick={() => setBaglama({ metin: '', leadId: null })}
              className="text-[10px] font-bold px-2 py-1 rounded-lg bg-brand/10 text-brand hover:bg-brand/20 disabled:opacity-40">
              {tr ? 'Cari bağla' : 'Link customer'}
            </button>
          ) : (
            <div className="w-56 text-left">
              <MusteriCariSecimi leads={leads} dil={dil} secim={baglama} onSecim={setBaglama} />
              <div className="flex gap-1 mt-1">
                <button type="button" disabled={mesgul || baglama.leadId === null}
                  onClick={() => { if (baglama.leadId !== null) void bagYaz(baglama.leadId); }}
                  className="text-[10px] font-bold px-2 py-1 rounded-lg bg-brand text-white disabled:opacity-40">
                  {tr ? 'Bağla' : 'Link'}
                </button>
                <button type="button" onClick={() => setBaglama(null)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-gray-100 text-gray-600">
                  {oc(dil).vazgec}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <span className="font-medium text-gray-800">{hesap.firma !== '' ? hesap.firma : '—'}</span>
          <span className={hesap.cariKodDurumu === 'farkli' ? 'text-amber-700' : 'text-gray-500'}>{kodSatiri(hesap)}</span>
          <span className={hesap.durum === 'acik' ? 'text-green-700' : 'text-red-600'}>
            {hesap.durum === 'acik' ? (tr ? 'Erişim açık' : 'Access open') : (tr ? 'Erişim kapalı' : 'Access closed')}
          </span>
          <div className="flex flex-wrap justify-center gap-1">
            {erisimDugmesi(hesap)}
            {tazeleDugmesi(hesap)}
          </div>
        </>
      )}
      {mesaj && <span role={mesaj.tip === 'hata' ? 'alert' : 'status'} className={mesaj.tip === 'hata' ? 'text-red-600' : 'text-green-700'}>{mesaj.metin}</span>}
    </div>
  );
}

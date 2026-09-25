/**
 * MikroFaturaDetay.tsx — Mikro faturasının detay penceresi + XML/PDF indirme.
 *
 * 2026-08-01: Faturalar sekmesinde yalnız tablo vardı; kullanıcı satıra girip
 * belgenin XML ve PDF'ini alabilmek istedi.
 *
 * XML e-belgenin YASAL aslıdır, PDF yalnız görüntüsüdür — mali müşavire
 * gönderim ve arşiv için gereken XML'dir. İkisi de Mikro'dan çekilir
 * (/api/mikro/ebelge/xml ve /api/mikro/ebelge/pdf).
 *
 * UUID yoksa e-belge çekilemez: fatura Mikro'da kesilmiş ama GİB'e
 * gönderilmemiş (ya da kağıt fatura) olabilir. O durumda düğmeler yerine
 * sebebi yazılır — sessizce boş buton göstermek yanıltıcı olur.
 */
import { useState, useEffect, useMemo } from 'react';
import { X, Download, FileCode, Loader2, AlertTriangle, Package } from 'lucide-react';
import { eBelgeIndir } from '../services/ebelgeIndir';
import { authFetch } from '../services/authFetch';
import { paraYaz } from '../utils/currency';
import { VERGI_PNTR_ORAN } from '../hooks/useMikroFaturalar';
import { kalemleriCoz, satirMasrafi, birimFiyatOndaligi } from '../lib/stokFiyat';
import { bilinenSayi } from '../utils/para';
import { oc } from '../i18n/ortak';

export interface MikroFaturaDetayVerisi {
  id: string;
  faturaNo: string;
  musteri: string;
  cariKod: string;
  tarih: string;
  /** **NaN = BİLİNMİYOR** (useMikroFaturalar ile aynı sözleşme) — ekranda '—', toplama girmez. */
  tutar: number;
  /** **NaN = BİLİNMİYOR.** */
  kdv: number;
  /** **NaN = BİLİNMİYOR.** */
  matrah: number;
  oran: number | null;
  oranKarma?: boolean;
  yon: 'gelen' | 'giden';
  uuid?: string;
  /** Fatura BAŞLIĞI Cetpa'da yok (stok hareketinin evrak anahtarından açıldı — `utils/faturaEsle.hareketFaturasi`):
   *  toplam/KDV/matrah bilinmiyor, kalemler seri+sıra+yön ile doğrudan Mikro'dan gelir. */
  baslikYok?: boolean;
}

interface Props {
  fatura: MikroFaturaDetayVerisi;
  currentLanguage: string;
  onClose: () => void;
}

const tl = (n: number) => paraYaz(n);

export default function MikroFaturaDetay({ fatura, currentLanguage, onClose }: Props) {
  const tr = currentLanguage === 'tr';
  const [indiriliyor, setIndiriliyor] = useState<'xml' | 'pdf' | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  /** Fatura KALEMLERİ (satırları) — Mikro Jump'ta fatura açılınca görülenin karşılığı.
   *  Başlık CARI_HESAP_HAREKETLERI'nde, satırlar STOK_HAREKETLERI'nde durur; sunucu
   *  evrak seri+sıra ve yön (satış=4 / alış=3) ile eşleştirir. */
  // faturaNo 'SERİ-SIRA' biçiminde birleştirilmişti; sıra son parçadır.
  const { seri, sira } = useMemo(() => {
    const p = (fatura.faturaNo || '').split('-');
    return { sira: p.at(-1) ?? '', seri: p.length > 1 ? p.slice(0, -1).join('-') : '' };
  }, [fatura.faturaNo]);
  const evrakOkunabilir = /^\d+$/.test(sira);

  const [kalemler, setKalemler] = useState<Record<string, unknown>[] | null>(null);
  const [cekimDurum, setCekimDurum] = useState<'yukleniyor' | 'hazir' | 'hata'>('yukleniyor');
  const [cekimHata, setCekimHata] = useState<string | null>(null);

  useEffect(() => {
    if (!evrakOkunabilir) return;   // durum türetilir, effect'te setState yok
    let iptal = false;
    (async () => {
      try {
        const r = await authFetch('/api/mikro/fatura/kalemler', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seri, sira, yon: fatura.yon }),
        });
        const d = await r.json() as { success?: boolean; error?: string; kalemler?: Record<string, unknown>[] };
        if (iptal) return;
        if (!r.ok || !d.success) { setCekimDurum('hata'); setCekimHata(d.error || (tr ? 'Kalemler alınamadı.' : 'Failed to load lines.')); return; }
        setKalemler(d.kalemler ?? []);
        setCekimDurum('hazir');
      } catch {
        if (!iptal) { setCekimDurum('hata'); setCekimHata(tr ? 'Sunucuya ulaşılamadı.' : 'Server unreachable.'); }
      }
    })();
    return () => { iptal = true; };
  }, [seri, sira, evrakOkunabilir, fatura.yon, tr]);

  // Okunamayan evrak no bir RENDER durumudur, effect yan etkisi değil.
  const kalemDurum = evrakOkunabilir ? cekimDurum : 'hata';
  const kalemHata = evrakOkunabilir
    ? cekimHata
    : (tr ? 'Evrak numarası okunamadı — kalemler getirilemiyor.' : 'Unreadable document number.');

  /** Karma KDV kırılımı (2026-08-17, kullanıcı bildirdi): fatura başlığı tek bir
   *  "%20" gösteriyordu ama satırlarda hem %10 hem %20'li ürün olabiliyordu.
   *  `kalemler` zaten sth_vergi_pntr/sth_vergi/sth_tutar'ı satır satır getiriyor
   *  — yeni bir Mikro sorgusu gerekmeden, burada gruplanıp gerçek kırılım
   *  gösterilebilir (liste ekranındaki "Karma" rozeti yalnız uyarı verir,
   *  burada asıl rakamlar var). */
  /** Kalem netleri: satırın KDV'si + (biliniyorsa) fatura toplamıyla çözülür — lib/stokFiyat.kalemleriCoz. */
  const cozumler = useMemo(() => (kalemler?.length ? kalemleriCoz(kalemler, fatura.tutar) : []), [kalemler, fatura.tutar]);

  const oranKirilim = useMemo(() => {
    if (!kalemler?.length) return null;
    const map = new Map<string, { oran: number | null; matrah: number; kdv: number }>();
    for (const [i, k] of kalemler.entries()) {
      const oran = VERGI_PNTR_ORAN[String(k.sth_vergi_pntr ?? '')] ?? null;
      const key = oran === null ? 'bilinmiyor' : String(oran);
      const cur = map.get(key) ?? { oran, matrah: 0, kdv: 0 };
      // Matrah NET'tir (iskonto düşülmüş — lib/stokFiyat.satirNet, KDV ile sağlanır); eskiden BRÜT sth_tutar toplanıyordu
      // ve iskontolu faturada matrah + KDV fatura toplamını tutmuyordu. Hesaplanamayan satır 0 SAYILMAZ, atlanır.
      const net = cozumler[i]?.net;
      if (net != null) cur.matrah += net;
      if (bilinenSayi(k.sth_vergi)) cur.kdv += Math.abs(Number(k.sth_vergi));
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => (b.oran ?? -1) - (a.oran ?? -1));
  }, [kalemler, cozumler]);

  /** SAĞLAMA (2026-09-18): Σ kalem neti + Σ masraf + Σ KDV, fatura toplamını tutuyor mu? İskontonun doğru düşüldüğünün
   *  ekrandaki kanıtı — tutmuyorsa kullanıcı bunu GÖRÜR (sessiz yanlış fiyat yerine). */
  const saglama = useMemo(() => {
    if (!kalemler?.length || !bilinenSayi(fatura.tutar)) return null;
    let net = 0, kdv = 0, masraf = 0, brut = 0, eksik = 0;
    for (const [i, k] of kalemler.entries()) {
      const c = cozumler[i];
      // Miktarı 0 olan satırın (fiyat farkı) TUTARI da toplanır — yalnız KDV'si toplanınca sağlama yanlış alarm veriyordu.
      if (c && c.net !== null && c.brut !== null) { net += c.net; brut += c.brut; } else eksik++;
      if (bilinenSayi(k.sth_vergi)) kdv += Math.abs(Number(k.sth_vergi)); else eksik++;
      masraf += satirMasrafi(k);
    }
    const toplam = Math.abs(Number(fatura.tutar));
    const kalemToplami = net + masraf + kdv, fark = kalemToplami - toplam;
    // Pay: kuruş yuvarlamaları satır sayısıyla birikir; on binde 5 (200 bin ₺'lik faturada 100 ₺) — %0,5 çok gevşekti.
    return { net, kdv, masraf, iskonto: brut - net, kalemToplami, fark, tutuyor: eksik === 0 && Math.abs(fark) <= Math.max(1, toplam * 0.0005), eksik };
  }, [kalemler, cozumler, fatura.tutar]);

  const indir = async (tur: 'xml' | 'pdf') => {
    if (indiriliyor) return;
    setIndiriliyor(tur);
    setHata(null);
    // İndirme mantığı ortak serviste (EBelgeMerkezi de aynısını kullanır).
    setHata(await eBelgeIndir({
      tur,
      uuid: fatura.uuid,
      // Başlıksız kayıt (hareketFaturasi) `id`si Mikro GUID'i DEĞİL ('hareket|gelen||410') — sunucuya gönderilmez
      // (inceleme 2026-09-25: her denemede 400). Düğme zaten kapalı; bu ikinci çit.
      faturaGuid: fatura.baslikYok ? undefined : fatura.id,
      belgeTuru: 'e-fatura',
      yon: fatura.yon,
      dosyaAdi: fatura.faturaNo || fatura.id,
    }, tr));
    setIndiriliyor(null);
  };

  const satir = (etiket: string, deger: string) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500">{etiket}</span>
      <span className="text-sm font-semibold text-[#1D1D1F]">{deger}</span>
    </div>
  );

  return (
    // z-[60]: bu modal çoğu yerde BAŞKA bir z-50 modalın içinden açılır (Fiyat Karşılaştırma → İşlem Detayı → evrak,
    // cari ekstre, ürün detayı). Aynı z-50'de DOM sırası kazanıyordu ve fatura, onu açan İşlem Detayı'nın ALTINDA
    // kalıyordu (2026-09-18 kullanıcı bildirimi). Bildirim/toast katmanları z-[100]+ — onların altında kalır.
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      {/* Kalem tablosu eklendiği için genişletildi; uzun faturada gövde kaydırılır. */}
      {/* max-w-2xl (eski: max-w-lg): kalem tablosu 8 sütun oldu (Net Birim eklendi) — 512px'te ürün adı 3-4 satıra kırılıyordu. */}
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-[#1D1D1F]">
              {tr ? 'Fatura Detayı' : 'Invoice Detail'}
              <span className={`ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full align-middle ${fatura.yon === 'gelen' ? 'bg-purple-100 text-purple-600' : 'bg-teal-100 text-teal-700'}`}>
                {fatura.yon === 'gelen' ? (oc(tr).gelen) : (oc(tr).giden)}
              </span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5 font-mono">{fatura.faturaNo || '—'}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 min-h-0">
          {satir(tr ? 'Müşteri / Cari' : 'Customer', fatura.musteri)}
          {satir(tr ? 'Cari kodu' : 'Account code', fatura.cariKod || '—')}
          {satir(oc(tr).tarih, fatura.tarih || '—')}
          {/* `typeof === 'number'` NaN'ı SAYI SANIYORDU: hook grubu (2026-09-18) okunamayan
              tutar/kdv/matrahı NaN yaptığından bu kontrol "biliniyor" deyip `tl(NaN)`e giriyordu.
              `bilinenSayi` NaN'ı da eler — bilinmeyen alan '—' basar (oranı da yazılmaz). */}
          {satir(tr ? 'Matrah' : 'Base', bilinenSayi(fatura.matrah) ? tl(fatura.matrah) : '—')}
          {satir(oc(tr).kdv, bilinenSayi(fatura.kdv) ? `${tl(fatura.kdv)}${fatura.oranKarma ? (tr ? ' (Karma oran)' : ' (Mixed rate)') : (fatura.oran !== null ? ` (%${fatura.oran})` : '')}` : '—')}
          {fatura.oranKarma && oranKirilim && oranKirilim.length > 1 && (
            <div className="bg-amber-50 rounded-xl px-3 py-2 my-2 space-y-1">
              <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">{tr ? 'KDV Kırılımı' : 'VAT Breakdown'}</p>
              {oranKirilim.map(r => (
                <div key={String(r.oran)} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">{r.oran === null ? (oc(tr).bilinmiyor) : `%${r.oran}`}</span>
                  <span className="font-semibold text-[#1D1D1F]">{tl(r.kdv)} <span className="text-gray-400 font-normal">({tr ? 'matrah' : 'base'} {tl(r.matrah)})</span></span>
                </div>
              ))}
            </div>
          )}
          {satir(oc(tr).toplam, bilinenSayi(fatura.tutar) ? tl(fatura.tutar) : '—')}
          {fatura.baslikYok && (
            <p className="text-[11px] text-amber-600 mt-1">
              {tr
                ? 'Fatura başlığı Cetpa\'da yok ("Faturaları Çek" bu tarihi kapsamamış olabilir) — toplam/KDV bilinmiyor; kalemler doğrudan Mikro\'dan.'
                : 'Invoice header not in Cetpa (the invoice pull may not cover this date) — totals/VAT unknown; lines are read directly from Mikro.'}
            </p>
          )}

          {/* ── Fatura kalemleri ── */}
          <div className="mt-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Package size={13} className="text-gray-400" />
              <span className="text-xs font-bold text-gray-600">
                {oc(tr).kalemler}
                {kalemler?.length ? <span className="text-gray-400 font-normal"> · {kalemler.length}</span> : null}
              </span>
            </div>

            {kalemDurum === 'yukleniyor' && (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                <Loader2 size={13} className="animate-spin" />{tr ? 'Kalemler yükleniyor…' : 'Loading lines…'}
              </div>
            )}

            {kalemDurum === 'hata' && (
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2">
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />{kalemHata}
              </div>
            )}

            {kalemDurum === 'hazir' && kalemler?.length === 0 && (
              <p className="text-xs text-gray-400 py-2">
                {tr
                  ? 'Bu faturanın stok satırı yok — hizmet/masraf faturası olabilir.'
                  : 'No stock lines — may be a service/expense invoice.'}
              </p>
            )}

            {kalemDurum === 'hazir' && !!kalemler?.length && (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-100">
                      <th className="text-left font-semibold py-1.5 px-1">{oc(tr).urun}</th>
                      <th className="text-right font-semibold py-1.5 px-1">{oc(tr).miktar}</th>
                      <th className="text-left font-semibold py-1.5 px-1">{oc(tr).birim}</th>
                      <th className="text-right font-semibold py-1.5 px-1">{oc(tr).brut}</th>
                      <th className="text-right font-semibold py-1.5 px-1">{tr ? 'İskonto' : 'Discount'}</th>
                      <th className="text-right font-semibold py-1.5 px-1">{tr ? 'Net' : 'Net'}</th>
                      <th className="text-right font-semibold py-1.5 px-1 whitespace-nowrap">{tr ? 'Net Birim' : 'Net Unit'}</th>
                      <th className="text-right font-semibold py-1.5 px-1">{oc(tr).kdv}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kalemler.map((k, i) => {
                      const n = cozumler[i];
                      const sku    = String(k.sth_stok_kod ?? '');
                      const ad     = String(k.urunAdi ?? '') || sku || '—';
                      // Bilinmeyen sayı ₺0 basılmaz ('—'); net/iskonto lib/stokFiyat.satirNet (KDV ile sağlanır).
                      const miktar = bilinenSayi(k.sth_miktar) ? Number(k.sth_miktar) : null;
                      const kdv = bilinenSayi(k.sth_vergi) ? Number(k.sth_vergi) : null;
                      const fa = n?.kaynak === 'faturaAltiKdvden' || n?.kaynak === 'faturaAltiBasliktan';
                      // Birim = MİKTARIN birimi (ana birim) — Mikro miktarı ana birime çevirip saklar (canlı ölçüm 2026-09-19,
                      // bkz. server/mikro/eslemeFatura.kalemleriBirimle). Satır başka birimle GİRİLDİYSE sunucu `girisBirimi`
                      // yollar; o yalnız bilgi notudur — Miktar ve Net Birim ana birim üzerindendir.
                      const girisBirimi = typeof k.girisBirimi === 'string' && k.girisBirimi ? k.girisBirimi : null;
                      return (
                        <tr key={`${sku}-${i}`} className="border-b border-gray-50 last:border-0">
                          <td className="py-1.5 px-1 text-[#1D1D1F]">
                            <span className="font-medium">{ad}</span>
                            {sku && ad !== sku && <span className="block text-[10px] text-gray-400 font-mono">{sku}</span>}
                          </td>
                          <td className="py-1.5 px-1 text-right tabular-nums text-gray-600">
                            {miktar === null ? '—' : miktar.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}
                          </td>
                          {/* Birim sunucuda sto_birimX_ad'dan çözülür (2026-08-31);
                              şemada yoksa '—' — uydurma 'ADET' yazılmaz. */}
                          <td className="py-1.5 px-1 text-left text-gray-500">
                            {String(k.birim ?? '') || '—'}
                            {girisBirimi && (
                              <span className="block text-[10px] text-gray-400 whitespace-nowrap"
                                title={tr ? `Faturada ${girisBirimi} ile girilmiş; Mikro miktarı ana birime çevirip saklar — Miktar ve Net Birim ana birim üzerindendir.` : `Entered in ${girisBirimi}; Mikro stores quantity in the base unit — Quantity and Net Unit are per base unit.`}>
                                {tr ? `${girisBirimi} ile girilmiş` : `entered in ${girisBirimi}`}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-1 text-right tabular-nums text-gray-400">{n?.brut != null ? tl(n.brut) : '—'}</td>
                          <td className={`py-1.5 px-1 text-right tabular-nums ${n?.iskonto ? 'text-amber-700' : 'text-gray-300'}`}
                            title={fa ? (tr ? 'Fatura altı iskonto — satırda yazılı değil; fatura toplamından / satırın KDV\'sinden türetildi' : 'Invoice-level discount — not on the line; derived from the invoice total / line VAT') : undefined}>
                            {n?.iskonto != null ? (n.iskonto > 0 ? `−${tl(n.iskonto)}` : tl(0)) : '—'}
                          </td>
                          <td className="py-1.5 px-1 text-right tabular-nums font-semibold text-[#1D1D1F]">{n?.net != null ? tl(n.net) : '—'}</td>
                          {/* Net birim fiyat = iskonto düşülmüş net ÷ miktar (lib/stokFiyat.kalemleriCoz — KDV HARİÇ). Miktarı 0/bilinmeyen
                              satırda (fiyat farkı) '—'. 2 ondalık net tutarı geri üretmiyorsa 4 ondalık basılır (birimFiyatOndaligi). */}
                          <td className="py-1.5 px-1 text-right tabular-nums text-[#1D1D1F] whitespace-nowrap"
                            title={tr ? 'İskonto düşülmüş net tutar ÷ miktar (KDV hariç) — Birim sütunundaki birim başına' : 'Net amount after discount ÷ quantity (excl. VAT) — per the unit shown'}>
                            {n?.birimFiyat != null ? paraYaz(n.birimFiyat, { ondalik: birimFiyatOndaligi(n.birimFiyat, n.miktar, n.net) }) : '—'}
                          </td>
                          <td className="py-1.5 px-1 text-right tabular-nums text-gray-500">{kdv === null ? '—' : tl(kdv)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {saglama && (
                  <p className={`mt-2 text-[11px] rounded-lg px-2.5 py-1.5 ${saglama.tutuyor ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50 border border-amber-200'}`}>
                    {saglama.tutuyor
                      ? (tr ? `✓ Sağlama: kalem neti ${tl(saglama.net)}${saglama.masraf > 0 ? ` + masraf ${tl(saglama.masraf)}` : ''} + KDV ${tl(saglama.kdv)} = fatura toplamı ${tl(saglama.kalemToplami)}${saglama.iskonto > 0 ? ` (iskonto −${tl(saglama.iskonto)} düşülmüş)` : ''}` : `✓ Check: line net ${tl(saglama.net)}${saglama.masraf > 0 ? ` + charges ${tl(saglama.masraf)}` : ''} + VAT ${tl(saglama.kdv)} = invoice total ${tl(saglama.kalemToplami)}${saglama.iskonto > 0 ? ` (discount −${tl(saglama.iskonto)} deducted)` : ''}`)
                      : (tr ? `Sağlama TUTMUYOR: kalem neti + KDV = ${tl(saglama.kalemToplami)}, fatura toplamı ${tl(Math.abs(Number(fatura.tutar)))} (fark ${tl(saglama.fark)})${saglama.eksik > 0 ? ` · ${saglama.eksik} alan okunamadı` : ''} — iskonto/masraf dağılımı bu faturada doğrulanamadı.` : `Check FAILED: line net + VAT = ${tl(saglama.kalemToplami)}, invoice total ${tl(Math.abs(Number(fatura.tutar)))} (diff ${tl(saglama.fark)})${saglama.eksik > 0 ? ` · ${saglama.eksik} unreadable fields` : ''} — discount/charge allocation could not be verified for this invoice.`)}
                  </p>
                )}
              </div>
            )}
          </div>

          {hata && (
            <div className="mt-3 flex items-start gap-2 text-xs text-red-700 bg-red-50 rounded-xl px-3 py-2">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />{hata}
            </div>
          )}

          {!fatura.uuid && !fatura.baslikYok && (
            <div className="mt-3 text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2">
              {tr
                ? 'Bu faturanın GİB belge kimliği (UUID) yok — e-belge olarak gönderilmemiş olabilir. XML çekilemez; PDF Mikro belge numarasıyla denenir.'
                : 'No GİB document id (UUID) — may not have been sent as an e-document. XML unavailable; PDF is attempted by document id.'}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="apple-button-secondary px-4 py-2 text-sm">{oc(tr).kapat}</button>
          <button
            onClick={() => void indir('pdf')}
            disabled={!!indiriliyor || (fatura.baslikYok === true && !fatura.uuid)}
            title={fatura.baslikYok && !fatura.uuid ? (tr ? "Fatura başlığı Cetpa'da yok — belge kimliği bilinmiyor, PDF çekilemez (önce \"Faturaları Çek\")" : 'Invoice header not in Cetpa — document id unknown, PDF unavailable') : undefined}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {indiriliyor === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            PDF
          </button>
          <button
            onClick={() => void indir('xml')}
            disabled={!!indiriliyor || !fatura.uuid}
            title={!fatura.uuid ? (tr ? 'UUID yok — XML çekilemez' : 'No UUID') : (tr ? 'XML — belgenin yasal aslı' : 'XML — legal original')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {indiriliyor === 'xml' ? <Loader2 size={14} className="animate-spin" /> : <FileCode size={14} />}
            XML
          </button>
        </div>
      </div>
    </div>
  );
}

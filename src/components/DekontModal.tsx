/**
 * DekontModal.tsx — Cari hareket (dekont/masraf) giriş ekranı.
 *
 * 2026-07-30'da eklendi. Öncesinde müşteri satırındaki "Mikro" düğmesi HİÇBİR
 * ŞEY SORMADAN, müşterinin TÜM bakiyesi kadar dekontu "<ad> bakiye dekontu"
 * açıklamasıyla Mikro'ya atıyordu. Onay yok, tutar girişi yok, tarih yok, tür
 * yok; iki kez basılırsa iki kayıt oluşuyordu. Bu bir muhasebe belgesi — tek
 * tıkla gitmemeli.
 *
 * Evrak türü listesi SABİT DEĞİL: /api/mikro/cari-hareket/turler firmanın
 * CARI_HESAP_HAREKETLERI'nde gerçekten kullandığı türleri döndürür. Eski kodda
 * `cha_evrak_tip: 29` gömülüydü ve yorumunda "deneysel" yazıyordu.
 */
import { useEffect, useState } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { pushMikroEvrak, dekontPayload } from '../services/mikroEvrak';
import { authFetch } from '../services/authFetch';

interface HareketTuru {
  cha_evrak_tip: number;
  cha_cinsi?: number;
  cha_tip?: number;
  adet: number;
  ornekSeri?: string | null;
}

interface Props {
  cariKod: string;
  cariAdi: string;
  /** Uygulamadaki mevcut bakiye. EKSİ = Cetpa borçlu. */
  mevcutBakiye: number;
  entityId?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const tl = (n: number) =>
  `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DekontModal({ cariKod, cariAdi, mevcutBakiye, entityId, onClose, onSuccess }: Props) {
  const [turler, setTurler]   = useState<HareketTuru[]>([]);
  const [turYukleniyor, setTurYukleniyor] = useState(true);
  const [turHata, setTurHata] = useState<string | null>(null);

  const [evrakTip, setEvrakTip] = useState<string>('');
  const [yon, setYon]           = useState<'borc' | 'alacak'>('borc');
  const [tutar, setTutar]       = useState('');
  const [tarih, setTarih]       = useState(new Date().toISOString().slice(0, 10));
  const [aciklama, setAciklama] = useState('');

  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [sonuc, setSonuc] = useState<{ ok: boolean; msg: string } | null>(null);

  // Firmanın gerçekten kullandığı türleri çek — sabit liste gömme.
  useEffect(() => {
    let iptal = false;
    (async () => {
      try {
        const r = await authFetch('/api/mikro/cari-hareket/turler');
        const d = await r.json() as { success?: boolean; turler?: HareketTuru[]; error?: string };
        if (iptal) return;
        if (!r.ok || !d.success) { setTurHata(d.error || 'Türler alınamadı.'); return; }
        const list = (d.turler ?? []).filter(x => x.cha_evrak_tip != null);
        setTurler(list);
        if (list.length) setEvrakTip(String(list[0].cha_evrak_tip));
      } catch {
        if (!iptal) setTurHata('Türler alınamadı — sunucuya ulaşılamadı.');
      } finally {
        if (!iptal) setTurYukleniyor(false);
      }
    })();
    return () => { iptal = true; };
  }, []);

  const tutarSayi = Number(String(tutar).replace(',', '.'));
  const gecerli = cariKod && Number.isFinite(tutarSayi) && tutarSayi > 0 && !!evrakTip && !!tarih;
  // Borç cariyi artırır, alacak azaltır (bakiye = borç − alacak).
  const yeniBakiye = mevcutBakiye + (yon === 'borc' ? tutarSayi : -tutarSayi);

  const gonder = async () => {
    if (!gecerli || gonderiliyor) return;
    setGonderiliyor(true);
    setSonuc(null);
    try {
      const secili = turler.find(x => String(x.cha_evrak_tip) === evrakTip);
      const r = await pushMikroEvrak('DekontKaydetV2', dekontPayload({
        cariKod,
        tutar: tutarSayi,
        tip: yon,
        date: tarih,
        aciklama: aciklama.trim() || undefined,
        evrakTip: Number(evrakTip),
        seri: secili?.ornekSeri || undefined,
      }), { entityType: 'cariDekont', entityId });

      if (r.notConfigured) { setSonuc({ ok: false, msg: 'Mikro yapılandırılmamış.' }); return; }
      if (!r.success)      { setSonuc({ ok: false, msg: r.error || 'Mikro kaydı başarısız.' }); return; }
      setSonuc({ ok: true, msg: 'Dekont Mikro’ya kaydedildi.' });
      onSuccess?.();
    } catch (e) {
      setSonuc({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>

        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-[#1D1D1F]">Dekont / Masraf Girişi</h3>
            <p className="text-xs text-gray-500 mt-0.5">{cariAdi}</p>
            <p className="text-[11px] text-gray-400 font-mono mt-0.5">Cari kod: {cariKod}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Mevcut bakiye — kullanıcı ne üzerine yazdığını görsün */}
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-xl text-xs">
            <span className="text-gray-500">Mevcut bakiye</span>
            <span className={`font-bold ${mevcutBakiye < 0 ? 'text-green-600' : mevcutBakiye > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {tl(mevcutBakiye)} {mevcutBakiye < 0 && <span className="font-normal text-gray-400">(Cetpa borçlu)</span>}
            </span>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Evrak türü</label>
            {turYukleniyor ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-2"><Loader2 size={13} className="animate-spin" /> Türler okunuyor…</div>
            ) : turHata ? (
              <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> {turHata}
              </div>
            ) : turler.length === 0 ? (
              <div className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
                Mikro’da hiç cari hareket bulunamadı; tür listesi çıkarılamadı.
              </div>
            ) : (
              <select value={evrakTip} onChange={e => setEvrakTip(e.target.value)} className="apple-input w-full text-sm">
                {turler.map(x => (
                  <option key={`${x.cha_evrak_tip}-${x.cha_cinsi}-${x.cha_tip}`} value={x.cha_evrak_tip}>
                    Tip {x.cha_evrak_tip}{x.ornekSeri ? ` · seri ${x.ornekSeri}` : ''} — {x.adet} kayıt
                  </option>
                ))}
              </select>
            )}
            <p className="text-[10px] text-gray-400 mt-1">Liste, Mikro’da gerçekten kullandığınız türlerden üretildi.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Yön</label>
              <select value={yon} onChange={e => setYon(e.target.value as 'borc' | 'alacak')} className="apple-input w-full text-sm">
                <option value="borc">Borç (cariyi artırır)</option>
                <option value="alacak">Alacak (cariyi azaltır)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Tarih</label>
              <input type="date" value={tarih} onChange={e => setTarih(e.target.value)} className="apple-input w-full text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Tutar (₺)</label>
            <input inputMode="decimal" value={tutar} onChange={e => setTutar(e.target.value)}
              placeholder="0,00" className="apple-input w-full text-sm" />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Açıklama</label>
            <input value={aciklama} onChange={e => setAciklama(e.target.value)} maxLength={120}
              placeholder="ör. Nakliye masrafı" className="apple-input w-full text-sm" />
          </div>

          {gecerli && (
            <div className="px-3 py-2 bg-blue-50 rounded-xl text-xs text-blue-800">
              Kayıt sonrası bakiye: <span className="font-bold">{tl(yeniBakiye)}</span>
            </div>
          )}

          {sonuc && (
            <div className={`px-3 py-2 rounded-xl text-xs font-medium ${sonuc.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {sonuc.msg}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100">
          <button onClick={onClose} className="apple-button-secondary px-4 py-2 text-sm">
            {sonuc?.ok ? 'Kapat' : 'Vazgeç'}
          </button>
          {!sonuc?.ok && (
            <button onClick={gonder} disabled={!gecerli || gonderiliyor}
              className="apple-button-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2">
              {gonderiliyor && <Loader2 size={14} className="animate-spin" />}
              {gonderiliyor ? 'Kaydediliyor…' : 'Mikro’ya Kaydet'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

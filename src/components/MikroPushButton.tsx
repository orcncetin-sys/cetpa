/**
 * MikroPushButton.tsx — herhangi bir modülden Mikro'ya evrak gönderme butonu.
 *
 * Kullanım:
 *   <MikroPushButton
 *     label="Mikro'ya Gönder"
 *     method="VerilenTeklifKaydetV2"
 *     buildPayload={() => teklifPayload({...})}
 *     entityType="quotation" entityId={q.id}
 *     onSuccess={() => ...}
 *   />
 *
 * Sonuç butonun yanında gösterilir; tüm denemeler sunucuda syncLog +
 * auditLog'a düşer.
 *
 * ROL KAPISI (karar turu 2026-10-11 — İ3 «ölü düğme yok», İ4 «tek kaynak», H7):
 * `evrak/kaydet` yönteme göre rol kapılıdır. Düğme rolü küresel depodan okur ve yöntemin kapısından GEÇEMEYEN rolde
 * kendini HİÇ ÇİZMEZ (tıklanıp 403 dönen düğme kalmaz). Soru, sunucu kapısının okuduğu AYNI tablodan sorulur
 * (`lib/mikroEvrakKapilari.ts` `evrakKapisindanGecer`); burada rol adı da koleksiyon adı da yazılmaz. Karar TEK yerde
 * olduğu için çağıranlar rol niteliği geçirmez — yeni çağıran da unutamaz.
 *
 * Rol kaynağı olarak deponun BİLİNEN SINIRLARI (şartname § 10, kapı dökümü istemci 12):
 *  - Yüklenmemiş rol: profil gelene kadar depodaki değer deponun varsayılan rolüdür (yönetici DEĞİL — testi var);
 *    uygulama gövdesi oturum hazır olmadan çizilmez. Profil senkronu düşerse rol bayat kalabilir — o zaman son söz
 *    sunucudadır: 403 metni düğmenin yanında GÖRÜNÜR (sessiz kalmaz).
 *  - Rolsüz / tanınmayan rol değeri: kapıdan geçemez, düğme çizilmez (kapalı başarısızlık).
 *  - Sahip hesabı: sunucu süper yöneticiyi rolüne bakmadan geçirir, istemci ROLE bakar. Sahip hesabının kaydındaki rol
 *    Yönetici değilse düğme gizlenir — gizli düğme, ölü düğme değil; bilerek kabul edildi.
 *  - Ayarlar'daki «Rol Simülatörü» depoyu DEĞİŞTİRMEZ (yalnız App'in yerel durumunu): simülasyonda bu düğme GERÇEK
 *    role göre çizilir. Sunucu da gerçek role baktığı için tıklanan düğme çalışır (ölü düğme oluşmaz).
 */

import React, { useState } from 'react';
import { pushMikroEvrak } from '../services/mikroEvrak';
import { evrakKapisindanGecer } from '../lib/mikroEvrakKapilari';
import { useAppStore } from '../store/appStore';

interface Props {
  label?: string;
  method: string;
  buildPayload: () => Record<string, unknown> | null; // null → doğrulama hatası (buton kendi mesajını basar)
  entityType?: string;
  entityId?: string;
  onSuccess?: () => void;
  className?: string;
  compact?: boolean;
}

const MikroPushButton: React.FC<Props> = ({
  label = "Mikro'ya Gönder", method, buildPayload, entityType, entityId, onSuccess, className, compact,
}) => {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  // İ4: rol depodan (seçici — rol değişince düğme yeniden değerlendirilir). Karar aşağıda, kancalardan SONRA.
  const rol = useAppStore(s => s.userRole);

  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // buildPayload TRY İÇİNDE (Faz 1, 2026-09-04): payload üreticileri artık
    // eksik veride throw ediyor (ör. teklifPayload — fiyatsız satır Mikro'ya
    // 0 TL ile gitmesin diye). Eskiden bu çağrı try dışındaydı; throw
    // yakalanmaz, React hata sınırına düşer ve kullanıcı NEDEN gönderilmediğini
    // göremezdi. Şimdi mesaj (satır numarasıyla) butonun yanında görünür.
    setState('busy'); setMsg(null);
    try {
      const payload = buildPayload();
      if (!payload) { setState('err'); setMsg('Eksik veri — gönderilemedi'); return; }
      const r = await pushMikroEvrak(method, payload, { entityType, entityId });
      if (r.notConfigured) { setState('err'); setMsg('Mikro yapılandırılmamış'); return; }
      if (r.success) { setState('ok'); setMsg('Mikro’ya kaydedildi ✓'); onSuccess?.(); }
      else { setState('err'); setMsg((r.error || 'Hata').slice(0, 90)); }
    } catch (err) {
      setState('err'); setMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // İ3 — rolün yöntem kapısından geçemeyeceği düğme ÇİZİLMEZ (erken dönüş BÜTÜN kancalardan sonra: kanca sırası bozulmaz).
  if (!evrakKapisindanGecer(rol, method)) return null;

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={run}
        disabled={state === 'busy'}
        title={`Mikro: ${method}`}
        className={className ?? `inline-flex items-center gap-1 rounded-full font-semibold transition-colors disabled:opacity-50 ${
          compact ? 'text-[10px] px-2 py-0.5' : 'text-xs px-3 py-1.5'
        } ${state === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-[#1a3a5c]/10 text-[#1a3a5c] hover:bg-[#1a3a5c]/20'}`}
      >
        {state === 'busy' ? '⏳' : state === 'ok' ? '✓' : '⇪'} {compact ? (label !== "Mikro'ya Gönder" ? label : 'Mikro') : label}
      </button>
      {msg && (
        <span className={`text-[10px] ${state === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>{msg}</span>
      )}
    </span>
  );
};

export default MikroPushButton;

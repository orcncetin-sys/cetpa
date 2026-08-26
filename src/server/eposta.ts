/**
 * eposta.ts — Giden e-posta yapılandırmasının TEK KAYNAĞI.
 *
 * NEDEN VAR (2026-08-25 denetimi, iki ayrı bulgu):
 *
 * 1) GÖNDERİCİ ÜÇE BÖLÜNMÜŞTÜ. `RESEND_FROM` tanımsızken aynı uygulama üç
 *    ayrı adresten gönderiyordu:
 *      server.ts (sipariş/genel) → 'Cetpa <onboarding@resend.dev>'  (sandbox)
 *      server.ts (davet)         → 'davet@cetpa.com.tr'
 *      crons.ts + opsWatchdog.ts → 'rapor@cetpa.com.tr'
 *    Alan adı Resend'de DOĞRULANMADIĞI için son ikisi REDDEDİLİYOR, ilki ise
 *    yalnız hesap sahibine ulaşıyor. Sonuç: "bazı postalar gidiyor, bazıları
 *    gitmiyor" — teşhisi zor bir yarı-arıza. Tek varsayılan olarak SANDBOX
 *    seçildi: bugün fiilen ÇALIŞAN tek adres o. Alan adı doğrulanınca tek bir
 *    `RESEND_FROM` ile dördü birden geçer.
 *
 * 2) UYARI HATTININ KENDİSİ İZLENMİYORDU. Operasyon Bekçisi'nin 14 kontrolü
 *    arasında e-posta kontrolü yoktu: bekçi bir arıza bulup postayı
 *    gönderemezse sonuç yalnızca `console.warn` — kimse görmez. Yani
 *    "izlemem var" sanılan yerde izleme yoktu. `resendSagligi()` bunu
 *    ölçülebilir hale getirir; hem bekçi hem /api/health kullanır.
 *
 * server.ts'i import ETMEZ (yaprak modül) — döngü riski yok.
 */

/** Resend'in sandbox göndericisi: doğrulanmış alan adı gerektirmez, ama
 *  YALNIZ Resend hesabının sahibine ulaşır. */
export const RESEND_SANDBOX_GONDERICI = 'CETPA <onboarding@resend.dev>';

/** Tüm giden postaların göndericisi. Alan adı doğrulanınca `.env`'de
 *  `RESEND_FROM=CETPA Ops <iletisim@cetpa.com.tr>` yazmak yeterli. */
export function resendGonderici(): string {
  return process.env.RESEND_FROM || RESEND_SANDBOX_GONDERICI;
}

/** Göndericinin alan adı ('CETPA <a@b.com>' → 'b.com'). */
export function resendAlanAdi(): string {
  return (resendGonderici().match(/@([^\s>]+)/)?.[1] || '').toLowerCase();
}

export interface ResendDurum {
  ok: boolean;
  /** İnsan-okunur teşhis; bekçi detayında ve panelde gösterilir. */
  detay: string;
  /** Sandbox göndericiyle çalışıyoruz: yalnız hesap sahibine ulaşır. */
  sandbox: boolean;
}

// /api/health 10 dakikada bir yoklanıyor (uptime.yml) — her yoklamada Resend'e
// gitmek hem yavaş hem gereksiz. Bir saat önbellek yeterli: bu bir yapılandırma
// durumu, dakikalık değişen bir şey değil.
let _onbellek: { d: ResendDurum; exp: number } | null = null;
const ONBELLEK_MS = 60 * 60 * 1000;

/**
 * Anahtarın GERÇEKTEN geçerli olduğunu ve göndericinin alan adının Resend'de
 * DOĞRULANMIŞ olduğunu sınar.
 *
 * Eski `/api/health` yalnız `!!process.env.RESEND_API_KEY` bakıyordu — yani
 * geçersiz anahtarla da "yeşil" görünüyordu. 2026-07-31'de tam bu yüzden
 * "e-posta çalışıyor" sanılırken hiç posta gitmiyordu.
 */
export async function resendSagligi(): Promise<ResendDurum> {
  if (_onbellek && _onbellek.exp > Date.now()) return _onbellek.d;

  const key = process.env.RESEND_API_KEY;
  const alan = resendAlanAdi();
  const sandbox = alan === 'resend.dev';

  const ver = (d: ResendDurum) => { _onbellek = { d, exp: Date.now() + ONBELLEK_MS }; return d; };

  if (!key) return ver({ ok: false, sandbox, detay: 'RESEND_API_KEY tanımlı değil — hiç posta gönderilemez' });

  try {
    const r = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 401 || r.status === 403) {
      return ver({ ok: false, sandbox, detay: `Resend anahtarı GEÇERSİZ (HTTP ${r.status}) — panel yeşil görünse de posta gitmiyor` });
    }
    if (!r.ok) return ver({ ok: false, sandbox, detay: `Resend /domains HTTP ${r.status}` });

    const j = await r.json() as { data?: Array<{ name?: string; status?: string }> };
    const alanlar = j?.data ?? [];

    if (sandbox) {
      // Anahtar geçerli ama sandbox göndericideyiz: Resend kuralı gereği posta
      // YALNIZ hesap sahibinin adresine ulaşır. Bu bir arıza değil, eksik
      // kurulum — ama "her şey yolunda" da değil, o yüzden ok:false.
      const dogrulanmis = alanlar.filter(a => a.status === 'verified').map(a => a.name).filter(Boolean);
      return ver({
        ok: false, sandbox: true,
        detay: 'anahtar geçerli ama SANDBOX gönderici kullanılıyor (onboarding@resend.dev) — '
          + 'posta yalnız Resend hesabının sahibine ulaşır. '
          + (dogrulanmis.length
            ? `Doğrulanmış alan adı var (${dogrulanmis.join(', ')}) → .env'de RESEND_FROM ayarla.`
            : 'Resend → Domains → cetpa.com.tr ekle + DKIM/SPF gir + Verify, sonra RESEND_FROM ayarla. '
              + 'DİKKAT: alan adında çalışan e-posta var, İKİNCİ bir SPF kaydı eklemek mevcut postaları bozar — '
              + "Resend'in include'unu MEVCUT SPF kaydının içine ekle."),
      });
    }

    const kayit = alanlar.find(a => (a.name || '').toLowerCase() === alan);
    if (!kayit) {
      return ver({ ok: false, sandbox, detay: `gönderici alan adı '${alan}' Resend'de KAYITLI DEĞİL — bu adresten gönderilen postalar reddedilir` });
    }
    if (kayit.status !== 'verified') {
      return ver({ ok: false, sandbox, detay: `gönderici alan adı '${alan}' Resend'de doğrulanmamış (durum: ${kayit.status}) — postalar reddedilir` });
    }
    return ver({ ok: true, sandbox, detay: `anahtar geçerli, gönderici alan adı '${alan}' doğrulanmış` });
  } catch (e) {
    // Ağ hatası kalıcı bir yapılandırma sorunu DEĞİL — önbelleğe yazma ki bir
    // sonraki yoklama tekrar denesin, ve son bilinen iyi durumu ezme.
    return { ok: false, sandbox, detay: 'Resend kontrol edilemedi: ' + (e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * Önbellekteki durumu ANINDA döndürür; yoksa `null` döner ve tazelemeyi ARKA
 * PLANA atar.
 *
 * NEDEN: `/api/health` 10 dakikada bir yoklanıyor (uptime.yml), ayrıca deploy
 * sağlık kapısı ve CI onu kullanıyor. Bu ucu bir DIŞ servise (Resend) bloke
 * etmek, Resend yavaşladığında bizim sağlık yoklamamızı düşürür — yani izleme
 * aracının kendisi arıza kaynağı olur. Sağlık ucu kendi bildiğini söyler,
 * bilmiyorsa "henüz bilinmiyor" der.
 */
export function resendSagligiOnbellekten(): ResendDurum | null {
  if (_onbellek && _onbellek.exp > Date.now()) return _onbellek.d;
  void resendSagligi().catch(() => { /* arka plan tazeleme; hata yut */ });
  return null;
}

/**
 * Giden e-posta HTML'ine gomulen KIRACI KAYNAKLI metni guvenli hale getirir.
 * server.ts'ten TASINDI (2026-08-26) — epostaRoutes de kullaniyor ve
 * server.ts'ten import DONGU olurdu.
 */
export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Basit e-posta bicim kontrolu. */
export function isValidEmail(e: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}

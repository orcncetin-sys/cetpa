/**
 * ArkaPlanIsiKarti.test.tsx — arka plan import kartı: düğme → başlat → `jobs/<isAdi>` ilerlemesi
 * (mikro-import-arkaplan istemci şartnamesi §B2, 2026-09-24). ÖNCE YAZILDI.
 *
 * Kart GERÇEKTEN çizilir; yalnız dbClient (jobs dokümanı) ve `baslat` sahtedir. Sahte kesinlik yasağı:
 * bilinmeyen sayaç `—` basılır, `0` UYDURULMAZ. Seçiciler ARIA rolüne dayanır (repoda data-testid yok):
 * kart `group`, çubuk `progressbar`, başlatma hatası `alert`, bilgi `status`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import ArkaPlanIsiKarti from './ArkaPlanIsiKarti';
import * as kanca from '../../hooks/useArkaPlanIsi';
import { yayinla, sifirla } from '../../hooks/useArkaPlanIsi.testDuzenegi';
import type { MikroIsBaslatmaYaniti } from '../../services/mikroService';

vi.mock('../../lib/dbClient', async () => (await import('../../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi);
// Yorumlayıcı GERÇEK gövdesiyle çalışır ama sarılır: kart onu ÇAĞIRIYOR mu (kendi tablosu yok) iddiası.
vi.mock('../../hooks/useArkaPlanIsi', async (orig) => {
  const m = await orig<typeof import('../../hooks/useArkaPlanIsi')>();
  return { ...m, baslatmaYanitiniYorumla: vi.fn(m.baslatmaYanitiniYorumla) };
});

const IS = 'mikroImport-stok';
const bekleMikro = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function ciz(baslat: () => Promise<MikroIsBaslatmaYaniti>, ek: Partial<React.ComponentProps<typeof ArkaPlanIsiKarti>> = {}) {
  return render(
    <ArkaPlanIsiKarti
      isAdi={IS} baslik="Stok İçeri Al" aciklama="Mikro stok kartları" dugmeMetni="Stokları İçeri Al"
      baslat={baslat} disabled={false} lang="tr" {...ek}
    />,
  );
}
const kart = () => screen.getByRole('group', { name: 'Stok İçeri Al' });
const dugme = () => screen.getByRole('button', { name: /Stokları İçeri Al/ });

beforeEach(() => { sifirla(); vi.mocked(kanca.baslatmaYanitiniYorumla).mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe('ArkaPlanIsiKarti — başlat → ilerleme', () => {
  it('düğmeye bas → baslat 1 kez; started:true → yayın {running:true,5/20} → progressbar aria-valuenow=25, metin 5/20', async () => {
    const baslat = vi.fn(() => Promise.resolve<MikroIsBaslatmaYaniti>({ success: true, started: true, job: IS }));
    ciz(baslat);
    await act(bekleMikro);
    fireEvent.click(dugme());
    await act(bekleMikro);
    expect(baslat).toHaveBeenCalledTimes(1);
    expect(kanca.baslatmaYanitiniYorumla).toHaveBeenCalledTimes(1);
    await act(async () => { yayinla(IS, { running: true, processed: 5, total: 20 }); });
    const cubuk = within(kart()).getByRole('progressbar');
    expect(cubuk).toHaveAttribute('aria-valuenow', '25');
    expect(kart().textContent).toContain('5/20');
    // Koşarken düğme metni değişir ('Çalışıyor…') — ada göre değil, kartın tek düğmesi olarak bulunur.
    // Düğme AÇIK kalır: kilit sunucuda (bkz. aşağıdaki "yetim running:true" vakası).
    const kosanDugme = within(kart()).getByRole('button');
    expect(kosanDugme).toBeEnabled();
    expect(kosanDugme.textContent).toMatch(/Çalışıyor/);
  });

  it('sayaçsız SQL işi {running:true}: progressbar VAR (belirsiz, aria-busy), aria-valuenow YOK, "—" basılır, "0" BASILMAZ', async () => {
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }));
    await act(async () => { yayinla(IS, { running: true }); });
    const cubuk = within(kart()).getByRole('progressbar');
    expect(cubuk).not.toHaveAttribute('aria-valuenow');
    expect(cubuk).toHaveAttribute('aria-busy', 'true');
    expect(kart().textContent).toContain('—/—');
    expect(kart().textContent).not.toMatch(/\b0\b/);
  });

  it('SQL yolu {running:true, sayfa:4, satir:2000, processed:2000} (total yok) → aria-valuenow YOK, "sayfa 4 · 2000 satır"', async () => {
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }));
    await act(async () => { yayinla(IS, { running: true, sayfa: 4, satir: 2000, processed: 2000 }); });
    expect(within(kart()).getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(kart().textContent).toContain('sayfa 4 · 2000 satır');
  });

  it('K-A: sonSayfaMs sonluysa "son sayfa N sn"; yoksa hiç basılmaz', async () => {
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }));
    await act(async () => { yayinla(IS, { running: true, processed: 1, sonSayfaMs: 4200 }); });
    expect(kart().textContent).toContain('son sayfa 4 sn');
    await act(async () => { yayinla(IS, { running: true, processed: 1 }); });
    expect(kart().textContent).not.toContain('son sayfa');
  });
});

// Hakem bulgusu (2026-09-25): düğme `jobs` dokümanının `running` alanına kilitliydi. Sunucu yarıda ölen işin
// running:true kaydını açılışta kapatmıyordu (`calisanlar` Map'i süreçle sıfırlanır, doküman kalır) → deploy/
// çökme sonrası kart sonsuza dek 'Çalışıyor…' ve düğme KAPALI kalıyordu. Artık açılış taraması kapatıyor
// (arkaPlanIsi.ts `yetimIsleriKapat`, delta bulgu 1/11) ama tarama düşebilir (PG erişilemez). Kilidin otoritesi
// SUNUCU: gerçekten koşan işte tıklama 'Zaten çalışıyor' bilgisi döner, yetim kayıtta iş temiz başlar.
// İstemci `running`i düğme kilidi olarak KULLANMAZ.
describe('ArkaPlanIsiKarti — running:true düğmeyi KİLİTLEMEZ (kilit sunucuda)', () => {
  it('yetim {running:true, finishedAt:null} (sunucu yeniden başladı) → düğme AÇIK; basınca baslat çağrılır, yeni koşu ilerler', async () => {
    yayinla(IS, { running: true, finishedAt: null, processed: 40, total: 2384 });
    const baslat = vi.fn(() => Promise.resolve<MikroIsBaslatmaYaniti>({ success: true, started: true, job: IS }));
    ciz(baslat);
    await act(bekleMikro);
    const kd = within(kart()).getByRole('button');
    expect(kd.textContent).toMatch(/Çalışıyor/);
    expect(kd).toBeEnabled();
    fireEvent.click(kd);
    await act(bekleMikro);
    expect(baslat).toHaveBeenCalledTimes(1);
    expect(within(kart()).queryByRole('alert')).toBeNull();
    await act(async () => { yayinla(IS, { running: true, finishedAt: null, processed: 5, total: 20 }); });
    expect(within(kart()).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  });

  it('gerçekten koşan iş: tıklama sunucudan alreadyRunning(job===isAdi) alır → alert YOK, "Zaten çalışıyor" bilgisi', async () => {
    yayinla(IS, { running: true, finishedAt: null });
    ciz(() => Promise.resolve({ success: true, started: false, alreadyRunning: true, job: IS }));
    await act(bekleMikro);
    fireEvent.click(within(kart()).getByRole('button'));
    await act(bekleMikro);
    expect(within(kart()).queryByRole('alert')).toBeNull();
    expect(within(kart()).getByRole('status').textContent).toContain('Zaten çalışıyor — ilerleme aşağıda.');
  });

  // İnceleme bulgusu 2026-09-25: not iş bittikten sonra da kalıyor, 'tamamlandı' satırıyla çelişiyordu.
  it('"Zaten çalışıyor" notu iş yeni bitiş damgasıyla durunca SİLİNİR; koşarken gelen ilerleme yayını silmez', async () => {
    yayinla(IS, { running: true, finishedAt: null });
    ciz(() => Promise.resolve({ success: true, started: false, alreadyRunning: true, job: IS }));
    await act(bekleMikro);
    fireEvent.click(within(kart()).getByRole('button'));
    await act(bekleMikro);
    expect(within(kart()).getByText('Zaten çalışıyor — ilerleme aşağıda.')).toBeInTheDocument();
    await act(async () => { yayinla(IS, { running: true, finishedAt: null, processed: 3, total: 9 }); });
    expect(within(kart()).getByText('Zaten çalışıyor — ilerleme aşağıda.')).toBeInTheDocument();
    await act(async () => { yayinla(IS, { running: false, finishedAt: { _seconds: 9, _nanoseconds: 0 }, processed: 9, total: 9 }); });
    expect(within(kart()).queryByText('Zaten çalışıyor — ilerleme aşağıda.')).toBeNull();
    // Üçüncü delta hakem: iş YENİDEN başlarsa (finishedAt null) eski tıklamanın notu geri GELMEZ.
    await act(async () => { yayinla(IS, { running: true, finishedAt: null, processed: 0, total: 9 }); });
    expect(within(kart()).queryByText('Zaten çalışıyor — ilerleme aşağıda.')).toBeNull();
  });

  // Delta hakem 2026-09-25 (PLAUSIBLE): SSE bitiş olayı HTTP yanıtından ÖNCE gelirse effect'e bağlı temizlik
  // bir daha tetiklenmiyor, not kalıcı kalıyordu. Artık tıklama anının damgasıyla türetiliyor.
  it('"Zaten çalışıyor" yanıtı bitiş yayınından SONRA gelirse not HİÇ görünmez', async () => {
    yayinla(IS, { running: true, finishedAt: null });
    let ver: (y: MikroIsBaslatmaYaniti) => void = () => {};
    ciz(() => new Promise<MikroIsBaslatmaYaniti>(r => { ver = r; }));
    await act(bekleMikro);
    fireEvent.click(within(kart()).getByRole('button'));
    await act(bekleMikro);
    await act(async () => { yayinla(IS, { running: false, finishedAt: { _seconds: 11, _nanoseconds: 0 }, processed: 4, total: 4 }); });
    await act(async () => { ver({ success: true, started: false, alreadyRunning: true, job: IS }); await bekleMikro(); });
    expect(within(kart()).queryByText('Zaten çalışıyor — ilerleme aşağıda.')).toBeNull();
  });

  // Delta hakem 2026-09-25 (ikinci tur, CONFIRMED): 'Başka bir iş çalışıyor: X' notu X bittikten sonra da
  // kalıyordu — kart yalnız kendi işine bakıyordu. Artık X'in kaydı izlenir.
  it('"Başka bir iş çalışıyor: X" notu X sürerken kalır, X durunca GİZLENİR', async () => {
    ciz(() => Promise.resolve({ success: true, started: false, alreadyRunning: true, job: 'mikroImport-baska' }));
    await act(bekleMikro);
    fireEvent.click(within(kart()).getByRole('button'));
    await act(bekleMikro);
    const metin = /Başka bir iş çalışıyor: mikroImport-baska/;
    expect(within(kart()).getByText(metin)).toBeInTheDocument();
    await act(async () => { yayinla('mikroImport-baska', { running: true, finishedAt: null }); });
    expect(within(kart()).getByText(metin)).toBeInTheDocument();
    await act(async () => { yayinla('mikroImport-baska', { running: false, finishedAt: { _seconds: 21, _nanoseconds: 0 } }); });
    expect(within(kart()).queryByText(metin)).toBeNull();
    // Üçüncü delta hakem: X YENİDEN başlarsa eski tıklamanın notu geri GELMEZ (gizleme kalıcı).
    await act(async () => { yayinla('mikroImport-baska', { running: true, finishedAt: null }); });
    expect(within(kart()).queryByText(metin)).toBeNull();
  });

  // Delta hakem 2026-09-25 (4. tur): sunucu kilidi X'in kaydını yazmadan ÖNCE alır → yeni abonelik X'in ÖNCEKİ
  // koşusunun bayat 'bitti' görüntüsünü alır. Bu görüntü notu KALICI silmemeli; X'in başlangıç kaydı gelince not döner.
  it('bayat ilk görüntü (X\'in önceki koşusu bitti) notu kalıcı SİLMEZ; running:true gelince not görünür, gerçek bitişte silinir', async () => {
    yayinla('mikroImport-baska', { running: false, finishedAt: { _seconds: 5, _nanoseconds: 0 } });   // önceki koşu, önbellekte
    ciz(() => Promise.resolve({ success: true, started: false, alreadyRunning: true, job: 'mikroImport-baska' }));
    await act(bekleMikro);
    fireEvent.click(within(kart()).getByRole('button'));
    await act(bekleMikro);
    const metin = /Başka bir iş çalışıyor: mikroImport-baska/;
    await act(async () => { yayinla('mikroImport-baska', { running: true, finishedAt: null }); });
    expect(within(kart()).getByText(metin)).toBeInTheDocument();
    await act(async () => { yayinla('mikroImport-baska', { running: false, finishedAt: { _seconds: 30, _nanoseconds: 0 } }); });
    expect(within(kart()).queryByText(metin)).toBeNull();
    await act(async () => { yayinla('mikroImport-baska', { running: true, finishedAt: null }); });
    expect(within(kart()).queryByText(metin)).toBeNull();
  });

  // Hakem (4. tur, test açığı): bayrak her yeni notta SIFIRLANMALI — yoksa önceki notun 'koşu görüldü' bayrağı ikinci
  // tıklamadaki bayat ilk görüntüde notu hemen kalıcı silerdi.
  it('aynı X için İKİNCİ tıklama: önceki notun "koşu görüldü" bayrağı taşınmaz; bayat görüntü notu silmez, running:true gelince görünür', async () => {
    ciz(() => Promise.resolve({ success: true, started: false, alreadyRunning: true, job: 'mikroImport-baska' }));
    await act(bekleMikro);
    const metin = /Başka bir iş çalışıyor: mikroImport-baska/;
    fireEvent.click(within(kart()).getByRole('button'));
    await act(bekleMikro);
    await act(async () => { yayinla('mikroImport-baska', { running: true, finishedAt: null }); });
    await act(async () => { yayinla('mikroImport-baska', { running: false, finishedAt: { _seconds: 30, _nanoseconds: 0 } }); });
    expect(within(kart()).queryByText(metin)).toBeNull();
    fireEvent.click(within(kart()).getByRole('button'));   // ikinci tıklama — önbellekte X'in bayat 'bitti' görüntüsü
    await act(bekleMikro);
    await act(async () => { yayinla('mikroImport-baska', { running: true, finishedAt: null }); });
    expect(within(kart()).getByText(metin)).toBeInTheDocument();
  });

  it('X yanıttan sonra ama ilk görüntüden önce bittiyse (bitiş damgası tıklamadan SONRA) not kalıcı silinir', async () => {
    let ver: (y: MikroIsBaslatmaYaniti) => void = () => {};
    ciz(() => new Promise<MikroIsBaslatmaYaniti>(r => { ver = r; }));
    await act(bekleMikro);
    fireEvent.click(within(kart()).getByRole('button'));
    await act(bekleMikro);
    yayinla('mikroImport-baska', { running: false, finishedAt: { _seconds: Math.floor(Date.now() / 1000) + 60, _nanoseconds: 0 } });
    await act(async () => { ver({ success: true, started: false, alreadyRunning: true, job: 'mikroImport-baska' }); await bekleMikro(); });
    const metin = /Başka bir iş çalışıyor: mikroImport-baska/;
    expect(within(kart()).queryByText(metin)).toBeNull();
    await act(async () => { yayinla('mikroImport-baska', { running: true, finishedAt: null }); });
    expect(within(kart()).queryByText(metin)).toBeNull();
  });

  it('istek sürerken (baslatiyor) düğme KAPALI — çift tıklama iki istek atmaz', async () => {
    let ver: (y: MikroIsBaslatmaYaniti) => void = () => {};
    const baslat = vi.fn(() => new Promise<MikroIsBaslatmaYaniti>(r => { ver = r; }));
    ciz(baslat);
    await act(bekleMikro);
    fireEvent.click(dugme());
    fireEvent.click(within(kart()).getByRole('button'));
    expect(baslat).toHaveBeenCalledTimes(1);
    expect(within(kart()).getByRole('button')).toBeDisabled();
    await act(async () => { ver({ success: true, started: true, job: IS }); await bekleMikro(); });
    expect(within(kart()).getByRole('button')).toBeEnabled();
  });
});

describe('ArkaPlanIsiKarti — başlatma hatası ≠ önceki koşu', () => {
  it('baslat → {success:false,error:"HTTP 502"} → alert "başlatılamadı: HTTP 502"; önceki tamamlanmış koşu varsa "ÖNCEKİ bir koşuya aittir" notu', async () => {
    yayinla(IS, { running: false, processed: 2384, total: 2384, finishedAt: { _seconds: 1, _nanoseconds: 0 } });
    ciz(() => Promise.resolve({ success: false, error: 'HTTP 502' }));
    await act(bekleMikro);
    fireEvent.click(dugme());
    await act(bekleMikro);
    expect(within(kart()).getByRole('alert').textContent).toMatch(/başlatılamadı: HTTP 502/);
    expect(kart().textContent).toMatch(/ÖNCEKİ bir koşuya aittir/);
    expect(kart().textContent).toContain('2384/2384');
    expect(dugme()).toBeEnabled();   // iş koşmuyor → yeniden denenebilir
  });

  it('notConfigured → alert "Mikro yapılandırılmamış."', async () => {
    ciz(() => Promise.resolve({ success: false, notConfigured: true }));
    await act(bekleMikro);
    fireEvent.click(dugme());
    await act(bekleMikro);
    expect(within(kart()).getByRole('alert').textContent).toContain('Mikro yapılandırılmamış.');
  });

  it('disabled → düğme kapalı + "Mikro bağlantısı gerekli" notu', async () => {
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }), { disabled: true });
    await act(bekleMikro);
    expect(dugme()).toBeDisabled();
    expect(kart().textContent).toContain('Mikro bağlantısı gerekli');
  });
});

describe('ArkaPlanIsiKarti — özet sayaçları (sunucu↔istemci alan adı sözleşmesi)', () => {
  it('bozukKayit:3 + zamanAsimiKayit:1 + zamanAsimiSayfa:2 → amber "3 bozuk kayıt atlandı" + amber "1 kayıt zaman aşımıyla ATLANDI" + "2 sayfa daraltıldı"', async () => {
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }));
    await act(async () => { yayinla(IS, { running: false, bozukKayit: 3, zamanAsimiKayit: 1, zamanAsimiSayfa: 2 }); });
    expect(kart().textContent).toContain('3 bozuk kayıt atlandı');
    expect(kart().textContent).toMatch(/1 kayıt zaman aşımıyla ATLANDI/);
    expect(kart().textContent).toContain('2 sayfa daraltıldı');
  });

  it('bozukKayit:0 → "bozuk" metni YOK (0 = sorun yok, basılmaz)', async () => {
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }));
    await act(async () => { yayinla(IS, { running: false, bozukKayit: 0, created: 10 }); });
    expect(kart().textContent).not.toContain('bozuk');
    expect(kart().textContent).toContain('10');
  });

  it('eski `skippedRecords:5` adı → tanınmaz, HİÇBİR sayaç basılmaz (5 görünmez)', async () => {
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }));
    await act(async () => { yayinla(IS, { running: false, skippedRecords: 5 }); });
    expect(kart().textContent).not.toMatch(/\b5\b/);
  });

  it('{running:false,error:"Mikro 30sn"} → "Son koşu hatası: Mikro 30sn"; truncated:true → "SAYFA TAVANINA ÇARPTI"; durationMs → "⏱ Ns"; note UYARI amber', async () => {
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }));
    await act(async () => { yayinla(IS, { running: false, error: 'Mikro 30sn', truncated: true, durationMs: 12_400, note: 'UYARI: hiçbir satırda okunamadı' }); });
    expect(kart().textContent).toContain('Son koşu hatası: Mikro 30sn');
    expect(kart().textContent).toContain('SAYFA TAVANINA ÇARPTI');
    expect(kart().textContent).toContain('⏱ 12s');
    expect(kart().textContent).toContain('UYARI: hiçbir satırda okunamadı');
    expect(kart().textContent).not.toContain('tamamlandı');   // hatalı koşu "tamamlandı" DEMEZ
  });

  it('ekOzet iş dokümanını alır ve çizilir (stok fiyat rehberi / miktar depo dağılımı bu yolla)', async () => {
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }), { ekOzet: is => <span>EK:{String(is.fiyatliUrun)}</span> });
    await act(async () => { yayinla(IS, { running: false, fiyatliUrun: 0 }); });
    expect(kart().textContent).toContain('EK:0');
  });
});

describe('ArkaPlanIsiKarti — §0 ÖNCELİK üç hâl (kart yorumlayıcıyı çağırır, kendi tablosu yok)', () => {
  it('(ii) alreadyRunning && job === isAdi → alert YOK, status "Zaten çalışıyor — ilerleme aşağıda."', async () => {
    ciz(() => Promise.resolve({ success: true, started: false, alreadyRunning: true, job: IS }));
    await act(bekleMikro);
    fireEvent.click(dugme());
    await act(bekleMikro);
    expect(within(kart()).queryByRole('alert')).toBeNull();
    expect(within(kart()).getByRole('status').textContent).toContain('Zaten çalışıyor — ilerleme aşağıda.');
  });

  it('(iii) alreadyRunning && job BAŞKA → alert YOK, status "Başka bir iş çalışıyor: mikroImport-cari", "İş adı uyuşmadı" YOK', async () => {
    ciz(() => Promise.resolve({ success: true, started: false, alreadyRunning: true, job: 'mikroImport-cari' }));
    await act(bekleMikro);
    fireEvent.click(dugme());
    await act(bekleMikro);
    expect(within(kart()).queryByRole('alert')).toBeNull();
    expect(within(kart()).getByRole('status').textContent).toContain('Başka bir iş çalışıyor: mikroImport-cari');
    expect(kart().textContent).not.toContain('İş adı uyuşmadı');
    expect(kanca.baslatmaYanitiniYorumla).toHaveBeenCalledTimes(1);
  });

  it('(i) started && job "baska" → alert "İş adı uyuşmadı: baska ≠ mikroImport-stok"; ikinci tıklama önceki bilgi/hata metnini siler', async () => {
    const yanitlar: MikroIsBaslatmaYaniti[] = [
      { success: true, started: true, job: 'baska' },
      { success: true, started: true, job: IS },
    ];
    let i = 0;
    ciz(() => Promise.resolve(yanitlar[i++]));
    await act(bekleMikro);
    fireEvent.click(dugme());
    await act(bekleMikro);
    expect(within(kart()).getByRole('alert').textContent).toContain('İş adı uyuşmadı: baska ≠ mikroImport-stok');
    fireEvent.click(dugme());
    await act(bekleMikro);
    expect(within(kart()).queryByRole('alert')).toBeNull();
    expect(within(kart()).queryByRole('status')).toBeNull();
  });
});

// Delta hakem 2026-09-25 (bulgu 12, CONFIRMED/küçük): sayaç satırı alanın o işe ait olup olmadığını bilmeden '—'
// basıyordu. Stok/cari rotaları `total` yazmaz (koşarken de bitince de), cari `satir` yazmaz → bitmiş stok kartı
// kalıcı olarak '2384/— işlendi · tamamlandı', cari kartı '… · sayfa 3 · — satır' diyordu. Proje kuralı: '—' =
// BİLİNMİYOR; uygulanmayan alan hiç basılmaz (istemci.md:65 "sonlu ise 'sayfa N · M satır'; yoksa basılmaz").
describe('ArkaPlanIsiKarti — sayaç satırı: bilinmeyen ≠ uygulanmayan', () => {
  it("bitmiş stok işi (total YOK) → '2384 işlendi · tamamlandı'; '2384/—' YOK", async () => {
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }));
    await act(async () => { yayinla(IS, { running: false, processed: 2384, created: 10, updated: 2374, finishedAt: { _seconds: 1, _nanoseconds: 0 } }); });
    expect(kart().textContent).toContain('2384 işlendi');
    expect(kart().textContent).not.toContain('2384/—');
    expect(kart().textContent).toContain('tamamlandı');
  });

  it("koşan stok işi (total henüz yok) → '100/—' (koşarken bilinmiyor — '—' DOĞRU)", async () => {
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }));
    await act(async () => { yayinla(IS, { running: true, processed: 100, offset: 100 }); });
    expect(kart().textContent).toContain('100/—');
  });

  it("cari (sayfa var, satir YOK) → 'sayfa 1'; '— satır' YOK", async () => {
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }));
    await act(async () => { yayinla(IS, { running: true, processed: 500, sayfa: 1 }); });
    expect(kart().textContent).toContain('sayfa 1');
    expect(kart().textContent).not.toContain('satır');
  });

  it("satir var, sayfa YOK → '2000 satır'; 'sayfa —' YOK", async () => {
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }));
    await act(async () => { yayinla(IS, { running: true, satir: 2000 }); });
    expect(kart().textContent).toContain('2000 satır');
    expect(kart().textContent).not.toContain('sayfa');
  });
});

// Delta hakem 2026-09-25 (bulgu 11, CONFIRMED/orta): kart `startedAt`i hiç okumuyordu — asılı ya da yetim iş
// ile uzun süren iş ayırt edilemiyordu (bayat kayıt yalnız düğmenin hover tooltip'indeydi; dokunmatikte yok).
describe('ArkaPlanIsiKarti — koşarken başlangıçtan geçen süre EKRANDA', () => {
  const T = Date.UTC(2026, 8, 25, 9, 0, 0);
  it("running + startedAt 12 dk önce → '12 dk önce başladı'; saat ilerleyince güncellenir; bitince basılmaz", async () => {
    vi.useFakeTimers({ now: T, toFake: ['Date', 'setInterval', 'clearInterval'] });
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }));
    const bas = { _seconds: T / 1000 - 12 * 60, _nanoseconds: 0 };
    await act(async () => { yayinla(IS, { running: true, startedAt: bas, processed: 1 }); });
    expect(kart().textContent).toContain('12 dk önce başladı');
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(kart().textContent).toContain('13 dk önce başladı');
    await act(async () => { yayinla(IS, { running: false, startedAt: bas, processed: 1, finishedAt: { _seconds: T / 1000, _nanoseconds: 0 } }); });
    expect(kart().textContent).not.toContain('önce başladı');
  });

  it("startedAt okunamıyorsa HİÇ basılmaz (süre uydurulmaz); EN: 'started N min ago'", async () => {
    vi.useFakeTimers({ now: T, toFake: ['Date', 'setInterval', 'clearInterval'] });
    ciz(() => Promise.resolve({ success: true, started: true, job: IS }));
    await act(async () => { yayinla(IS, { running: true, processed: 1 }); });
    expect(kart().textContent).not.toContain('başladı');
    sifirla();
    render(<ArkaPlanIsiKarti isAdi="mikroImport-cari" baslik="Customers" aciklama="x" dugmeMetni="Import" baslat={() => Promise.resolve({ success: true })} disabled={false} lang="en" />);
    await act(async () => { yayinla('mikroImport-cari', { running: true, startedAt: { _seconds: T / 1000 - 5 * 60, _nanoseconds: 0 } }); });
    expect(screen.getByRole('group', { name: 'Customers' }).textContent).toContain('started 5 min ago');
  });
});

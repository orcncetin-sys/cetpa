/**
 * ebelgeIndir.test.ts — e-belge (PDF / XML) indirme servisinin ROL KAPISI (karar turu 2026-10-11 — K7 / H1, İ3, İ5).
 *
 * Servis indirmenin TEK uygulamasıdır (Fatura Detayı penceresi ve e-Belge Merkezi aynı işlevi çağırır). Kapı burada
 * durduğu için çağıran düğmesini gizlemeyi unutsa da istek atılmaz: rol, sunucunun kapısından (`mikroFaturalar` okuma)
 * geçemiyorsa `authFetch` HİÇ çağrılmaz ve kullanıcıya yetki metni döner — sessiz 403 kalmaz.
 *
 * H1: kapı İKİ YÖNDE de aynıdır. Sunucu belgenin yönünü bilemez; «giden belge Satış'a açık» dalı YAZILMADI. Bu yüzden
 * kapı sorusu yön almaz ve PDF gövdesi yön taşımaz (XML gövdesindeki `yon` Mikro'nun belge seçimidir, kapı değil).
 *
 * Yalnız ağ (`authFetch`) ve tarayıcı indirmesi sahte; rol GERÇEK depodan, kapı GERÇEK ortak tablodan okunur.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eBelgeIndir, type EBelgeIstek, type EBelgeTuru } from './ebelgeIndir';
import { useAppStore } from '../store/appStore';
import { UserRole } from '../types';
import { APP_ROLES } from '../lib/rbac';
import { MIKRO_UC_KAPILARI, ucKapisindanGecer } from '../lib/mikroUcKapilari';

const authFetch = vi.fn();
vi.mock('./authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

const UUID = '11111111-2222-3333-4444-555555555555';
const GUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TURLER: EBelgeTuru[] = ['pdf', 'xml'];
const YONLER = ['gelen', 'giden'] as const;
/** § 10.4 H1'in «geçen» ve «kilitlenen» sütunları ELLE (ortak tablo değişirse bu liste BİLEREK güncellenir). */
const GECEN = [UserRole.Admin, UserRole.Manager, UserRole.Accounting];
const KILITLI = [UserRole.Sales, UserRole.Purchasing, UserRole.Logistics];
const TUM_ROLLER = Object.values(UserRole);
const UC = { pdf: 'POST /api/mikro/ebelge/pdf', xml: 'POST /api/mikro/ebelge/xml' } as const;

const istek = (tur: EBelgeTuru, ek: Partial<EBelgeIstek> = {}): EBelgeIstek => ({ tur, uuid: UUID, faturaGuid: GUID, dosyaAdi: 'SZN2026000001284', ...ek });
const yanit = (govde: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(govde) });
/** Servisin biçim eşiğini (PDF 500, XML 200 karakter) aşan geçerli base64 / düz XML. */
const PDF_B64 = btoa('%PDF-1.4 '.repeat(80));
const XML_DUZ = `<?xml version="1.0" encoding="UTF-8"?><Invoice>${'<Satir>ÇİMENTO</Satir>'.repeat(20)}</Invoice>`;
const basarili = () => authFetch.mockImplementation((url: string) => yanit({ success: true, data: url.endsWith('/xml') ? XML_DUZ : PDF_B64 }));
/** Atılan isteğin (url, yöntem, çözülmüş gövde) üçlüsü. */
const atilan = () => authFetch.mock.calls.map(c => {
  const init = c[1] as { method?: string; body?: string } | undefined;
  return { url: c[0] as string, yontem: init?.method, govde: JSON.parse(String(init?.body)) as Record<string, unknown> };
});

/** İndirilen dosya adları (jsdom gezinmeyi uygulamaz — bağlantı tıklaması yakalanır). */
let indirilen: string[] = [];
const nesneAdresi = vi.fn(() => 'blob:sahte');
const adresBirak = vi.fn();
const asilAdres = { olustur: URL.createObjectURL, birak: URL.revokeObjectURL };

beforeEach(() => {
  authFetch.mockReset();
  indirilen = [];
  nesneAdresi.mockClear();
  adresBirak.mockClear();
  URL.createObjectURL = nesneAdresi;
  URL.revokeObjectURL = adresBirak;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { indirilen.push(this.download); });
  useAppStore.setState({ userRole: UserRole.Accounting });
});
afterEach(() => {
  vi.restoreAllMocks();
  URL.createObjectURL = asilAdres.olustur;
  URL.revokeObjectURL = asilAdres.birak;
});

describe('eBelgeIndir — rol kapısı: geçemeyen rolde istek HİÇ atılmaz (İ3)', () => {
  const KILITLI_DURUMLAR = KILITLI.flatMap(rol => TURLER.flatMap(tur => YONLER.map(yon => [rol, tur, yon] as const)));
  it.each(KILITLI_DURUMLAR)('kilitli rol %s × %s × %s belge: istek atılmaz, yetki metni döner, dosya inmez', async (rol, tur, yon) => {
    useAppStore.setState({ userRole: rol });
    basarili();
    expect(await eBelgeIndir(istek(tur, { yon }), true)).toBe('Bu belgeyi indirme yetkiniz yok.');
    expect(authFetch).not.toHaveBeenCalled();
    expect(nesneAdresi).not.toHaveBeenCalled();
    expect(indirilen).toEqual([]);
  });

  const GECEN_DURUMLAR = GECEN.flatMap(rol => TURLER.flatMap(tur => YONLER.map(yon => [rol, tur, yon] as const)));
  it.each(GECEN_DURUMLAR)('geçen rol %s × %s × %s belge: TEK istek atılır, dosya iner', async (rol, tur, yon) => {
    useAppStore.setState({ userRole: rol });
    basarili();
    expect(await eBelgeIndir(istek(tur, { yon }), true)).toBeNull();
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(indirilen).toEqual([`SZN2026000001284.${tur}`]);
    expect(adresBirak).toHaveBeenCalledWith('blob:sahte');
  });

  it('12 rolün HEPSİ × iki tür: istek atılır ⇔ ortak tablo o ucu geçirir (serviste kopya rol listesi yok)', async () => {
    expect([...TUM_ROLLER].sort()).toEqual([...APP_ROLES].sort());   // enum ↔ rbac rol listesi: eksik / fazla rol yok
    for (const rol of TUM_ROLLER) {
      for (const tur of TURLER) {
        useAppStore.setState({ userRole: rol });
        authFetch.mockReset();
        basarili();
        const sonuc = await eBelgeIndir(istek(tur), true);
        const gecer = ucKapisindanGecer(rol, UC[tur]);
        expect(authFetch.mock.calls.length, `${tur} × ${rol}`).toBe(gecer ? 1 : 0);
        expect(sonuc, `${tur} × ${rol}`).toBe(gecer ? null : 'Bu belgeyi indirme yetkiniz yok.');
      }
    }
    // Döngü boş geçmesin: geçenler tam H1 kümesi — dış roller (B2B, Bayi) dâhil kalan 9 rol istek atamaz.
    for (const tur of TURLER) expect(TUM_ROLLER.filter(r => ucKapisindanGecer(r, UC[tur])).sort()).toEqual([...GECEN].sort());
  });

  it('H1 — yön kapıyı DEĞİŞTİRMEZ: Satış kendi kestiği (giden) belgede de istek atamaz', async () => {
    useAppStore.setState({ userRole: UserRole.Sales });
    basarili();
    for (const tur of TURLER) {
      expect(await eBelgeIndir(istek(tur, { yon: 'giden' }), true)).toBe('Bu belgeyi indirme yetkiniz yok.');
      expect(await eBelgeIndir(istek(tur, { yon: undefined }), true)).toBe('Bu belgeyi indirme yetkiniz yok.');
    }
    expect(authFetch).not.toHaveBeenCalled();
    // İki uç da ortak tabloda TEK sabit kapıdır (yöne bağlı ikinci satır yok).
    expect(MIKRO_UC_KAPILARI[UC.pdf]).toEqual(['mikroFaturalar', 'read']);
    expect(MIKRO_UC_KAPILARI[UC.xml]).toEqual(['mikroFaturalar', 'read']);
  });

  it('kapı veri kontrolünden ÖNCE: kilitli rolde UUID\'siz XML isteği «UUID yok» değil YETKİ metni alır', async () => {
    useAppStore.setState({ userRole: UserRole.Logistics });
    expect(await eBelgeIndir(istek('xml', { uuid: undefined }), true)).toBe('Bu belgeyi indirme yetkiniz yok.');
    useAppStore.setState({ userRole: UserRole.Accounting });
    expect(await eBelgeIndir(istek('xml', { uuid: undefined }), true)).toBe('Bu belgede UUID yok — XML çekilemez.');
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('İngilizce yetki metni', async () => {
    useAppStore.setState({ userRole: UserRole.Purchasing });
    expect(await eBelgeIndir(istek('pdf'), false)).toBe('You are not allowed to download this document.');
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('rol depodan HER çağrıda okunur: oturum rolü değişince servis izler', async () => {
    basarili();
    expect(await eBelgeIndir(istek('pdf'), true)).toBeNull();
    useAppStore.setState({ userRole: UserRole.Sales });
    expect(await eBelgeIndir(istek('pdf'), true)).toBe('Bu belgeyi indirme yetkiniz yok.');
    expect(authFetch).toHaveBeenCalledTimes(1);
  });
});

describe('eBelgeIndir — istek: yol ortak tablo anahtarından, PDF gövdesi yön TAŞIMAZ (H1)', () => {
  it('PDF: UUID varsa { uuid }, yoksa { faturaGuid } — hiçbir dalda `yon` yok (istek yön taşısa da)', async () => {
    basarili();
    await eBelgeIndir(istek('pdf', { yon: 'gelen' }), true);
    await eBelgeIndir(istek('pdf', { uuid: undefined, yon: 'giden' }), true);
    expect(atilan()).toEqual([
      { url: '/api/mikro/ebelge/pdf', yontem: 'POST', govde: { uuid: UUID } },
      { url: '/api/mikro/ebelge/pdf', yontem: 'POST', govde: { faturaGuid: GUID } },
    ]);
  });

  it('XML: { uuid, tur, yon } — `yon` Mikro\'nun belge seçimidir (gelen / gönderilen), kapı değil; belge türü verilmezse e-fatura', async () => {
    basarili();
    await eBelgeIndir(istek('xml', { yon: 'gelen', belgeTuru: 'e-arsiv' }), true);
    await eBelgeIndir(istek('xml', { yon: 'giden' }), true);
    expect(atilan()).toEqual([
      { url: '/api/mikro/ebelge/xml', yontem: 'POST', govde: { uuid: UUID, tur: 'e-arsiv', yon: 'gelen' } },
      { url: '/api/mikro/ebelge/xml', yontem: 'POST', govde: { uuid: UUID, tur: 'e-fatura', yon: 'giden' } },
    ]);
  });

  it('istek yolu = kapı sorusunun anahtarı (iki tür de ortak tabloda kayıtlı uç)', async () => {
    basarili();
    for (const tur of TURLER) await eBelgeIndir(istek(tur), true);
    expect(atilan().map(a => `${a.yontem} ${a.url}`)).toEqual([UC.pdf, UC.xml]);
    for (const a of atilan()) expect(`${a.yontem} ${a.url}` in MIKRO_UC_KAPILARI).toBe(true);
  });
});

describe('eBelgeIndir — yanıt (geçen rolde): hata SESSİZ kalmaz', () => {
  it('sunucu reddi (403 dâhil) kullanıcıya sunucunun metniyle döner, dosya inmez', async () => {
    authFetch.mockReturnValue(yanit({ error: 'Bu veri için yetkiniz yok.' }, false));
    expect(await eBelgeIndir(istek('pdf'), true)).toBe('Bu veri için yetkiniz yok.');
    authFetch.mockReturnValue(yanit({ success: false }, true));
    expect(await eBelgeIndir(istek('xml'), true)).toBe('Belge alınamadı.');
    expect(indirilen).toEqual([]);
  });

  it('başarılı ama beklenen biçimde olmayan yanıt ve ağ hatası ayrı metinle döner', async () => {
    authFetch.mockReturnValue(yanit({ success: true, data: 'kısa' }));
    expect(await eBelgeIndir(istek('pdf'), true)).toBe('Yanıt beklenen biçimde değil.');
    authFetch.mockRejectedValue(new Error('ağ yok'));
    expect(await eBelgeIndir(istek('pdf'), true)).toBe('İndirme başarısız — sunucuya ulaşılamadı.');
    expect(indirilen).toEqual([]);
  });
});

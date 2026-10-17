// @vitest-environment node
/**
 * davetPostasi.test.ts — davet postasının çağrı metni ve «davet bağlantısı üreten HER uç bu metni basar» çiti (şartname «kayıt
 * kapanışı ve kuruş» A3, 2026-10-17).
 *
 * NEDEN ÇİT: ilk düzeltme yalnız `epostaRoutes.ts` davet gövdesine uygulanmıştı; süper yöneticinin kiracı daveti
 * (`superadminRoutes.ts`) «Hesap Oluştur» düğmesiyle kalmıştı (aynı yarım düzeltme sınıfı: davetKodu.test.ts). Davet bağlantısı
 * (`?invite=`) üreten yeni bir uç eklenirse buraya düşer: ortak metni basmıyorsa kırmızı. Gerçek işleyicinin ürettiği posta:
 * kucukKapanislar.zincir.test.ts «A3».
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SRC_KOK, kaynakDosyalari, kodSatirlari, gorece, suclular } from '../test/kaynakTarama';
import { DAVET_POSTASI } from './davetPostasi';

const SUNUCU_DOSYALARI = [join(SRC_KOK, '..', 'server.ts'), ...kaynakDosyalari(join(SRC_KOK, 'server'))];

describe('DAVET_POSTASI — metin', () => {
  it('düğme davetin ne yaptığını söyler: daveti açar, Google ile girer; hesap açma çağrısı yok', () => {
    expect(DAVET_POSTASI.dugme).toBe('Daveti Aç ve Google ile Giriş Yap');
    expect(DAVET_POSTASI.yonerge).toContain('Google hesabıyla giriş yapın');
    expect(DAVET_POSTASI.sifreNotu).toContain('yöneticinizden sizin için kullanıcı oluşturmasını isteyin');
    for (const m of Object.values(DAVET_POSTASI)) {
      expect(m).not.toMatch(/Hesap Oluştur|Kayıt Ol|kaydınızı/i);
    }
  });

  it('kişisel veri ya da yer tutucu taşımaz ve HTML\'e kaçışsız gömülebilir (biçim karakteri yok)', () => {
    for (const m of Object.values(DAVET_POSTASI)) {
      expect(m).not.toMatch(/[<>&"@]|\$\{|\{\{/);
    }
  });

  it('Türkçe tam karakterle; ASCII\'leşmiş yazım ve birleşik nokta yok', () => {
    const hepsi = Object.values(DAVET_POSTASI).join(' ');
    expect(hepsi).not.toMatch(/\u0307/);
    expect(hepsi).not.toMatch(/\b(Davet[ıi] Ac|Giris|yoneticiniz|olusturmas|baglant|sifre)\b/);
  });
});

describe('bağlantı çiti — davet bağlantısı (`?invite=`) üreten her modül ortak metni basar', () => {
  it('üreten modüller bilinen iki uç; ikisi de düğmeyi, yönergeyi ve şifre notunu `DAVET_POSTASI`\'ndan basar', () => {
    const ureten = SUNUCU_DOSYALARI.filter(yol => kodSatirlari(yol).some(s => /\/\?invite=\$\{/.test(s.kod)));
    expect(ureten.map(gorece).sort()).toEqual(['src/server/routes/epostaRoutes.ts', 'src/server/routes/superadminRoutes.ts']);
    for (const yol of ureten) {
      const kod = kodSatirlari(yol).map(s => s.kod).join('\n');
      for (const alan of ['dugme', 'yonerge', 'sifreNotu']) expect(kod, `${gorece(yol)}: DAVET_POSTASI.${alan}`).toContain(`\${DAVET_POSTASI.${alan}}`);
    }
  });

  it('sunucu kodunda eski çağrı kalmadı: «Hesap Oluştur» / «kaydınızı tamamlayabilirsiniz» hiçbir kod satırında yok', () => {
    expect(suclular(SUNUCU_DOSYALARI, /Hesap Oluştur|kaydınızı tamamlayabilirsiniz/)).toEqual([]);
  });
});

// İ1-d (inceleme 1, 2026-10-17): Yönetim → Kullanıcılar davet penceresinin notu eski akışı («e-posta üzerinden kayıt olabilir»)
// anlatıyordu. Not artık postayla AYNI yolu söyler: davet bağlantısı + aynı adrese bağlı Google hesabı; şifreyle girecekse yönetici
// hesabı açar (o ekrandaki «Kullanıcı Ekle (manuel)» bölümü — not var olmayan bir bölüme göndermesin diye başlığı da sınanır).
describe('İ1-d — davet penceresinin notu (AdminPage) postayla tutarlı; eski kayıt akışını anlatmaz', () => {
  const ADMIN = join(SRC_KOK, 'pages', 'AdminPage.tsx');
  const kod = kodSatirlari(ADMIN).map(s => s.kod).join('\n');

  it('eski not yok: «e-posta üzerinden kayıt olabilir» / «can register via email»', () => {
    expect(suclular([ADMIN], /kayıt olabilir|can register via email/)).toEqual([]);
  });

  it('yeni not: davet bağlantısı + aynı adrese bağlı Google hesabıyla giriş (postanın yönergesiyle aynı yol); şifre için «Kullanıcı Ekle (manuel)»', () => {
    expect(kod).toContain('Davet edilen kişi postadaki davet bağlantısını açar ve o e-posta adresine bağlı Google hesabıyla giriş yapar');
    expect(DAVET_POSTASI.yonerge).toContain('e-posta adresine bağlı Google hesabıyla giriş yapın');
    expect(kod).toContain('E-posta ve şifreyle girecekse hesabını yukarıdaki «Kullanıcı Ekle (manuel)» ile açın');
    expect(kod).toContain("currentLanguage==='tr'?'Kullanıcı Ekle (manuel)':'Add User (manual)'");   // gönderme yapılan bölüm VAR
    expect(kod).toContain('signs in with the Google account linked to that email address');
    expect(kod).not.toMatch(/\u0307/);
  });

  // İ2-b (inceleme 2, 2026-10-17): App.tsx'in davetli iletisi (İ1-a, `DAVETLI_HESAP_ACILAMADI_ILETISI`) var olmayan bir bölüme
  // gönderiyordu. İletinin andığı ad, Yönetim ekranındaki bölüm başlığıyla BİREBİR olmalı (iki dilde); eski ad hiçbir kod satırında yok.
  it('App.tsx davetli iletisi aynı bölüme gönderir: tr «Kullanıcı Ekle (manuel)», en "Add User (manual)" — başlıkla birebir', () => {
    const APP = join(SRC_KOK, 'App.tsx');
    const satirlar = kodSatirlari(APP).map(s => s.kod.trim());
    const i = satirlar.indexOf('const DAVETLI_HESAP_ACILAMADI_ILETISI = {');
    expect(i, 'App.tsx: DAVETLI_HESAP_ACILAMADI_ILETISI').toBeGreaterThan(-1);
    const [tr, en] = [satirlar[i + 1], satirlar[i + 2]];
    expect(tr).toMatch(/^tr: 'Davetiniz kabul edilemedi: .*«Kullanıcı Ekle \(manuel\)» ile hesap açmasını isteyin\.',$/);
    expect(en).toMatch(/^en: 'Your invitation could not be accepted: .*"Add User \(manual\)"\.',$/);
    const trAd = /«([^»]+)»/.exec(tr)?.[1];
    const enAd = /"([^"]+)"/.exec(en)?.[1];
    expect(kod).toContain(`currentLanguage==='tr'?'${trAd}':'${enAd}'`);   // iletinin andığı bölüm Yönetim ekranında VAR
    expect(suclular([APP, ADMIN], /Kullanıcı oluştur»|Create user/)).toEqual([]);
  });
});

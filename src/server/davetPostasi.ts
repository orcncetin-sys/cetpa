/**
 * davetPostasi.ts — davet postasının ÇAĞRI METNİ (2026-10-17, şartname «kayıt kapanışı ve kuruş» A3).
 *
 * Herkese açık kayıt kapandı (A1 / A2): davet bağlantısı hesap AÇMAZ. Davetli Google ile girer, davet kabulünde belgesini
 * SUNUCU yazar (`/api/invites/redeem`); e-posta + şifreyle girecekse hesabı yönetici «Kullanıcı Ekle (manuel)» ile açar ve parola
 * belirleme bağlantısını iletir. Eskiden iki davet postası da «Hesap Oluştur» düğmesi basıyordu — kapanmış kayıt sekmesine
 * götüren çağrı.
 *
 * OKUYANLAR (davet bağlantısı `?invite=` üreten HER uç bu metni basar; çit `davetPostasi.test.ts`):
 *  • `routes/epostaRoutes.ts` `POST /api/admin/invite` (Yönetim → Kullanıcılar → davet),
 *  • `routes/superadminRoutes.ts` `POST /api/superadmin/tenants/:companyId/invite` (süper yöneticinin kiracı daveti).
 *
 * Metinler KİŞİSEL VERİ TAŞIMAZ (ad, e-posta, kiracı yok) ve HTML'e kaçışsız gömülür: yer tutucu ya da biçim karakteri içermez.
 * Yaprak modül: hiçbir şeyi içe aktarmaz.
 */
export const DAVET_POSTASI = Object.freeze({
  /** Davet paragrafının sonu: bağlantıyla ne yapılacağı. */
  yonerge: 'Aşağıdaki düğmeyle daveti açın ve bu postanın geldiği e-posta adresine bağlı Google hesabıyla giriş yapın.',
  /** Bağlantı düğmesi (eski «Hesap Oluştur»). */
  dugme: 'Daveti Aç ve Google ile Giriş Yap',
  /** Google hesabı olmayan ya da şifreyle girecek davetlinin yolu. */
  sifreNotu: 'Bu adres bir Google hesabına bağlı değilse ya da e-posta ve şifreyle girmek istiyorsanız CETPA yöneticinizden sizin için kullanıcı oluşturmasını isteyin; parola belirleme bağlantısını yöneticiniz iletir.',
});

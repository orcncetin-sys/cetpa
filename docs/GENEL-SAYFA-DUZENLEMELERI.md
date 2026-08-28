# Genel (kimliksiz) sayfalar — düzenlenecekler

**Durum:** Sayfalar 2026-08-28'de bağlandı ve **içerikleri olduğu gibi canlıya
alındı** (kullanıcı kararı: "hepsi böyle kalsın push et, sonra edit edilecek
olarak not al"). Aşağıdaki maddeler **düzenlenmeyi bekliyor**.

## Neden bu liste var

`PrivacyPage`, `TermsPage`, `BlogPage`, `CareerPage`, `ApiPage` (933 satır)
yazılmış ama **hiç bağlanmamıştı** — landing altbilgisinde 5 `<Link>` vardı,
uygulamada tek bir `<Route>` yoktu. Hiç render edilmedikleri için içerikleri de
hiç okunmamıştı. Bağlandıklarında içeride uydurma şirket olguları çıktı.
(Ayrıntı: `src/lib/publicPaths.ts` dosya başlığı.)

---

## 🔴 En kritik: şirket merkezi kod tabanında ÇELİŞİYOR

Aynı sitede iki farklı resmî merkez beyan ediliyor:

| Antalya diyen | İstanbul diyen |
|---|---|
| `CareerPage.tsx:72` "Antalya merkezli" | `PrivacyPage.tsx:45,74` KVKK/GDPR veri sorumlusu **adresi**: "Levent, Beşiktaş, İstanbul 34330" |
| `LandingPage.tsx:2143` "Antalya'da yapıldı" | `TermsPage.tsx:26,35` "İstanbul Mahkemeleri ve İcra Daireleri yetkilidir" |
| `ApiPage.tsx:109` örnek yanıt "Antalya Merkez Depo" | `AccountingModule.tsx:2666` belge başlığı "İSTANBUL, TÜRKİYE" |
| `OrdersPage.tsx:2975` depolar: "Antalya (Eski Sanayi)", "Antalya (Havalimanı)" | |
| `App.tsx:2795` rota optimizasyonu Antalya deposundan başlıyor | |

Operasyonel kanıtların tamamı Antalya'yı gösteriyor; İstanbul yalnızca yasal
metinlerde geçiyor. **Doğrusu hangisiyse KVKK aydınlatma adresi ve yetkili
mahkeme maddesi ona göre düzeltilmeli** — ikisi birden kalamaz.

---

## 🔴 Yüksek risk

| Yer | Sorun |
|---|---|
| `LandingPage.tsx:1388` | **"Türkiye'nin #1 B2B Cloud ERP'si"** — CANLI. Kanıtsız üstünlük iddiası; Ticari Reklam Yönetmeliği'nde ispat yükümlülüğüne tabi. Doğrudan konumlanılan rakipler (Mikro/Logo) haksız rekabet iddia edebilir. Aynı iddia `CareerPage:72`, `ApiPage:137`, `LandingPage:2061`'de "lider" olarak da var. Not: `index.html:9` bilinçli olarak üstünlük sıfatı KULLANMIYOR. |
| `CareerPage.tsx` (4 ilan) | Full Stack Dev, Backend Dev, Müşteri Başarı Uzmanı, Satış Temsilcisi — **gerçek açık pozisyon mu?** |
| `CareerPage.tsx:135` | "Genel başvurunuzu gönderin, ekibimiz büyüdükçe özgeçmişinizi değerlendireceğiz" — süresiz saklama vaadi. Kod tabanında ATS/aday havuzu **yok**; sayfada KVKK aydınlatma metni ve `PrivacyPage` bağlantısı **yok**; `PrivacyPage`'de "özgeçmiş/başvuru/saklama süresi" başlığı **yok**. Özgeçmiş kişisel veridir. |
| `BlogPage.tsx:43` | "E-Fatura ve **E-Defter** Uyumluluğu" yazısı — e-Fatura gerçek (`EBelgeMerkezi.tsx`, Luca uçları), ama **e-Defter kod tabanında hiç yok**. Vergi mevzuatı danışmanlığı vaadi. |
| `BlogPage.tsx:161` | "Bültenimize abone olun" — **bülten altyapısı yok**, sadece `mailto:`. |

## 🟠 Orta risk

| Yer | Sorun |
|---|---|
| `CareerPage:19,72` · `LandingPage:1388,1527,1737` · `ApiPage:142` | **"200+ aktif müşteri"** — 6 yerde düz metin sabiti, hiçbir sayımdan türetilmiyor. `LandingPage:1942`'de aynı 200 rakamı "200+ inceleme" olarak da kullanılmış. |
| `BlogPage.tsx:22-57` | **6 blog yazısının hiçbiri yok** — gövde/yazar/kaynak alanı yok, kartlar tıklanamıyor (`:136`). |
| `BlogPage.tsx:25` | Tarihler göreli sabit ("2 hafta önce") — zaman geçtikçe daha da yanlışlaşır. |
| `PrivacyPage.tsx:45,74` | `privacy@cetpa.com.tr` — bu kutu gerçekten çalışıyor mu? |
| `CareerPage:44,47,143` · `BlogPage:166` | `info@cetpa.com.tr` — başvuru/bülten bu kutuya düşüyor, izleniyor mu? |

## 🟡 Doğrulanamayan (yalnız şirket sahibi bilir)

- **"CETPA A.Ş."** gerçekten anonim şirket mi (Ltd. Şti. değil)? Ticaret sicil
  no, vergi dairesi/no, MERSİS kaydı kod tabanında hiçbir yerde yok. Unvan
  8 konumda yayınlanıyor.
- "Küçük bir ekibiz", "uzaktan çalışmaya açığız" beyanları.

---

## Not: denetim tamamlanmadı

Doğrulama ajanlarının 5'i (LandingPage, ApiPage, PrivacyPage, TermsPage,
index.html) **haftalık kullanım limitine** takıldı. Yukarıdaki liste
`CareerPage` ve `BlogPage` için tam, diğerleri için **yalnızca çıkarma
aşamasına** dayanıyor. Limit sıfırlandığında kalan 5 dosya için doğrulama
tekrar koşturulmalı:

```
Workflow({scriptPath: '.../genel-sayfa-olgu-denetimi-wf_1026f545-d03.js', resumeFromRunId: 'wf_1026f545-d03'})
```


---

## ✅ KAPANIŞ — 2026-08-28 (2. tur)

Kalan tüm maddeler kapatıldı; denetim ajanları limite takıldığı için son 5
dosya elle tarandı. Yapılanlar:

| Bulgu | İşlem |
|---|---|
| **3 uydurma müşteri referansı** (Ahmet Y./YapıTrade, Selin K./KozmoTex + blockquote'ta Emre K./Tekstil A.Ş., %60/%35/%71 rakamlarıyla, 5 yıldız) | KALDIRILDI. "Müşteri Hikayeleri" bölümü artık yalnız `testimonials` koleksiyonunda GERÇEK kayıt varsa görünür |
| **McKinsey/Gartner atıfları** (ROI hesaplayıcı) | Gerçek kurumlara doğrulanamayan rakam atfetmek atıfsız tahminden risklidir → dürüst "Varsayım" etiketi + "sonuçlar işletmeye göre değişir" notu |
| **"İSMMMO uyumlu Sertifikalı Ortak rozeti"** | Gerçek kuruma (İstanbul SMMM Odası) doğrulanamayan bağlantı → kurum adı kaldırıldı; program gerçekse yazılı izinle geri konur |
| **"SLA Garantili Destek"** (Kurumsal plan, 2 dosya) | "Sözleşmeyle Belirlenen SLA" — kurumsal SLA zaten sözleşmede pazarlık edilir, mutlak taahhüt kaldırıldı |
| **Blog "2 hafta önce · 6 dk okuma"** (6 kartta) | Yayınlanmamış yazıya yayın tarihi/okuma süresi olamaz → "Hazırlanıyor" rozeti. Sayfa zaten "tam yazılar yayında değil" diye dürüst beyan taşıyordu |
| **Blog "E-Defter" başlığı + ApiPage "e-defter"** | e-Defter kod tabanında YOK (ölçüm: 0 isabet) → başlık ve açıklamalar yalnız e-Fatura'ya çekildi |
| **"Bültene Abone Ol"** | Bülten altyapısı yok, düğme yalnız mailto → "Yayınlanınca Haber Ver" |
| **ApiPage Logo "çift yönlü entegrasyon" / SAP "bağlantı desteği"** | Gerçek: ikisi de STUB (erpRoutes.ts) → "hazırlık aşamasında; kurulum kapsamı birlikte belirlenir" |
| **`privacy@cetpa.com.tr`** | Varlığı doğrulanamadı (port 25 engelli, SMTP sınanamadı). KVKK talebinin ölü kutuya düşme riskine karşı doğrulanmış `info@cetpa.com.tr`e çevrildi; privacy@ açılıp test edilirse geri döner |
| **og:image** | Ölçüldü: `erp_hero.png` canlıda HTTP 200 — sorun yok |
| **index.html** | Tarandı — kanıtsız iddia yok (açıklama bilinçli olarak üstünlük sıfatsız) |

### Sahibin teyidine kalan (kod değil, İŞ KARARI)
- **Ortaklık programı şartları** (landing "Partners" bölümü): "Ücretsiz CPA
  Lisansı" + "her abonelikten %20 aylık komisyon". Form gerçek (demoRequests'e
  yazıyor) ama bu ŞARTLARIN sahibi tarafından konulduğu belirsiz — CPA bu
  vaatle başvuruyor. Şartlar doğru değilse söyleyin, düzeltilir.
- **"%20 yıllık indirim"** (fiyatlandırma anahtarı): fiyat yapısı sahibinin
  tasarrufu; PricingPage ile tutarlı görünüyor, dokunulmadı.

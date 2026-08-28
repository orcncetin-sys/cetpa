# Genel (kimliksiz) sayfalar — düzenlenecekler

**Durum:** Sayfalar 2026-08-26'da bağlandı ve **içerikleri olduğu gibi canlıya
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

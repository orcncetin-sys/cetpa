---
name: tdd-workflow
description: Cetpa'da test güdümlü geliştirme — yeni mantık yazarken, hata düzeltirken veya refactor ederken önce test. ECC'nin tdd-workflow skill'inden Cetpa'ya uyarlandı (vitest, değişmez-testi deseni, legacy gerçekleri).
---

# TDD iş akışı (Cetpa uyarlaması)

Kaynak: [ECC tdd-workflow](https://github.com/affaan-m/ECC) — buradaki hâli Cetpa'nın
gerçeklerine göre DARALTILDI ve keskinleştirildi. ECC'nin "%80 kapsam + Playwright
E2E" hedefi bu projede uygulanmaz: ~30k satırlık legacy React tabanında battaniye
kapsam hedefi anlamsız iş üretir, E2E altyapısı yok (tarayıcı doğrulaması Browser
paneliyle elle yapılır). Bizim kuralımız kapsam yüzdesi değil, DAVRANIŞTIR.

## Ne zaman

- `src/utils/`, `src/lib/`, `src/server/`e yeni mantık eklerken → **önce test**
- Hata düzeltirken → **önce hatayı ÜRETEN test** (regression kilidi), sonra düzeltme
- Refactor ederken → mevcut testler yeşilken; test yoksa önce karakterizasyon testi
- "Yazıldı ama bağlanmadı" riski taşıyan her yapı → değişmez testi (aşağıda)

## Cetpa kuralları (ECC'den farklar)

1. **Test-first kapsamı seçicidir:** DEĞİŞEN/YENİ mantık test edilir; dokunulmayan
   legacy'ye kapsam borcu çıkarılmaz. UI bileşenine test yazmak için önce mantığı
   `utils/`e saf fonksiyon olarak çıkar (örn. `utils/faturaEsle.ts`, `utils/arama.ts`
   böyle doğdu), sonra ona TDD uygula. JSX render testi yazmayız.
2. **Hata düzeltme = iki commit'lik zihin, tek commit'lik iş:** önce kırmızı test
   (hatayı aynen üretir), sonra düzeltme aynı commit'te yeşile çevirir. Kırmızıyı
   görmeden düzeltme yazma — testin yanlış şeyi test etmediğinin tek kanıtı budur.
3. **Değişmez (invariant) testleri — bu projenin imza deseni:** aynı bilginin iki
   yerde elle tutulduğu her nokta kaynak-tarayan testle kilitlenir. Emsaller:
   - `src/lib/topLevelTabs.test.ts` — `activeTab === 'X'` render dalı ⊆ TOP_LEVEL_TABS
     ve sette ölü girdi yok ('finans' vakasının 4. tekrarına karşı)
   - `src/hooks/useSekmeVerileri.test.ts` — hook'un döndürdüğü her değer App.tsx'te
     kullanılıyor ("yazıldı ama bağlanmadı" sınıfına karşı)
   - `src/lib/publicPaths.test.ts` — genel yollar ↔ sekme çakışması yasak
   Yeni bir "iki listeyi senkron tut" durumu görürsen refleksin bu desen olsun.
4. **Türkçe veri gerçeği:** metin karşılaştıran her test 'İ/ı/Ş' içeren örnek
   İÇERMELİ (`src/utils/arama.test.ts` emsal — 'IŞIK'.toLowerCase() tuzağı).
   Para/tarih ayrıştıran testler Türk biçimini (`1.234,56`, `DD.MM.YYYY`) kapsar
   (`src/utils/trParse.test.ts` emsal).
5. **Sunucu rotaları:** yeni `/api` rotasının en az şu üç testi olur: mutlu yol,
   yetkisiz istek (401/403), bozuk gövde. Emsal: `src/server/routes/aiRoutes.test.ts`.
   Tenant'lı koleksiyona dokunuyorsa companyId izolasyon testi ŞARTTIR
   (`src/lib/collections.test.ts`, `src/lib/rbac.test.ts` emsal).

## Komutlar

```bash
npx vitest run                      # tüm süit (~3 sn — bahane yok)
npx vitest run src/utils/x.test.ts  # tek dosya
npx vitest --watch src/utils/x.test.ts  # kırmızı→yeşil döngüsü için
npx tsc --noEmit                    # tipler de testtir
```

Test dosyası, test ettiği dosyanın YANINA konur: `src/utils/x.ts` → `src/utils/x.test.ts`.

## Adımlar (özet)

1. Davranışı tek cümleyle yaz ("kur yoksa '—' gösterilir, uydurma değer yazılmaz").
2. O cümleyi `describe/it` iskeletine çevir; uç durumları ekle (boş, null, Türkçe
   harf, sıfır, negatif — bu projede `?? 0` sessiz-sıfır YASAK, testi de bunu kollasın).
3. `npx vitest run <dosya>` → KIRMIZI gör.
4. Testi geçiren en küçük kodu yaz → YEŞİL.
5. Refactor; süit + `tsc` yeşil kalmalı.
6. Push öncesi her zamanki kapı: `scripts/verify-deploy.sh pre` (bkz. deploy-verify skill).

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      // GEMINI_API_KEY is intentionally NOT injected here — it lives server-side only.
      // Client components must call /api/ai/* proxy routes instead.
      'process.env.GOOGLE_MAPS_PLATFORM_KEY': JSON.stringify(env.GOOGLE_MAPS_PLATFORM_KEY || ''),
      'process.env.SHOPIFY_API_KEY': JSON.stringify(env.SHOPIFY_API_KEY || ''),
      'process.env.SHOPIFY_STORE_URL': JSON.stringify(env.SHOPIFY_STORE_URL || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // İlk açılışta indirilen JS'i küçült (2026-08-17 "sistem çok yavaş
      // açılıyor" şikayeti). Ölçüm: index.html 14 dosyayı modulepreload
      // ediyordu ve toplam ~3.3 MB'a ulaşıyordu — içinde yalnız belirli
      // ekranlarda gereken barkod tarayıcı (401 kB) ve harita (147 kB) de
      // vardı. Bunlar zaten dinamik import; preload listesinden çıkarılınca
      // gerçekten kullanılana kadar hiç inmiyorlar.
      modulePreload: {
        resolveDependencies: (_url: string, deps: string[]) =>
          // DİKKAT: yalnız GERÇEKTEN dinamik-import edilen chunk'lar çıkarılmalı.
          // `charts` (recharts) buradaydı ama App.tsx:155'te STATİK import —
          // preload'unu silmek indirmeyi engellemiyor, yalnız bir tur sonraya
          // atıyordu; yani LCP'yi kötüleştiriyordu (code-review bulgusu).
          deps.filter(d => !/vendor-(barcode|leaflet|jspdf|markdown|pdffont)/.test(d)),
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            // ⚠️ SIRA ÖNEMLİ: React çekirdeği EN ÖNCE atanmalı. Aksi halde
            // paylaşılan bir React yardımcısı (jsx-runtime gibi) aşağıdaki
            // LAZY chunk'lardan birine düşüyor ve onu kullanan HER chunk o
            // lazy chunk'ı statik import ediyor — böylece 401 kB'lık barkod
            // paketi herkese eager iniyordu (2026-08-17'de ölçümle bulundu:
            // vendor-motion içinde `import{n as a}from"./vendor-barcode.js"`).
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')
                || id.includes('node_modules/react-is') || id.includes('node_modules/scheduler')
                || id.includes('node_modules/react/jsx-runtime')) {
              return 'vendor-react';
            }
            // Firebase SDK → its own chunk
            if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
              return 'vendor-firebase';
            }
            // PDF üretimi → lazy chunk. jsPDF'in OPSİYONEL bağımlılıkları da
            // buraya alınmalı: html2canvas/canvg/dompurify/pako/fflate yalnız
            // doc.html()/SVG/sıkıştırma yollarında gerekiyor ama "tüm
            // node_modules → vendor" kuralına düşüp ilk açılışa giriyorlardı
            // (sourcemap ölçümü 2026-08-17: html2canvas 430 kB, pako 221 kB,
            // canvg 176 kB, dompurify 115 kB, fflate 87 kB ≈ 1 MB ham kaynak).
            if (id.includes('node_modules/jspdf')
                || id.includes('node_modules/html2canvas')
                || id.includes('node_modules/canvg')
                || id.includes('node_modules/dompurify')
                || id.includes('node_modules/pako')
                || id.includes('node_modules/fflate')
                || id.includes('node_modules/rgbcolor')
                || id.includes('node_modules/stackblur-canvas')) {
              return 'vendor-jspdf';
            }
            // Leaflet maps → lazy-loaded chunk
            if (id.includes('node_modules/leaflet') || id.includes('node_modules/react-leaflet')) {
              return 'vendor-leaflet';
            }
            // Lucide icons → its own chunk
            if (id.includes('node_modules/lucide-react')) {
              return 'vendor-lucide';
            }
            // Recharts + D3 → its own chunk
            if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
              return 'vendor-charts';
            }
            // Gömülü Roboto fontu (Türkçe PDF glifleri) — TEK BAŞINA 918 kB.
            // pdfFont.ts'te dinamik import edilse bile, aşağıdaki "tüm
            // node_modules → vendor" kuralı onu yine ortak vendor chunk'ına
            // çekip ilk açılışa sokuyordu; kendi chunk'ı olmadan erteleme
            // çalışmıyor (2026-08-17, ölçümle doğrulandı).
            if (id.includes('node_modules/roboto-base64')) {
              return 'vendor-pdffont';
            }
            // Barkod tarayıcı (ZXing) — TEK BAŞINA 427 kB (2026-08-17 ölçüldü).
            // BarcodeScanner.tsx içinde React.lazy ile de ertelendi; kendi
            // chunk'ında olması o ertelemenin gerçekten işe yaramasını sağlar
            // (aksi halde ortak vendor'a karışıp yine erken inerdi).
            if (id.includes('node_modules/@zxing')) {
              return 'vendor-barcode';
            }
            if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) {
              return 'vendor-motion';
            }
            // ⚠️ vendor-markdown (96 kB) EAGER KALIYOR — ÇÖZÜLEMEDİ, TEKRAR DENEME.
            //
            // Tüketicilerinin ikisi de (DashboardAnalysis→DashboardPage,
            // QualityModule) React.lazy ile erteleniyor, yani react-markdown'ın
            // KENDİSİ eager değil. Chunk'ı eager yapan şey içine düşen
            // `react/jsx-runtime` CJS SARMALAYICISI: react'in jsx-runtime.js
            // dosyası CommonJS ve ESM tarafından import edildiğinde rolldown
            // bir interop kopyası üretiyor. Bu kopya chunk-birleştirme
            // aşamasında oluştuğu için `manualChunks` atamasını YOK SAYIYOR ve
            // onu ilk çeken chunk'a yapışıyor; sonra JSX render eden her chunk
            // o chunk'ı statik import etmek zorunda kalıyor.
            //
            // KANIT: vendor-markdown çıktısının içinde `react.transitional.element`,
            // `e.jsx=r`, `e.Fragment=n` var ve hem `index` hem `vendor-motion`
            // ondan AYNI sembolü (`n`) çekiyor — react-markdown'ı değil.
            //
            // ÖLÇÜMLE BAŞARISIZ OLAN ALTI YAKLAŞIM (2026-08-18 / 08-21):
            //   1. jsx-runtime kuralını en başa almak
            //   2. react-webcam'i kendi chunk'ına almak
            //   3. motion/framer-motion'ı vendor-react'e taşımak
            //   4. manualChunks sırasını değiştirmek
            //   5. hoistTransitiveImports: false
            //   6. framer-motion'ı ESM build'ine alias'lamak
            //
            // Kopyayı vendor-markdown'dan çıkarmak onu BAŞKA bir lazy chunk'a
            // taşıyor (barkod paketi kaldırılınca tam bunu yaptı: kopya
            // vendor-barcode'dan buraya geçti) — whack-a-mole.
            //
            // Maliyet bilinçli kabul edildi: 96 kB eager. Gerçek çözüm rolldown
            // tarafında (interop modülüne chunk ataması) ya da react'in
            // jsx-runtime'ı ESM yayınlamasında.
            //
            // react-markdown + remark/micromark ağacı — yalnız AI/not ekranları
            if (id.includes('node_modules/react-markdown') || id.includes('node_modules/remark')
                || id.includes('node_modules/micromark') || id.includes('node_modules/mdast')
                || id.includes('node_modules/unist') || id.includes('node_modules/hast')
                || id.includes('node_modules/vfile') || id.includes('node_modules/property-information')) {
              return 'vendor-markdown';
            }
            // (React kuralı en yukarı taşındı — sıra kritik, bkz. yorum.)
            if (id.includes('node_modules')) {
              return 'vendor';
            }
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});

/**
 * ticaretAjaniRoutes.ts — Claude tabanlı ticaret ajanları (2 rota).
 *
 * Kaynak desen: Anthropic "commerce agents blueprint"
 * (claude.com/blog/claude-for-commerce-agents, github.com/anthropics/commerce-agents)
 * — kullanıcı isteği 2026-09-01: "satın alma ve satış modülüne ekle".
 *
 * İKİ AJAN:
 *   POST /api/ai/satis-ajani     — Satış Ajanı (blueprint "shopping/merchant" satış yüzü):
 *                                  bir müşterinin GERÇEK alım geçmişinden yeniden-sipariş
 *                                  + çapraz satış önerisi üretir.
 *   POST /api/ai/satinalma-ajani — Satın Alma Ajanı: kritik stokları son-alış
 *                                  tedarikçilerine göre gruplayıp SAS önerisi çıkarır.
 *
 * TEMEL İLKE (blueprint'in "guardrails constrain prices/products to actual
 * catalog data" kuralı = bizim "sahte kesinlik gösterme" kuralımız):
 *   - Model YALNIZ sunucunun topladığı gerçek veriyi görür (fatura satırları,
 *     stok, tedarikçi) ve yalnız o katalogdaki SKU'ları önerebilir.
 *   - Fiyat/stok RAKAMLARI asla modelin çıktısından alınmaz — model gerekçe ve
 *     miktar önerir; fiyat/stok yanıt üstüne SUNUCUDA katalogdan eklenir.
 *   - Katalogda olmayan SKU önerileri sunucuda SESSİZCE DEĞİL, sayaçla düşülür
 *     (yanıtta `elenenOneri` olarak raporlanır).
 *
 * SAĞLAYICI (2026-09-03 kullanıcı isteği "bunu Gemini ile çözemez miyiz"):
 * ANTHROPIC_API_KEY varsa Claude (claude-opus-5), yoksa mevcut GEMINI anahtarı
 * (resolveGeminiClient — Ayarlar→AI'daki anahtar) kullanılır; ikisi de yoksa 503.
 * Guardrail/doğrulama katmanı sağlayıcıdan bağımsızdır: iki yolda da çıktı aynı
 * zod şemasıyla doğrulanır, SKU'lar katalogla süzülür, rakamlar katalogdan gelir.
 * Hiçbir otomatik çağrı yok — yalnız düğmeyle harcar (Gemini: mevcut anahtar/kota).
 *
 * Model: claude-opus-5 + adaptive thinking (varsayılan açık) + yapılandırılmış
 * çıktı (messages.parse + zodOutputFormat). Refusal-fallback parametresi
 * BİLEREK yok: yalnız beta.messages yüzeyinde yaşıyor ve parse ile tip-temiz
 * birleşmiyor; ticaret istemleri politika açısından zararsız, olası bir
 * refusal parsed_output=null → 502 olarak net biçimde yüzeye çıkar.
 */
import type { Express, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Type } from '@google/genai';
import type { GoogleGenAI } from '@google/genai';

/** server.ts'ten ihtiyaç duyulan HER ŞEY — açık liste (rota-grubu deseni). */
export interface TicaretAjaniCtx {
  requireAuth: unknown;
  requireMfaVerified: unknown;
  reqCompanyId: (req: Request) => Promise<string>;
  reqActor: (req: Request) => { uid: string; email: string };
  writeAuditLog: (actor: { uid: string; email: string }, action: string, details: string) => Promise<unknown>;
  loadCompanyDocs: (coll: string, cid: string) => Promise<Array<Record<string, unknown>>>;
  getPgPool: () => { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> } | null;
  /** Gemini yolu (Claude anahtarı yokken) — aiRoutes ile aynı çözücüler. */
  resolveGeminiClient: () => Promise<GoogleGenAI | null>;
  resolveGeminiModel: (requested?: string) => string;
}

const MODEL = 'claude-opus-5';

const SatisOnerisiSemasi = z.object({
  ozet: z.string(),
  oneriler: z.array(z.object({
    sku: z.string(),
    oneriTipi: z.enum(['yeniden-siparis', 'capraz-satis']),
    onerilenMiktar: z.number(),
    gerekce: z.string(),
  })),
  riskNotlari: z.array(z.string()),
});

const SatinAlmaOnerisiSemasi = z.object({
  ozet: z.string(),
  tedarikciGruplari: z.array(z.object({
    tedarikci: z.string(),
    kalemler: z.array(z.object({ sku: z.string(), onerilenMiktar: z.number() })),
    gerekce: z.string(),
  })),
  riskNotlari: z.array(z.string()),
});

export function ticaretAjaniRoutes(app: Express, C: TicaretAjaniCtx): void {
  /** Anahtar yoksa null — çağıran 503 döner, harcama yapılmaz. */
  const istemci = (): Anthropic | null =>
    process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

  /** Sağlayıcı-bağımsız yapılandırılmış üretim: Claude varsa Claude, yoksa
   *  Gemini. İKİ yolda da nihai doğrulama AYNI zod şemasıyla yapılır — model
   *  çıktısına asla doğrulamasız güvenilmez (guardrail tek kaynak). */
  const yapilandirilmisUret = async (args: {
    system: string; girdi: unknown;
    zodSema: z.ZodObject<z.ZodRawShape>; geminiSema: Record<string, unknown>;
  }): Promise<{ ham: unknown; saglayici: 'claude' | 'gemini' } | { hata: string; kod: number }> => {
    const anthropic = istemci();
    if (anthropic) {
      const yanit = await anthropic.messages.parse({
        model: MODEL, max_tokens: 4000, system: args.system,
        messages: [{ role: 'user', content: JSON.stringify(args.girdi) }],
        output_config: { format: zodOutputFormat(args.zodSema) },
      });
      if (yanit.parsed_output == null) {
        return { hata: `Model çıktısı ayrıştırılamadı (stop: ${yanit.stop_reason ?? '?'}).`, kod: 502 };
      }
      return { ham: yanit.parsed_output, saglayici: 'claude' };
    }
    const gemini = await C.resolveGeminiClient();
    if (!gemini) {
      return { kod: 503, hata: 'AI yapılandırılmamış: sunucuda ANTHROPIC_API_KEY yok ve Gemini anahtarı da tanımlı değil (Ayarlar → AI). İkisinden biri yeter — Gemini mevcut anahtarınızla ücretsiz katmanda çalışır.' };
    }
    const r = await gemini.models.generateContent({
      model: C.resolveGeminiModel(),
      contents: args.system + '\n\nGİRDİ (JSON):\n' + JSON.stringify(args.girdi),
      config: { responseMimeType: 'application/json', responseSchema: args.geminiSema },
    });
    try {
      return { ham: JSON.parse(r.text ?? ''), saglayici: 'gemini' };
    } catch {
      return { hata: 'Gemini çıktısı JSON olarak ayrıştırılamadı.', kod: 502 };
    }
  };

  /** Gemini responseSchema karşılıkları (zod şemalarının aynası; enum'u zod doğrular). */
  const satisGeminiSemasi = {
    type: Type.OBJECT,
    properties: {
      ozet: { type: Type.STRING },
      oneriler: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
        sku: { type: Type.STRING },
        oneriTipi: { type: Type.STRING, enum: ['yeniden-siparis', 'capraz-satis'] },
        onerilenMiktar: { type: Type.NUMBER },
        gerekce: { type: Type.STRING },
      }, required: ['sku', 'oneriTipi', 'onerilenMiktar', 'gerekce'] } },
      riskNotlari: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ['ozet', 'oneriler', 'riskNotlari'],
  };
  const satinAlmaGeminiSemasi = {
    type: Type.OBJECT,
    properties: {
      ozet: { type: Type.STRING },
      tedarikciGruplari: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
        tedarikci: { type: Type.STRING },
        kalemler: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
          sku: { type: Type.STRING }, onerilenMiktar: { type: Type.NUMBER },
        }, required: ['sku', 'onerilenMiktar'] } },
        gerekce: { type: Type.STRING },
      }, required: ['tedarikci', 'kalemler', 'gerekce'] } },
      riskNotlari: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ['ozet', 'tedarikciGruplari', 'riskNotlari'],
  };

  const katalogHaritasi = async (cid: string) => {
    const envanter = await C.loadCompanyDocs('inventory', cid);
    const m = new Map<string, { name: string; stockLevel: number | null; fiyatB2B: number | null }>();
    for (const i of envanter) {
      const sku = String(i.sku ?? '').trim();
      if (!sku) continue;
      const fiyatlar = (i.prices ?? {}) as Record<string, unknown>;
      const ham = fiyatlar['B2B Standard'] ?? fiyatlar['Retail'];
      m.set(sku, {
        name: String(i.name ?? sku),
        stockLevel: typeof i.stockLevel === 'number' ? i.stockLevel : null,
        // Fiyat bilinmiyorsa null — 0 uydurmayız.
        fiyatB2B: typeof ham === 'number' && ham > 0 ? ham : null,
      });
    }
    return m;
  };

  /** POST /api/ai/satis-ajani — Body: { cariKod: string } */
  app.post('/api/ai/satis-ajani', C.requireAuth as never, C.requireMfaVerified as never, async (req: Request, res: Response) => {
    const cariKod = String((req.body as { cariKod?: string } | undefined)?.cariKod ?? '').trim();
    if (!cariKod) return res.status(400).json({ success: false, error: 'cariKod gerekli.' });
    const pool = C.getPgPool();
    if (!pool) return res.status(503).json({ success: false, error: 'PG yok — satış geçmişi okunamıyor (lokal dev).' });
    try {
      const cid = await C.reqCompanyId(req);
      // GERÇEK satış geçmişi: bu carinin satış satırları (sth_tip'e değil,
      // evraktip=4 satış-satırı konvansiyonuna dayanır — fatura-listesi ile aynı).
      const gecmis = await pool.query(
        `SELECT h.sth_stok_kod AS sku, SUM(COALESCE(h.sth_miktar,0)) AS toplamMiktar,
                MAX(h.sth_tarih) AS sonTarih, COUNT(*) AS satirSayisi
           FROM mikro_stok_hareketleri h
          WHERE h.sth_evraktip = 4 AND h.sth_cari_kodu = $1
          GROUP BY h.sth_stok_kod
          ORDER BY MAX(h.sth_tarih) DESC
          LIMIT 25`, [cariKod]);
      if (!gecmis.rows.length) {
        return res.json({ success: true, bos: true,
          mesaj: 'Bu cari için Mikro satış hareketi bulunamadı — öneri üretmek için geçmiş veri gerekli ("Stok Hareketleri" çekilmiş mi?).' });
      }
      const katalog = await katalogHaritasi(cid);
      const gecmisOzet = gecmis.rows.map(r => {
        const sku = String(r.sku);
        const k = katalog.get(sku);
        return { sku, urun: k?.name ?? sku, toplamMiktar: Number(r.toplammiktar ?? r.toplamMiktar ?? 0),
                 sonAlim: String(r.sontarih ?? r.sonTarih ?? '').slice(0, 10),
                 guncelStok: k?.stockLevel ?? null };
      });
      // Çapraz satış havuzu: stokta olan, bu carinin almadığı ilk 40 ürün.
      const alinanlar = new Set(gecmisOzet.map(g => g.sku));
      const havuz = [...katalog.entries()]
        .filter(([sku, k]) => !alinanlar.has(sku) && (k.stockLevel ?? 0) > 0)
        .slice(0, 40)
        .map(([sku, k]) => ({ sku, urun: k.name, guncelStok: k.stockLevel }));

      const uretim = await yapilandirilmisUret({
        system:
          'CETPA (Türk inşaat malzemesi toptancısı) için B2B satış asistanısın. ' +
          'SADECE sana verilen listelerdeki SKU\'ları önerebilirsin; listede olmayan ürün ADI ya da SKU uydurma. ' +
          'Fiyat YAZMA — fiyatlar sisteme sunucuda eklenir. Türkçe, kısa ve gerekçeli yaz. ' +
          'yeniden-siparis: geçmişte alınan ve muhtemelen tükenmiş ürünler; capraz-satis: geçmiş alımlarla uyumlu, stokta olan yeni ürünler.',
        girdi: {
          gorev: 'Bu müşteri için en fazla 8 öneri üret (yeniden sipariş + çapraz satış karışık).',
          musteriSatisGecmisi: gecmisOzet,
          stoktaOlanDigerUrunler: havuz,
        },
        zodSema: SatisOnerisiSemasi, geminiSema: satisGeminiSemasi,
      });
      if ('hata' in uretim) return res.status(uretim.kod).json({ success: false, notConfigured: uretim.kod === 503 || undefined, error: uretim.hata });
      const dogrulama = SatisOnerisiSemasi.safeParse(uretim.ham);
      if (!dogrulama.success) return res.status(502).json({ success: false, error: 'Model çıktısı şemaya uymadı: ' + dogrulama.error.issues.slice(0, 3).map(i => i.path.join('.')).join(', ') });
      const veri = dogrulama.data;
      // GUARDRAIL: katalogda olmayan SKU'lar düşülür; fiyat/stok SUNUCUDAN eklenir.
      let elenen = 0;
      const oneriler = veri.oneriler.flatMap(o => {
        const k = katalog.get(o.sku);
        if (!k || !(o.onerilenMiktar > 0)) { elenen++; return []; }
        return [{ ...o, urunAdi: k.name, guncelStok: k.stockLevel, birimFiyat: k.fiyatB2B }];
      });
      await C.writeAuditLog(C.reqActor(req), 'Satış Ajanı', `${cariKod}: ${oneriler.length} öneri (${elenen} elendi, ${uretim.saglayici})`);
      res.json({ success: true, saglayici: uretim.saglayici, ozet: veri.ozet, oneriler, riskNotlari: veri.riskNotlari, elenenOneri: elenen });
    } catch (e) {
      console.error('[satis-ajani]', e);
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/ai/satinalma-ajani — Body: {} */
  app.post('/api/ai/satinalma-ajani', C.requireAuth as never, C.requireMfaVerified as never, async (req: Request, res: Response) => {
    const pool = C.getPgPool();
    try {
      const cid = await C.reqCompanyId(req);
      const envanter = await C.loadCompanyDocs('inventory', cid);
      const kritikler = envanter
        .map(i => ({ sku: String(i.sku ?? '').trim(), urun: String(i.name ?? ''),
                     stok: Number(i.stockLevel ?? 0), esik: Number(i.lowStockThreshold ?? 5) }))
        .filter(i => i.sku && i.stok < i.esik)
        .sort((a, b) => (a.stok / Math.max(a.esik, 1)) - (b.stok / Math.max(b.esik, 1)))
        .slice(0, 50);
      if (!kritikler.length) return res.json({ success: true, bos: true, mesaj: 'Kritik stok yok — öneri gerekmedi.' });

      // Son ALIŞ tedarikçisi (giriş: sth_tip=0 ölçülmüş konvansiyon; iptal dışı).
      const tedarikciMap = new Map<string, { unvan: string; tarih: string }>();
      if (pool) {
        const r = await pool.query(
          `SELECT DISTINCT ON (h.sth_stok_kod) h.sth_stok_kod AS sku,
                  COALESCE(c.cari_unvan1, h.sth_cari_kodu, '') AS unvan,
                  COALESCE(h.sth_tarih, '') AS tarih
             FROM mikro_stok_hareketleri h
             LEFT JOIN mikro_cari_hesaplar c ON c.cari_kod = h.sth_cari_kodu
            WHERE COALESCE((h.veri->>'sth_tip')::int, -1) = 0
              AND COALESCE((h.veri->>'sth_iptal')::int, 0) = 0
              AND h.sth_stok_kod = ANY($1)
            ORDER BY h.sth_stok_kod, h.sth_tarih DESC`,
          [kritikler.map(k => k.sku)]);
        for (const row of r.rows) tedarikciMap.set(String(row.sku), { unvan: String(row.unvan), tarih: String(row.tarih).slice(0, 10) });
      }
      // Açık otomatik SAS'lar — "zaten taslağı var" bilgisi.
      const acikSas = new Set(
        (await C.loadCompanyDocs('purchaseOrders', cid))
          .filter(p => p.source === 'auto-reorder' && p.status === 'Taslak')
          .map(p => String(p.sku ?? '')),
      );
      const girdi = kritikler.map(k => ({
        ...k,
        sonAlisTedarikcisi: tedarikciMap.get(k.sku)?.unvan || null,
        sonAlisTarihi: tedarikciMap.get(k.sku)?.tarih || null,
        acikTaslakVar: acikSas.has(k.sku),
      }));

      const uretim = await yapilandirilmisUret({
        system:
          'CETPA (Türk inşaat malzemesi toptancısı) için satın alma asistanısın. ' +
          'SADECE verilen listedeki SKU\'ları kullanabilirsin. Kalemleri sonAlisTedarikcisi alanına göre grupla; ' +
          'tedarikçisi bilinmeyenleri "Tedarikçisi belirsiz" grubuna koy ve riskNotlari\'nda belirt. ' +
          'acikTaslakVar=true kalemleri önermek yerine riskNotlari\'nda "taslağı zaten açık" diye not et. ' +
          'Fiyat/tutar YAZMA. Türkçe ve kısa yaz.',
        girdi: { gorev: 'Kritik stoklar için tedarikçi bazlı satın alma önerisi çıkar.', kritikStoklar: girdi },
        zodSema: SatinAlmaOnerisiSemasi, geminiSema: satinAlmaGeminiSemasi,
      });
      if ('hata' in uretim) return res.status(uretim.kod).json({ success: false, notConfigured: uretim.kod === 503 || undefined, error: uretim.hata });
      const dogrulama = SatinAlmaOnerisiSemasi.safeParse(uretim.ham);
      if (!dogrulama.success) return res.status(502).json({ success: false, error: 'Model çıktısı şemaya uymadı: ' + dogrulama.error.issues.slice(0, 3).map(i => i.path.join('.')).join(', ') });
      const veri = dogrulama.data;
      const gecerliSku = new Set(kritikler.map(k => k.sku));
      let elenen = 0;
      const gruplar = veri.tedarikciGruplari.map(g => ({
        ...g,
        kalemler: g.kalemler.flatMap(kl => {
          if (!gecerliSku.has(kl.sku) || !(kl.onerilenMiktar > 0)) { elenen++; return []; }
          const k = kritikler.find(x => x.sku === kl.sku);
          return [{ ...kl, urunAdi: k?.urun ?? kl.sku, mevcutStok: k?.stok ?? null, esik: k?.esik ?? null }];
        }),
      })).filter(g => g.kalemler.length > 0);
      await C.writeAuditLog(C.reqActor(req), 'Satın Alma Ajanı', `${gruplar.length} tedarikçi grubu, ${gruplar.reduce((s, g) => s + g.kalemler.length, 0)} kalem (${elenen} elendi, ${uretim.saglayici})`);
      res.json({ success: true, saglayici: uretim.saglayici, ozet: veri.ozet, tedarikciGruplari: gruplar, riskNotlari: veri.riskNotlari, elenenOneri: elenen });
    } catch (e) {
      console.error('[satinalma-ajani]', e);
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { TOP_LEVEL_TABS } from './topLevelTabs';

/**
 * TOP_LEVEL_TABS sürüklenme-değişmezi.
 *
 * Bu liste üç kez sessizce bayatladı: 'finans' yazım hatası (2026-08-13, Holding
 * grubunun URL senkronunu aylarca öldürdü), 'uretim/raporlar/ayarlar/
 * entegrasyonlar' ölü girdileri + 18 eksik id (2026-08-30). Sonuç hep aynı:
 * sayfa derin-bağlantısız kalır, URL yanlış path'te takılır, trafik sayacı
 * 'diger' kovasına yazar — ve kimse fark etmez ("yazıldı ama bağlanmadı"
 * arıza sınıfının kardeşi).
 *
 * Değişmez (kaynaktan kanıtlanabilir biçimde): `activeTab === 'X'` render
 * dalı olan her X bu sette olmalı (render edilebilen üst düzey sayfa ⇒ derin
 * bağlantılı), ve setteki her girdinin bir render dalı olmalı (ölü girdi yok).
 * Nav dizileri/handleTabClick literal'leri BİLEREK taranmıyor: aynı desenler
 * alt-sekme menülerinde de geçiyor (adminTab 'overview', crmTab 'leads' vb.)
 * ve ayrım kaynak metinden güvenle yapılamıyor. Kaynak kod tarayan test
 * deseni emsali: useSekmeVerileri.test.ts ("hook döner, App kullanır").
 */

// process.cwd() = repo kökü (vitest oradan koşar). `new URL(..., import.meta.url)`
// KULLANILMAZ: Vite o deseni asset-dönüşümüne sokuyor, dizin yolunda
// "URL must be of scheme file" ile patlıyor.
import { join } from 'node:path';
const oku = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function renderDallari(): Set<string> {
  const kaynaklar = [oku('src/App.tsx')];
  for (const f of readdirSync(join(process.cwd(), 'src/pages')))
    if (f.endsWith('.tsx')) kaynaklar.push(oku(`src/pages/${f}`));
  const ids = new Set<string>();
  for (const src of kaynaklar)
    for (const m of src.matchAll(/activeTab\s*===\s*'([a-z][a-z0-9-]*)'/g))
      ids.add(m[1]);
  return ids;
}

describe('topLevelTabs — sürüklenme değişmezleri', () => {
  const dallar = renderDallari();

  it('tarama boş dönmüyor (desen App.tsx ile uyumlu)', () => {
    // Desen App.tsx yeniden düzenlenince sessizce 0 eşleşmeye düşmesin:
    // bilinen çekirdek sekmeler taramada MUTLAKA görünmeli.
    for (const bilinen of ['crm', 'inventory', 'muhasebe', 'admin', 'settings'])
      expect(dallar.has(bilinen), `tarama '${bilinen}' render dalını bulamadı — regex bayatladı`).toBe(true);
  });

  it('render dalı olan her sekme TOP_LEVEL_TABS içinde (derin bağlantı + URL senkronu)', () => {
    const eksik = [...dallar].filter(id => !TOP_LEVEL_TABS.has(id));
    expect(eksik, `Şu sekmelerin render dalı var ama sette yok: ${eksik.join(', ')} — src/lib/topLevelTabs.ts'e ekleyin`).toEqual([]);
  });

  it('setteki her girdinin render dalı var (ölü girdi yok)', () => {
    // 'dashboard' istisna: '/' yoluna eşlenir ve içerik `activeTab === 'dashboard'`
    // kıyası olmadan varsayılan dal olarak da render edilebilir.
    const olu = [...TOP_LEVEL_TABS].filter(id => id !== 'dashboard' && !dallar.has(id));
    expect(olu, `Set şu id'leri içeriyor ama hiçbir render dalı yok: ${olu.join(', ')} — ölü girdi ('finans' vakası) ya da tarama deseni eksik`).toEqual([]);
  });
});

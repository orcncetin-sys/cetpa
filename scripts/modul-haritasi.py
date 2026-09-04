#!/usr/bin/env python3
"""
modul-haritasi.py — docs/MODUL-HARITASI.md üreticisi (Faz 0, 2026-09-04).

Deterministik ölçümü (satır, kim import ediyor, test, kopya kod, koleksiyon,
Mikro/para bağımlılığı) HER koşuda yeniden çıkarır; ajan işlev özetlerini
docs/modul-haritasi-ajan.json'dan okur (o dosya workflow çıktısıdır, script
üretmez — yeni dosya eklenince o dosya "ajan özeti bekliyor" görünür).

Kullanım (repo kökünden):  python3 scripts/modul-haritasi.py
Neden var: sertleştirme serisinin (Faz 0-4) tek keşif kaynağı; sonraki fazlar
haritaya bakar, yeniden keşif yapmaz. Plan: Obsidian → Açık İşler → Modul-modul
sertlestirme serisi.
"""
import os, re, json, glob, html
from collections import defaultdict
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(KOK)
t = lambda s: re.sub(r'\s+', ' ', html.unescape(str(s or ''))).strip()

# ── 1) DETERMİNİSTİK ÖLÇÜM ──────────────────────────────────────────────
dosyalar = [f for f in glob.glob('src/**/*.ts', recursive=True) + glob.glob('src/**/*.tsx', recursive=True) + ['server.ts']
            if '.test.' not in f and not f.endswith('.d.ts')]
icerik = {f: open(f, encoding='utf-8', errors='replace').read() for f in dosyalar}
# scripts/*.mjs de tüketici sayılır (tenantBackup/storageBucket dersi)
for f in glob.glob('scripts/*.mjs') + glob.glob('scripts/*.ts'):
    icerik[f] = open(f, encoding='utf-8', errors='replace').read()

def cozumle(kaynak, hedef):
    if not hedef.startswith('.'): return None
    taban = re.sub(r'\.(js|ts)$', '', os.path.normpath(os.path.join(os.path.dirname(kaynak), hedef)))
    for aday in [taban + '.ts', taban + '.tsx', os.path.join(taban, 'index.ts'), os.path.join(taban, 'index.tsx')]:
        if aday in icerik: return aday
    return None
importEden = defaultdict(set)
for f, s in icerik.items():
    for m in re.finditer(r"""(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]""", s):
        h = cozumle(f, m.group(1))
        if h and h != f: importEden[h].add(f)
testler = {os.path.basename(x).replace('.test.tsx', '').replace('.test.ts', '') for x in glob.glob('src/**/*.test.ts*', recursive=True)}
GIRIS = {'server.ts', 'src/main.tsx', 'src/App.tsx', 'src/test/setup.ts'}
KOLL = re.compile(r"""(?:collection|doc)\(\s*db\s*,\s*['"]([A-Za-z0-9_]+)['"]""")
olcum = {}
for f in sorted(dosyalar):
    s = icerik[f]
    olcum[f] = {
        'satir': s.count('\n') + 1, 'importEden': len(importEden[f]),
        'test': os.path.basename(f).rsplit('.', 1)[0] in testler,
        'kopya': {'para': len(re.findall(r"toLocaleString\('tr-TR'", s)), 'tarih': len(re.findall(r"typeof .{0,40}\.toDate", s)),
                  'ceviri': len(re.findall(r"currentLanguage\s*===\s*'tr'\s*\?", s)), 'jspdf': len(re.findall(r"new jsPDF", s)),
                  'upper': len(re.findall(r"\.toUpperCase\(\)", s)), 'sifir': len(re.findall(r"(?:\|\||\?\?)\s*0\b", s))},
        'koleksiyonlar': sorted(set(KOLL.findall(s))),
        'mikro': bool(re.search(r"mikro(Service|Routes|Client|Mirror|Evrak)|useMikro|mikro_(stok|cari)", s)),
        'paraMatematigi': len(re.findall(r"\b(totalPrice|kdv|amount|subTotal|vatTotal|bakiye|tutar)\b", s)),
    }

# ── 2) AJAN ÖZETLERİ + DOĞRULANMIŞ DÜZELTMELER ──────────────────────────
ajan = {}
if os.path.exists('docs/modul-haritasi-ajan.json'):
    for x in json.load(open('docs/modul-haritasi-ajan.json', encoding='utf-8')):
        ajan[t(x['dosya']).split('cetpa-sales-&-logistics/')[-1]] = x
# Ajan yanlış-pozitifleri — grep ile ÇÜRÜTÜLDÜ (2026-09-04). Ajan ≤4 araç çağrısıyla
# "doğrulayamadım" dediğinde bu bulgu değil sorudur; grep 10 saniye.
for f in ['src/components/ApprovalQueue.tsx', 'src/components/BakimModule.tsx', 'src/components/BOMPanel.tsx', 'src/utils/belgeSablonu.ts']:
    if f in ajan:
        ajan[f]['risk'] = [r for r in ajan[f]['risk'] if r != 'tenant']
        ajan[f]['not'] = 'TENANT ŞÜPHESİ ÇÜRÜDÜ: koleksiyon collections.ts TENANT listesinde ve rbac.ts\'te var (grep 2026-09-04). ' + t(ajan[f].get('not'))
        if ajan[f]['durum'] == 'supheli' and not any(r in ajan[f]['risk'] for r in ('para', 'mikro')): ajan[f]['durum'] = 'saglam'
if 'src/components/LucaSyncPanel.tsx' in ajan:
    ajan['src/components/LucaSyncPanel.tsx'].update(durum='saglam', **{'not': 'Ajan "sync/fatura ve sync/stok rotası yok" demişti — server.ts:3463 ve :3528\'de VAR. Düzeltildi.'})

# ── 3) HARİTA ───────────────────────────────────────────────────────────
IKON = {'saglam': '✅', 'supheli': '⚠️', 'olu': '💀', 'hayalet': '👻', 'bilinmiyor': '❔'}
d = list(olcum.values()); top = lambda k: sum(x['kopya'][k] for x in d)
olu = [f for f, x in olcum.items() if x['importEden'] == 0 and not f.startswith('src/pages/') and f not in GIRIS]
L = ["# Cetpa Modül Haritası — Faz 0",
     f"\n> **Üretim:** `python3 scripts/modul-haritasi.py` · deterministik ölçüm (her koşuda yenilenir) + {len(ajan)}/{len(olcum)} dosya için ajan işlev özeti (`docs/modul-haritasi-ajan.json`) + grep ile doğrulanmış düzeltmeler.",
     "> **Amaç:** Sertleştirme serisinin (Faz 0-4) tek keşif kaynağı. **Sonraki fazlar bu dosyaya bakar, yeniden keşif yapmaz.**",
     "> **Plan:** Obsidian → `Açık İşler/Modul-modul sertlestirme serisi (Faz 0-4).md`\n",
     "## 0. Nasıl okunur\n", "| Sütun | Anlam |\n|---|---|",
     "| **durum** | ✅ sağlam · ⚠️ şüpheli (bir arıza sınıfı ölçüldü) · 💀 ölü (kimse import etmiyor) · 👻 hayalet (import ediliyor ama işlevi kimseye ulaşmıyor) · ❔ bilinmiyor |",
     "| **risk** | para · tenant · mikro · pdf · belge · ui · altyapi · guvenlik — Faz 3 sırasını belirler |",
     "| **`\\|\\|0`** | sayısal `\\|\\| 0` / `?? 0` — CLAUDE.md \"sahte kesinlik\" yasağının ihlal adayı |",
     "| **imp** | kaç dosya import ediyor (0 = ölü aday; giriş noktaları ve `scripts/` tüketicileri sayılır) |\n",
     "## A. Sayılarla durum (deterministik)\n", "| Ölçüm | Değer |\n|---|---|",
     f"| Dosya / satır | {len(d)} / {sum(x['satir'] for x in d):,} |",
     f"| Testi olan dosya | {sum(1 for x in d if x['test'])} ({sum(1 for f,x in olcum.items() if x['test'] and f.startswith(('src/components','src/pages')))} tanesi ekran) |",
     f"| Hiçbir yerden import edilmeyen | {len(olu)} |",
     f"| Mikro'ya dokunan | {sum(1 for x in d if x['mikro'])} — testsiz: {sum(1 for x in d if x['mikro'] and not x['test'])} |",
     f"| Para matematiği yoğun (≥10) | {sum(1 for x in d if x['paraMatematigi']>=10)} — testsiz: {sum(1 for x in d if x['paraMatematigi']>=10 and not x['test'])} |",
     f"| `\\|\\| 0` / `?? 0` | **{top('sifir'):,}** yer |", f"| Elle para formatı | {top('para')} yer |", f"| Elle tarih parse | {top('tarih')} yer |",
     f"| Inline çeviri | {top('ceviri'):,} yer |", f"| `new jsPDF` | {top('jspdf')} yer |",
     "\n## B. Faz 1 sırası — TESTSİZ + PARA YOĞUN\n", "| Dosya | Satır | Para eşl. | `\\|\\|0` | Mikro | Koleksiyonlar |\n|---|---|---|---|---|---|"]
for f, x in sorted([(f, x) for f, x in olcum.items() if not x['test'] and x['paraMatematigi'] >= 10], key=lambda p: -p[1]['paraMatematigi'])[:20]:
    L.append(f"| `{f}` | {x['satir']:,} | {x['paraMatematigi']} | {x['kopya']['sifir']} | {'✓' if x['mikro'] else ''} | {', '.join(x['koleksiyonlar'][:5])}{'…' if len(x['koleksiyonlar'])>5 else ''} |")
L += ["\n## C. Faz 2 sırası — KOPYA KOD en yoğun 15\n", "| Dosya | para | tarih | çeviri | `\\|\\|0` | toplam |\n|---|---|---|---|---|---|"]
for f, x in sorted(olcum.items(), key=lambda p: -(p[1]['kopya']['para'] + p[1]['kopya']['tarih'] + p[1]['kopya']['sifir']))[:15]:
    k = x['kopya']; L.append(f"| `{f}` | {k['para']} | {k['tarih']} | {k['ceviri']} | {k['sifir']} | {k['para']+k['tarih']+k['sifir']} |")
L += ["\n## D. Faz 4 adayları — import edilmeyen (giriş noktaları ve scripts/ tüketicileri hariç)\n"] + [f"- `{f}` — {olcum[f]['satir']} satır, test: {'VAR' if olcum[f]['test'] else 'yok'}" for f in olu]
kol = defaultdict(list)
for f, x in olcum.items():
    for c in x['koleksiyonlar']: kol[c].append(os.path.basename(f))
tek = sorted(c for c, fs in kol.items() if len(fs) == 1)
L += [f"\n## E. Koleksiyon → dosya\n\n{len(kol)} koleksiyona kod dokunuyor; **{len(tek)} koleksiyona yalnız TEK dosya** (kapalı-devre adayı — tek dosyanın hem yazıp hem okuması normaldir; Faz 4 tek tek ayırır):\n"] + [f"- `{c}` → `{kol[c][0]}`" for c in tek]
L.append("\n## F. Dosya dosya harita\n")
dizinler = defaultdict(list)
for f in olcum: dizinler[os.path.dirname(f) or '.'].append(f)
eksik = 0
for dz in sorted(dizinler):
    fs = sorted(dizinler[dz])
    L += [f"\n### `{dz}/` — {len(fs)} dosya, {sum(olcum[f]['satir'] for f in fs):,} satır\n", "| Dosya | Satır | Test | imp | `\\|\\|0` | Durum | Risk | İşlev | Not |\n|---|---|---|---|---|---|---|---|---|"]
    for f in fs:
        o = olcum[f]; a = ajan.get(f)
        if a: durum, risk, islev, nott = f"{IKON.get(a['durum'],'')} {a['durum']}", ', '.join(a['risk']), t(a['islev']), t(a.get('not'))[:300]
        else: eksik += 1; durum, risk, islev, nott = '⏳', '', '_(ajan özeti bekliyor)_', ''
        L.append(f"| `{os.path.basename(f)}` | {o['satir']:,} | {'✓' if o['test'] else ''} | {o['importEden']} | {o['kopya']['sifir'] or ''} | {durum} | {risk} | {islev} | {nott} |")
L += ["\n## G. Ajan yanlış-pozitifleri — grep ile çürütüldü\n",
      "- `LucaSyncPanel.tsx` \"rota yok\" → `server.ts:3463`, `:3528`'de VAR",
      "- `ApprovalQueue`/`BakimModule`/`BOMPanel`/`belgeSablonu` \"TENANT listesinde olmayabilir\" → hepsi `collections.ts` + `rbac.ts`'te VAR",
      "- `server.ts`, `App.tsx` importEden=0 → giriş noktaları; `tenantBackup`/`storageBucket` → `scripts/*.mjs` tüketiyor (artık ölçüme dahil)",
      "\n**Ders:** \"importEden=0\" tek başına ölü demek değil; ajan \"doğrulayamadım\" dediğinde bu bulgu değil sorudur — grep 10 saniye."]
open('docs/MODUL-HARITASI.md', 'w', encoding='utf-8').write('\n'.join(L))
sayim = defaultdict(int)
for a in ajan.values(): sayim[a['durum']] += 1
print(f"docs/MODUL-HARITASI.md: {len(L)} satır · {len(olcum)} dosya · ajan özeti {len(ajan)} (eksik {eksik}) · {dict(sayim)} · ölü aday {len(olu)}")

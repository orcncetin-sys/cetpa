#!/usr/bin/env python3
"""
modul-sozluk-kodmod.py — BİR modülün (dosyanın) kalan satır içi çevirilerini o modülün sözlüğüne taşır (Faz 3).

ORTAK sözlük (ceviri-kodmod.py) yalnız tekrarlayan ifadeleri aldı; tek geçen ~4.150 ifade yerinde kaldı. Faz 3
"modül kapatma"da o modülün kalan ifadeleri kendi sözlüğüne (`src/i18n/<modul>.ts`) alınır: anahtar Türkçe metnin
slug'ı, erişim `<ad>(dil).<anahtar>` (dil kodu ya da eski boolean bayrak). Deterministik ve idempotent.
  python3 scripts/modul-sozluk-kodmod.py src/pages/MuhasebePage.tsx muhasebe mc
    → src/i18n/muhasebe.ts (MUHASEBE sözlüğü + mc()) üretilir/güncellenir, dosya değiştirilir.
"""
import os
import re
import sys
import unicodedata

KOK = os.environ.get('KODMOD_KOK') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # KODMOD_KOK: yalnız test için kök değiştirme
KOSUL = r"(?P<kosul>(?:currentLanguage|lang|language)\s*===\s*'tr'|\b(?:tr\d*|isTR|isTr))"
DESEN = re.compile(
    KOSUL
    + r"\s*\?\s*(?P<q1>['\"])(?P<a>(?:\\.|(?!(?P=q1)).)*)(?P=q1)\s*:\s*(?P<q2>['\"])(?P<b>(?:\\.|(?!(?P=q2)).)*)(?P=q2)"
)
TRMAP = str.maketrans('çğıöşüÇĞİÖŞÜ', 'cgiosucgiosu')


def slug(t):
    t = t.replace('İ', 'i').replace('I', 'ı').lower().translate(TRMAP)
    t = unicodedata.normalize('NFKD', t).encode('ascii', 'ignore').decode()
    t = re.sub(r'[^a-z0-9]+', '_', t).strip('_')
    if not t:
        t = 'x'
    if t[0].isdigit():
        t = '_' + t
    return t[:48]


def js(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


def ifade(kosul):
    m = re.match(r"(currentLanguage|lang|language)\s*===\s*'tr'", kosul)
    return m.group(1) if m else kosul


def goreli(p):
    derin = os.path.relpath(p, os.path.join(KOK, 'src')).count('/')
    return ('./' if derin == 0 else '../' * derin) + 'i18n/'


def kapsam_oku(m):
    k = re.search(r"^ \* Kapsam: (.*)$", m, re.M)
    return [x.strip() for x in k.group(1).split(',') if x.strip()] if k else []


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(2)
    dosya, modul, ad = sys.argv[1], sys.argv[2], sys.argv[3]
    p = os.path.join(KOK, dosya)
    s = open(p, encoding='utf-8').read()
    sozluk = {}   # anahtar -> (tr, en)   — yalnız düz-string çiftler (kodmodun taşıdığı/taşıyabileceği)
    ters = {}     # (tr, en) -> anahtar
    tum_anahtarlar = set()   # fonksiyon değerli / çift tırnaklı elle girdiler dâhil — slug çakışmasın
    n = 0
    # MEVCUT sözlükle birleştir (2026-09-14): önceki koşuda taşınmış anahtarlar artık satır içinde olmadığından
    # yeniden bulunmaz — birleştirilmezse ikinci koşu 345 anahtarı silip tsc'yi kırardı. 2/n: dosya varsa
    # SIFIRDAN ÜRETİLMEZ, yalnız yeni anahtarlar tr/en bloklarının sonuna EKLENİR — elle yazılmış girdiler
    # (fonksiyon değerli `csvImported: (n) => ...`, çift tırnaklı metin) ve elle düzenlenen erişimci korunur.
    mevcut = os.path.join(KOK, f'src/i18n/{modul}.ts')
    var = os.path.exists(mevcut)
    m = open(mevcut, encoding='utf-8').read() if var else ''
    if var:
        def oku(blok):
            # Anahtar [A-Za-z0-9_]: elle yazılmış camelCase sözlükler (AccountingModule `AT`) de birleşebilsin (2/n).
            return {a: b.replace("\\'", "'").replace('\\\\', '\\') for a, b in re.findall(r"^\s*([A-Za-z0-9_]+): '((?:\\.|[^'\\])*)',$", blok, re.M)}
        tr_b = re.search(r"tr: \{\n(.*?)\n  \},", m, re.S)
        en_b = re.search(r"en: \{\n(.*?)\n  \},", m, re.S)
        if not (tr_b and en_b):
            print(f"HATA: {mevcut} var ama `  tr: {{` / `  en: {{` blokları çözülemedi — elle bak.")
            sys.exit(2)
        t, e = oku(tr_b.group(1)), oku(en_b.group(1))
        for anahtar in t:
            if anahtar in e:
                sozluk[anahtar] = (t[anahtar], e[anahtar])
                ters[(t[anahtar], e[anahtar])] = anahtar
        tum_anahtarlar = set(re.findall(r"^\s*([A-Za-z0-9_]+):", tr_b.group(1), re.M)) | set(re.findall(r"^\s*([A-Za-z0-9_]+):", en_b.group(1), re.M))
    yeni_anahtarlar = {}

    def yer(mm):
        nonlocal n
        a = mm.group('a').replace("\\'", "'")
        b = mm.group('b').replace("\\'", "'")
        if '${' in a or '${' in b or not a.strip() or not b.strip() or a == b:
            return mm.group(0)
        if a.strip().lower() in ('tr', 'en', 'tr-tr', 'en-us'):
            return mm.group(0)
        k = ters.get((a, b))
        if not k:
            k = slug(a)
            base, i = k, 2
            while k in sozluk or k in tum_anahtarlar:
                k = f"{base}_{i}"
                i += 1
            sozluk[k] = (a, b)
            yeni_anahtarlar[k] = (a, b)
            ters[(a, b)] = k
            tum_anahtarlar.add(k)
        n += 1
        return f"{ad}({ifade(mm.group('kosul'))}).{k}"

    # Yorum satırlarına DOKUNMA (`//`, `*`, `/*` ile başlayan): oradaki 'çift' kod değil metindir; 4/n ve
    # Faz 3 1/n'de birer yorum satırı sözlüğe girdi, elle geri alındı (degismez testi de yorumları saymaz).
    yeni = '\n'.join(l if re.match(r'\s*(//|\*|/\*)', l) else DESEN.sub(yer, l) for l in s.split('\n'))
    if not n:
        # Çift kalmamış dosya da Kapsam'a girer: değişmez testi Kapsam'dan okur — listede olmayan dosyaya SONRADAN
        # eklenen satır içi çifti hiçbir test yakalamaz (2026-09-19: accounting sözlüğünde 22 dosyanın 7'si dışarıdaydı).
        if var and dosya not in kapsam_oku(m) and re.search(r"^ \* Kapsam: ", m, re.M):
            m = re.sub(r"^ \* Kapsam: .*$", " * Kapsam: " + ", ".join(kapsam_oku(m) + [dosya]), m, count=1, flags=re.M)
            open(mevcut, 'w', encoding='utf-8').write(m)
            print(f'değişecek ifade yok; dosya Kapsam\'a eklendi (sözlükte {len(sozluk)} anahtar korunuyor)')
            return
        print(f'değişecek ifade yok (sözlükte {len(sozluk)} anahtar korunuyor)')
        return
    sabit = modul.upper()
    os.makedirs(os.path.join(KOK, 'src/i18n'), exist_ok=True)
    if var:
        # EKLEME modu: yeni anahtarlar blok sonlarına; Kapsam satırı bu dosyayı da içersin (degismez testi buradan okur).
        ek_tr = ''.join(f"    {k}: {js(a)},\n" for k, (a, b) in yeni_anahtarlar.items())
        ek_en = ''.join(f"    {k}: {js(b)},\n" for k, (a, b) in yeni_anahtarlar.items())
        m = re.sub(r"(tr: \{\n.*?\n)(  \},)", lambda x: x.group(1) + ek_tr + x.group(2), m, count=1, flags=re.S)
        m = re.sub(r"(en: \{\n.*?\n)(  \},)", lambda x: x.group(1) + ek_en + x.group(2), m, count=1, flags=re.S)
        kapsam = kapsam_oku(m)
        if dosya not in kapsam:
            kapsam.append(dosya)
            if re.search(r"^ \* Kapsam: ", m, re.M):
                m = re.sub(r"^ \* Kapsam: .*$", " * Kapsam: " + ", ".join(kapsam), m, count=1, flags=re.M)
            else:
                m = m.replace("\n */\n", "\n * Kapsam: " + ", ".join(kapsam) + "\n */\n", 1)
        icerik = m
    else:
        icerik = (
            f"/**\n * {modul}.ts — {dosya} modülünün KENDİ çeviri sözlüğü (Faz 3 modül kapatma; ÜRETİLMİŞ — scripts/modul-sozluk-kodmod.py).\n"
            f" * Tekrarlayan ifadeler src/i18n/ortak.ts'te; buradakiler bu modüle özgü. Anahtar = Türkçe metnin slug'ı.\n"
            f" * Kullanım: `{ad}(currentLanguage).<anahtar>` (dil kodu ya da eski boolean bayrak).\n"
            f" * Kapsam: {dosya}\n */\n"
            f"export const {sabit} = {{\n  tr: {{\n"
            + "\n".join(f"    {k}: {js(a)}," for k, (a, b) in sozluk.items())
            + "\n  },\n  en: {\n"   # DÜZ dizge (f değil): tek süslü — 2026-09-19: çift süslü sıfırdan üretimde bozuk TS yazıyordu (yol ilk kez 4/n'de koştu)
            + "\n".join(f"    {k}: {js(b)}," for k, (a, b) in sozluk.items())
            + "\n  },\n} as const;\n\n"
            f"export type {sabit.title()}Anahtar = keyof typeof {sabit}.tr;\n"
            f"type Sozluk = {{ readonly [K in {sabit.title()}Anahtar]: string }};\n\n"
            f"export function {ad}(dil: 'tr' | 'en' | boolean | string | undefined): Sozluk {{\n"
            f"  const tr = dil === true || dil === 'tr' || dil === undefined;\n"
            f"  return (tr ? {sabit}.tr : {sabit}.en) as Sozluk;\n}}\n"
        )
    open(mevcut, 'w', encoding='utf-8').write(icerik)
    if not re.search(rf"from '[^']*i18n/{modul}'", yeni):
        son = list(re.finditer(r"^import .*?;$", yeni, re.M))
        ek = f"import {{ {ad} }} from '{goreli(p)}{modul}';"
        yeni = (yeni[:son[-1].end()] + "\n" + ek + yeni[son[-1].end():]) if son else ek + "\n" + yeni
    open(p, 'w', encoding='utf-8').write(yeni)
    print(f"{n} yer -> {ad}(...).<anahtar>; {len(yeni_anahtarlar)} yeni anahtar ({len(sozluk)} toplam) -> src/i18n/{modul}.ts ({'eklendi' if var else 'üretildi'})")

if __name__ == '__main__':
    main()

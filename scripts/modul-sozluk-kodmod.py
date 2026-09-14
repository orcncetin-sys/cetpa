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

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(2)
    dosya, modul, ad = sys.argv[1], sys.argv[2], sys.argv[3]
    p = os.path.join(KOK, dosya)
    s = open(p, encoding='utf-8').read()
    sozluk = {}   # anahtar -> (tr, en)
    ters = {}     # (tr, en) -> anahtar
    n = 0
    # MEVCUT sözlükle birleştir: dosya sıfırdan üretilir; önceki koşuda taşınmış anahtarlar artık satır içinde
    # olmadığından yeniden bulunmaz — birleştirilmezse ikinci koşu 345 anahtarı silip tsc'yi kırardı (2026-09-14).
    mevcut = os.path.join(KOK, f'src/i18n/{modul}.ts')
    if os.path.exists(mevcut):
        m = open(mevcut, encoding='utf-8').read()
        def oku(blok):
            return {a: b.replace("\\'", "'").replace('\\\\', '\\') for a, b in re.findall(r"^\s*([a-z0-9_]+): '((?:\\.|[^'\\])*)',$", blok, re.M)}
        tr_b = re.search(r"tr: \{\n(.*?)\n  \},", m, re.S)
        en_b = re.search(r"en: \{\n(.*?)\n  \},", m, re.S)
        if tr_b and en_b:
            t, e = oku(tr_b.group(1)), oku(en_b.group(1))
            for anahtar in t:
                if anahtar in e:
                    sozluk[anahtar] = (t[anahtar], e[anahtar])
                    ters[(t[anahtar], e[anahtar])] = anahtar

    def yer(m):
        nonlocal n
        a = m.group('a').replace("\\'", "'")
        b = m.group('b').replace("\\'", "'")
        if '${' in a or '${' in b or not a.strip() or not b.strip() or a == b:
            return m.group(0)
        if a.strip().lower() in ('tr', 'en', 'tr-tr', 'en-us'):
            return m.group(0)
        k = ters.get((a, b))
        if not k:
            k = slug(a)
            base, i = k, 2
            while k in sozluk:
                k = f"{base}_{i}"
                i += 1
            sozluk[k] = (a, b)
            ters[(a, b)] = k
        n += 1
        return f"{ad}({ifade(m.group('kosul'))}).{k}"

    # Yorum satırlarına DOKUNMA (`//`, `*`, `/*` ile başlayan): oradaki 'çift' kod değil metindir; 4/n ve
    # Faz 3 1/n'de birer yorum satırı sözlüğe girdi, elle geri alındı (degismez testi de yorumları saymaz).
    yeni = '\n'.join(l if re.match(r'\s*(//|\*|/\*)', l) else DESEN.sub(yer, l) for l in s.split('\n'))
    if not n:
        print(f'değişecek ifade yok (sözlükte {len(sozluk)} anahtar korunuyor)')
        return
    sabit = modul.upper()
    icerik = (
        f"/**\n * {modul}.ts — {dosya} modülünün KENDİ çeviri sözlüğü (Faz 3 modül kapatma; ÜRETİLMİŞ — scripts/modul-sozluk-kodmod.py).\n"
        f" * Tekrarlayan ifadeler src/i18n/ortak.ts'te; buradakiler bu modüle özgü. Anahtar = Türkçe metnin slug'ı.\n"
        f" * Kullanım: `{ad}(currentLanguage).<anahtar>` (dil kodu ya da eski boolean bayrak).\n */\n"
        f"export const {sabit} = {{\n  tr: {{\n"
        + "\n".join(f"    {k}: {js(a)}," for k, (a, b) in sozluk.items())
        + "\n  },\n  en: {\n"
        + "\n".join(f"    {k}: {js(b)}," for k, (a, b) in sozluk.items())
        + "\n  },\n} as const;\n\n"
        f"export type {sabit.title()}Anahtar = keyof typeof {sabit}.tr;\n"
        f"type Sozluk = {{ readonly [K in {sabit.title()}Anahtar]: string }};\n\n"
        f"export function {ad}(dil: 'tr' | 'en' | boolean | string | undefined): Sozluk {{\n"
        f"  const tr = dil === true || dil === 'tr' || dil === undefined;\n"
        f"  return (tr ? {sabit}.tr : {sabit}.en) as Sozluk;\n}}\n"
    )
    os.makedirs(os.path.join(KOK, 'src/i18n'), exist_ok=True)
    open(os.path.join(KOK, f'src/i18n/{modul}.ts'), 'w', encoding='utf-8').write(icerik)
    if not re.search(rf"from '[^']*i18n/{modul}'", yeni):
        son = list(re.finditer(r"^import .*?;$", yeni, re.M))
        ek = f"import {{ {ad} }} from '{goreli(p)}{modul}';"
        yeni = (yeni[:son[-1].end()] + "\n" + ek + yeni[son[-1].end():]) if son else ek + "\n" + yeni
    open(p, 'w', encoding='utf-8').write(yeni)
    print(f"{n} yer -> {ad}(...).<anahtar>; {len(sozluk)} anahtar -> src/i18n/{modul}.ts")


if __name__ == '__main__':
    main()

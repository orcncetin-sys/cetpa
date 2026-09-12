#!/usr/bin/env python3
"""
ceviri-kodmod.py — satır içi `currentLanguage === 'tr' ? 'A' : 'B'` çiftlerini ORTAK sözlüğe taşır (Faz 2 4/n).

Kural: yalnız src/i18n/ortak.ts'te (tr, en) çifti BİREBİR bulunan ifadeler değişir; tek geçen ya da bağlama özel
çeviriler yerinde kalır. Koşul biçimleri: `currentLanguage === 'tr'`, `lang === 'tr'`, `language === 'tr'`,
`tr` / `tr63` / `isTR` / `isTr` (boolean bayrak). Sonuç: `oc(<ifade>).<anahtar>`; gerekirse import eklenir.
Deterministiktir; tsc + testler + ortak.degismez.test.ts ile doğrulanır. Tekrar koşmak güvenlidir (idempotent).
  python3 scripts/ceviri-kodmod.py            # uygula
  python3 scripts/ceviri-kodmod.py --kuru     # yalnız say
"""
import re
import os
import sys

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KURU = '--kuru' in sys.argv


def sozluk():
    s = open(os.path.join(KOK, 'src/i18n/ortak.ts'), encoding='utf-8').read()
    tr = re.search(r"tr: \{\n(.*?)\n  \},", s, re.S).group(1)
    en = re.search(r"en: \{\n(.*?)\n  \},", s, re.S).group(1)

    def oku(blok):
        out = {}
        for m in re.finditer(r"^\s*([a-z0-9_]+): '((?:\\.|[^'\\])*)',", blok, re.M):
            out[m.group(1)] = m.group(2).replace("\\'", "'").replace('\\\\', '\\')
        return out

    t, e = oku(tr), oku(en)
    return {(t[k], e[k]): k for k in t if k in e}


KOSUL = r"(?P<kosul>(?:currentLanguage|lang|language)\s*===\s*'tr'|\b(?:tr\d*|isTR|isTr))"
DESEN = re.compile(
    KOSUL
    + r"\s*\?\s*(?P<q1>['\"])(?P<a>(?:\\.|(?!(?P=q1)).)*)(?P=q1)\s*:\s*(?P<q2>['\"])(?P<b>(?:\\.|(?!(?P=q2)).)*)(?P=q2)"
)


def ifade(kosul):
    m = re.match(r"(currentLanguage|lang|language)\s*===\s*'tr'", kosul)
    return m.group(1) if m else kosul


def goreli(p):
    derin = os.path.relpath(p, os.path.join(KOK, 'src')).count('/')
    return ('./' if derin == 0 else '../' * derin) + 'i18n/ortak'


def main():
    S = sozluk()
    toplam = 0
    dosyalar = 0
    for d, _, fs in os.walk(os.path.join(KOK, 'src')):
        for f in fs:
            p = os.path.join(d, f)
            rel = os.path.relpath(p, KOK)
            if not p.endswith(('.ts', '.tsx')) or '.test.' in f or rel.startswith(('src/server', 'src/i18n')):
                continue
            s = open(p, encoding='utf-8').read()
            n = 0

            def yer(m):
                nonlocal n
                a = m.group('a').replace("\\'", "'")
                b = m.group('b').replace("\\'", "'")
                k = S.get((a, b))
                if not k:
                    return m.group(0)
                n += 1
                return f"oc({ifade(m.group('kosul'))}).{k}"

            yeni = DESEN.sub(yer, s)
            if n and not KURU:
                if not re.search(r"from '[^']*i18n/ortak'", yeni):
                    son = list(re.finditer(r"^import .*?;$", yeni, re.M))
                    ek = f"import {{ oc }} from '{goreli(p)}';"
                    yeni = (yeni[:son[-1].end()] + "\n" + ek + yeni[son[-1].end():]) if son else ek + "\n" + yeni
                open(p, 'w', encoding='utf-8').write(yeni)
            if n:
                toplam += n
                dosyalar += 1
    print(f"{'[kuru] ' if KURU else ''}{toplam} yer, {dosyalar} dosya -> oc(...).<anahtar>")


if __name__ == '__main__':
    main()

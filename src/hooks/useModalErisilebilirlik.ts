import { useEffect, useRef } from 'react';

/**
 * useModalErisilebilirlik — modal diyaloglar için klavye + fokus davranışı.
 *
 * A11y teşhisi (2026-08-28): ProductForm ve AddShipmentModal'da ESC yok,
 * fokus tuzağı yok, `role="dialog"` yok — klavye kullanıcısı modalı
 * kapatamıyor, Tab arkadaki sayfaya kaçıyor, ekran okuyucu modalın
 * açıldığını anlamıyordu. Aynı deseni her modala elle kopyalamak yerine
 * tek hook: ileride diğer modallar da bunu kullanır.
 *
 * ## Ne yapar (WAI-ARIA dialog deseninin çekirdeği)
 *
 * 1. **ESC kapatır** — `onClose` çağrılır. Kirli-form uyarısı gerekiyorsa
 *    çağıran, kendi `onClose`'unda sorar; hook karışmaz.
 * 2. **Açılışta fokus içeri girer** — ilk fokuslanabilir elemana (yoksa
 *    kapsayıcıya).
 * 3. **Tab döngüsü** — fokus modalın içinde sarmalanır (son elemanda Tab →
 *    ilk eleman; ilkte Shift+Tab → son).
 * 4. **Kapanışta fokus geri döner** — modalı açan elemana; klavye
 *    kullanıcısı kaldığı yerden devam eder.
 *
 * ## Kullanım
 *
 *   const dialogRef = useModalErisilebilirlik(isOpen, onClose);
 *   <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="...">
 *
 * `role`/`aria-modal`/`aria-label` çağıranın sorumluluğunda — hook DOM'a
 * nitelik yazmaz, yalnız davranış ekler (görünümü değiştirmez).
 */

const FOKUSLANABILIR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalErisilebilirlik(
  acik: boolean,
  onClose: () => void,
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  // onClose her render'da yeni closure olabilir — efekt onu bağımlılığa
  // almasın diye ref (aksi hâlde her render'da dinleyici söküp takılır).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!acik) return;
    const kok = ref.current;
    if (!kok) return;

    const acan = document.activeElement as HTMLElement | null;

    // Açılışta fokus içeri — bir frame bekle ki içerik render olsun.
    const t = setTimeout(() => {
      const ilk = kok.querySelector<HTMLElement>(FOKUSLANABILIR);
      (ilk ?? kok).focus();
    }, 0);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !kok) return;
      const hepsi = [...kok.querySelectorAll<HTMLElement>(FOKUSLANABILIR)]
        .filter(el => el.offsetParent !== null); // görünmeyenleri atla
      if (hepsi.length === 0) return;
      const ilk = hepsi[0];
      const son = hepsi[hepsi.length - 1];
      if (e.shiftKey && document.activeElement === ilk) {
        e.preventDefault(); son.focus();
      } else if (!e.shiftKey && document.activeElement === son) {
        e.preventDefault(); ilk.focus();
      }
    }

    kok.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(t);
      kok.removeEventListener('keydown', onKeyDown);
      // Fokus, modalı açan elemana geri dönsün.
      acan?.focus?.();
    };
  }, [acik]);

  return ref;
}

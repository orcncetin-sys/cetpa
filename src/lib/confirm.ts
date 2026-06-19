// Global imperative onay diyaloğu.
// Herhangi bir modül `await confirmAction({...})` veya `await confirmDelete(ad)`
// çağırarak, App kökünde bir kez mount edilen GlobalConfirm host'u üzerinden
// kullanıcıya "emin misiniz?" sorusunu gösterir ve true/false döner.

export type ConfirmOpts = {
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
};

let resolver: ((v: boolean) => void) | null = null;
let listener: ((opts: ConfirmOpts | null) => void) | null = null;

/** Onay diyaloğunu açar; kullanıcı onaylarsa true, vazgeçerse false döner. */
export function confirmAction(opts: ConfirmOpts): Promise<boolean> {
  // Host bağlı değilse (ör. test ortamı) güvenli varsayılan: onaylama.
  if (!listener) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    // Önceki bekleyen bir diyalog varsa onu iptal et.
    resolver?.(false);
    resolver = resolve;
    listener?.(opts);
  });
}

/** Silme işlemleri için hazır onay. */
export function confirmDelete(name?: string, lang: 'tr' | 'en' = 'tr'): Promise<boolean> {
  return confirmAction(
    lang === 'tr'
      ? {
          title: 'Silme Onayı',
          message: name
            ? `"${name}" kalıcı olarak silinecek. Bu işlem geri alınamaz. Emin misiniz?`
            : 'Bu kayıt kalıcı olarak silinecek. Bu işlem geri alınamaz. Emin misiniz?',
          confirmLabel: 'Sil',
          variant: 'danger',
        }
      : {
          title: 'Confirm Delete',
          message: name
            ? `"${name}" will be permanently deleted. This cannot be undone. Are you sure?`
            : 'This record will be permanently deleted. This cannot be undone. Are you sure?',
          confirmLabel: 'Delete',
          variant: 'danger',
        },
  );
}

// ── Host (GlobalConfirm) tarafından kullanılan iç API ──────────────────────
export function _registerConfirmListener(fn: (opts: ConfirmOpts | null) => void): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function _resolveConfirm(v: boolean): void {
  const r = resolver;
  resolver = null;
  r?.(v);
}

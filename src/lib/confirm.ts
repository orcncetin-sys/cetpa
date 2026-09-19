// Global imperative onay diyaloğu.
// Herhangi bir modül `await confirmAction({...})` veya `await confirmDelete(ad)`
// çağırarak, App kökünde bir kez mount edilen GlobalConfirm host'u üzerinden
// kullanıcıya "emin misiniz?" sorusunu gösterir ve true/false döner.

export type ConfirmOpts = {
  title: string;
  message: string;
  confirmLabel?: string;
  /** "Vazgeç" düğmesinin metni. Verilmezse aktif dilden türetilir. */
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
};

let resolver: ((v: boolean) => void) | null = null;
let listener: ((opts: ConfirmOpts | null) => void) | null = null;

/**
 * Diyaloğun dili. ConfirmModal'ın `cancelText` varsayılanı sabit 'Vazgeç' —
 * modüller bunu tek tek `cancelText` prop'uyla eziyordu; imperative yola
 * geçince o bilgi kayboluyor ve İngilizce kullanan "Vazgeç" görüyordu.
 * App açılışta bir kez `setConfirmLanguage` çağırır, çağrı noktalarının
 * her seferinde dil geçmesi gerekmez.
 */
let confirmLang: 'tr' | 'en' = 'tr';

export function setConfirmLanguage(l: 'tr' | 'en'): void {
  confirmLang = l;
}

/**
 * Şu an kullanıcının önünde AÇIK bir onay penceresi var mı? `confirmAction` bekleyen diyaloğu sessizce iptal edip
 * yerine geçer — bu, kullanıcı HAREKETİYLE açılan pencerelerde zararsızdır (tam ekran pencere açıkken ikinci bir
 * tıklama yapılamaz). Ama bir `await` zincirinin sonunda KENDİLİĞİNDEN açılan onay (ör. "Kargoda" sonrası e-İrsaliye
 * teklifi) o sırada açık olan BAŞKA bir onayın yerine geçebilir; kullanıcının diğer iş için vereceği "Onayla" tıklaması
 * resmî belge onayına dönüşür (2026-09-19 uçtan uca inceleme). Kendiliğinden açan çağıran ÖNCE bunu sorar.
 */
export function onayAcikMi(): boolean {
  return resolver !== null;
}

/** Onay diyaloğunu açar; kullanıcı onaylarsa true, vazgeçerse false döner. */
export function confirmAction(opts: ConfirmOpts): Promise<boolean> {
  // Host (GlobalConfirm) bağlı değilse GÜVENLİ TARAF "hayır"dır.
  //
  // Burası eskiden `true` dönüyordu ("test ortamı" gerekçesiyle) — yani diyalog
  // hiç gösterilemediğinde işlem ONAYLANMIŞ sayılıyor, kullanıcı hiçbir şey
  // görmeden kayıt siliniyordu. Fail-OPEN bir silme onayı. Depoda confirm.ts'e
  // dokunan tek bir test bile yok, yani o gerekçe de karşılıksızdı.
  // 2026-08-17'de 16 modül daha (Muhasebe'nin banka/yevmiye/cari/tedarikçi
  // silmeleri, İK'nın bordro+izin+eğitim kaskadıyla çalışan silmesi) bu
  // fonksiyona bağlandığı için fail-closed'a çevrildi: diyalog gösterilemiyorsa
  // yıkıcı işlem YAPILMAZ.
  if (!listener) {
    console.error('[confirm] GlobalConfirm host bağlı değil — işlem iptal edildi.');
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    // Önceki bekleyen bir diyalog varsa onu iptal et.
    resolver?.(false);
    resolver = resolve;
    listener?.({
      ...opts,
      cancelLabel: opts.cancelLabel ?? (confirmLang === 'tr' ? 'Vazgeç' : 'Cancel'),
    });
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
          cancelLabel: 'Vazgeç',
          variant: 'danger',
        }
      : {
          title: 'Confirm Delete',
          message: name
            ? `"${name}" will be permanently deleted. This cannot be undone. Are you sure?`
            : 'This record will be permanently deleted. This cannot be undone. Are you sure?',
          confirmLabel: 'Delete',
          cancelLabel: 'Cancel',
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

import { useState } from 'react';
import { z } from 'zod';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Clock } from 'lucide-react';

// ── Schema ────────────────────────────────────────────────────────────────────
const NewLeadSchema = z.object({
  name:              z.string().min(2, { message: 'tr:En az 2 karakter|en:Min 2 characters' }),
  company:           z.string().min(1, { message: 'tr:Zorunlu|en:Required' }),
  email:             z.union([z.string().email({ message: 'tr:Geçerli e-posta girin|en:Enter a valid email' }), z.literal('')]),
  phone:             z.string().optional(),
  address:           z.string().optional(),
  taxOffice:         z.string().optional(),
  taxId:             z.string().regex(/^$|^\d{10}$|^\d{11}$/, { message: 'tr:10 veya 11 haneli olmalı|en:Must be 10–11 digits' }),
  sector:            z.string().optional(),
  authorizedContact: z.string().optional(),
  notes:             z.string().max(2000, { message: 'tr:Maks 2000 karakter|en:Max 2000 chars' }).optional(),
});

export type NewLeadData = z.infer<typeof NewLeadSchema>;

// ── Helper ───────────────────────────────────────────────────────────────────
const EMPTY: NewLeadData = { name: '', company: '', email: '', phone: '', address: '', taxOffice: '', taxId: '', sector: '', authorizedContact: '', notes: '' };

function msg(raw: string, lang: 'tr' | 'en'): string {
  const map: Record<string, string> = {};
  for (const part of raw.split('|')) {
    const idx = part.indexOf(':');
    if (idx > -1) map[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return map[lang] ?? map['en'] ?? raw;
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  isOpen: boolean;
  isScoring: boolean;
  fromOrder?: boolean;
  currentLanguage: 'tr' | 'en';
  currentT: Record<string, string>;
  onClose: () => void;
  onSubmit: (data: NewLeadData) => Promise<void>;
}

export default function NewLeadModal({ isOpen, isScoring, fromOrder, currentLanguage, currentT, onClose, onSubmit }: Props) {
  const [form, setForm]   = useState<NewLeadData>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof NewLeadData, string>>>({});
  const lang = currentLanguage;

  const set = (key: keyof NewLeadData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [key]: e.target.value }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = NewLeadSchema.safeParse(form);
    if (!result.success) {
      const flat = result.error.flatten().fieldErrors;
      setErrors(Object.fromEntries(
        Object.entries(flat).map(([k, v]) => [k, v ? msg(v[0], lang) : undefined])
      ) as Partial<Record<keyof NewLeadData, string>>);
      return;
    }
    await onSubmit(result.data);
    setForm(EMPTY);
    setErrors({});
  };

  const close = () => { if (!isScoring) { setForm(EMPTY); setErrors({}); onClose(); } };

  const Err = ({ field }: { field: keyof NewLeadData }) =>
    errors[field] ? <p className="text-[10px] text-red-500 mt-0.5 font-medium">{errors[field]}</p> : null;

  const Field = ({ label, field, type = 'text', placeholder }: { label: string; field: keyof NewLeadData; type?: string; placeholder?: string }) => (
    <div className="space-y-1">
      <label className="text-[10px] font-bold text-gray-500 uppercase">{label}</label>
      <input
        type={type}
        value={(form[field] as string) ?? ''}
        onChange={set(field)}
        className={`apple-input w-full ${errors[field] ? 'ring-1 ring-red-400' : ''}`}
        placeholder={placeholder}
      />
      <Err field={field} />
    </div>
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={close} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white w-full max-w-lg rounded-2xl shadow-2xl relative z-10 overflow-hidden border border-gray-200">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold">{currentT.add_new_sales_lead}</h3>
                {fromOrder && (
                  <p className="text-[11px] text-brand mt-0.5 font-medium">
                    {lang === 'tr' ? '↩ Sipariş formuna otomatik eklenecek' : '↩ Will auto-select in order form'}
                  </p>
                )}
              </div>
              <button onClick={close} className="text-gray-400 hover:text-gray-600"><Plus className="w-6 h-6 rotate-45" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
              <Field label={currentT.contact_name}  field="name"    placeholder="Ahmet Yılmaz" />
              <Field label={currentT.company}        field="company" placeholder="ABC Ticaret A.Ş." />
              <Field label={currentT.email}          field="email"   type="email" placeholder="ornek@sirket.com" />
              <Field label={currentT.phone}          field="phone"   placeholder="+90 555 000 0000" />
              <Field label={lang === 'tr' ? 'Adres' : 'Address'} field="address" placeholder={lang === 'tr' ? 'İstanbul, Türkiye' : 'Istanbul, Turkey'} />
              <div className="grid grid-cols-2 gap-3">
                <Field label={lang === 'tr' ? 'Vergi Dairesi' : 'Tax Office'} field="taxOffice" placeholder="Boğaziçi V.D." />
                <Field label={lang === 'tr' ? 'Vergi No' : 'Tax No'}           field="taxId"     placeholder="1234567890" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={lang === 'tr' ? 'Sektör' : 'Sector'} field="sector" placeholder={lang === 'tr' ? 'Teknoloji' : 'Technology'} />
                <Field label={lang === 'tr' ? 'Yetkili Kişi' : 'Auth. Contact'} field="authorizedContact" placeholder="Mehmet Demir" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">{currentT.notes}</label>
                <textarea value={form.notes ?? ''} onChange={set('notes')} rows={3}
                  className={`apple-input resize-none w-full ${errors.notes ? 'ring-1 ring-red-400' : ''}`}
                  placeholder={currentT.describe_lead_interest} />
                <Err field="notes" />
              </div>
              <div className="pt-2 border-t border-gray-100 flex gap-3">
                <button type="button" onClick={close} className="apple-button-secondary flex-1">
                  {lang === 'tr' ? 'İptal' : 'Cancel'}
                </button>
                <button disabled={isScoring} type="submit" className="apple-button-primary flex-1 flex items-center justify-center gap-2">
                  {isScoring
                    ? <><Clock className="w-4 h-4 animate-spin" />{currentT.ai_scoring_in_progress}</>
                    : currentT.create_lead_and_score}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

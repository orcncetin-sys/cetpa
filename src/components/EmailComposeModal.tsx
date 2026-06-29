import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, RefreshCw, X } from 'lucide-react';
import { updateDoc, doc, authedFetch } from '../lib/dbClient';
import { db } from '../firebase';
import type { Lead } from '../types';
import type { Language } from '../translations';

export interface EmailComposeData {
  open: boolean;
  to: string;
  name: string;
  subject: string;
  body: string;
}

interface EmailComposeModalProps {
  emailCompose: EmailComposeData;
  setEmailCompose: React.Dispatch<React.SetStateAction<EmailComposeData>>;
  leads: Lead[];
  currentLanguage: Language;
  userEmail?: string;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function EmailComposeModal({
  emailCompose,
  setEmailCompose,
  leads,
  currentLanguage,
  userEmail,
  onSuccess,
  onError
}: EmailComposeModalProps) {
  const [emailSending, setEmailSending] = useState(false);

  if (!emailCompose.open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-purple-100 rounded-xl flex items-center justify-center">
                <Mail className="w-4 h-4 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yeni E-posta' : 'New Email'}</p>
                <p className="text-[10px] text-gray-400">{emailCompose.to}</p>
              </div>
            </div>
            <button onClick={() => setEmailCompose(e => ({ ...e, open: false }))} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
          {/* Fields */}
          <div className="p-5 space-y-3 flex-1">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">{currentLanguage === 'tr' ? 'Alıcı' : 'To'}</label>
              <input
                readOnly
                value={`${emailCompose.name} <${emailCompose.to}>`}
                className="apple-input w-full text-sm bg-gray-50 text-gray-500 cursor-default"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">{currentLanguage === 'tr' ? 'Konu' : 'Subject'}</label>
              <input
                value={emailCompose.subject}
                onChange={e => setEmailCompose(c => ({ ...c, subject: e.target.value }))}
                className="apple-input w-full text-sm"
                placeholder={currentLanguage === 'tr' ? 'E-posta konusu' : 'Email subject'}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">{currentLanguage === 'tr' ? 'Mesaj' : 'Message'}</label>
              <textarea
                value={emailCompose.body}
                onChange={e => setEmailCompose(c => ({ ...c, body: e.target.value }))}
                rows={7}
                className="apple-input w-full text-sm resize-none leading-relaxed"
                placeholder={currentLanguage === 'tr' ? 'Mesajınızı buraya yazın…' : 'Write your message here…'}
              />
            </div>
          </div>
          {/* Footer */}
          <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
            <button onClick={() => setEmailCompose(e => ({ ...e, open: false }))} className="apple-button-secondary px-5">
              {currentLanguage === 'tr' ? 'İptal' : 'Cancel'}
            </button>
            <button
              disabled={emailSending || !emailCompose.subject || !emailCompose.body}
              onClick={async () => {
                setEmailSending(true);
                try {
                  // authedFetch: Bearer token ekler (önce plain fetch → 401); server `html` bekliyor (text değil).
                  const res = await authedFetch('/api/email/send', {
                    method: 'POST',
                    body: JSON.stringify({ to: emailCompose.to, subject: emailCompose.subject, html: emailCompose.body.replace(/\n/g, '<br>') }),
                  });
                  const d = await res.json();
                  if (d.success) {
                    onSuccess(currentLanguage === 'tr' ? `E-posta gönderildi → ${emailCompose.to}` : `Email sent → ${emailCompose.to}`);
                    // Save to lead emails array
                    const lead = leads.find(l => l.email === emailCompose.to);
                    if (lead) {
                      const lead101 = lead as unknown as Record<string, unknown>;
                      const existing = Array.isArray(lead101.emails) ? lead101.emails as unknown[] : [];
                      await updateDoc(doc(db, 'leads', lead.id), {
                        emails: [...existing, { subject: emailCompose.subject, body: emailCompose.body, sentAt: Date.now(), sentBy: userEmail || 'system' }]
                      });
                    }
                    setEmailCompose(e => ({ ...e, open: false }));
                  } else if (d.notConfigured) {
                    onError(currentLanguage === 'tr' ? 'E-posta servisi yapılandırılmamış. Ayarlar > Resend API.' : 'Email not configured. Add Resend API key in Settings.');
                  } else {
                    onError(d.error || 'Gönderilemedi');
                  }
                } catch(err) {
                  onError(err instanceof Error ? err.message : 'Hata');
                } finally { setEmailSending(false); }
              }}
              className="apple-button-primary px-6 disabled:opacity-50 flex items-center gap-2"
            >
              {emailSending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {emailSending ? (currentLanguage === 'tr' ? 'Gönderiliyor…' : 'Sending…') : (currentLanguage === 'tr' ? 'Gönder' : 'Send')}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

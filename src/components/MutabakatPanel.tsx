/**
 * MutabakatPanel.tsx — Mutabakat Mektubu (Balance Reconciliation)
 *
 * Fetches customer + open-order data from /api/mutabakat/:leadId,
 * generates a professional PDF using jsPDF, and lets the user send it
 * via WhatsApp or email.
 *
 * Usage: <MutabakatPanel leadId={lead.id} currentLanguage="tr" />
 */

import React, { useState } from 'react';
import { FileText, Download, MessageSquare, Mail, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MutabakatOrder {
  id: string;
  orderNo: string;
  date: string;
  amount: number;
  status: string;
  faturaNo: string;
}

interface MutabakatData {
  success: boolean;
  lead: {
    id: string;
    name: string;
    company: string;
    email: string;
    phone: string;
    taxId: string;
    cariKod: string;
    bakiye: number;
  };
  orders: MutabakatOrder[];
  totalAmount: number;
  period: string;
  generatedAt: string;
}

// ── PDF Generator ─────────────────────────────────────────────────────────────

function generateMutabakatPDF(data: MutabakatData, lang: string): jsPDF {
  const t = lang === 'tr';
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 20;

  // ── Header bar ───────────────────────────────────────────────────────────
  doc.setFillColor(26, 58, 92); // #1a3a5c
  doc.rect(0, 0, pageW, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('CETPA', margin, 12);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(t ? 'Cari Hesap Mutabakat Mektubu' : 'Account Balance Reconciliation', margin, 20);

  // Date top-right
  doc.setFontSize(9);
  const dateStr = new Date(data.generatedAt).toLocaleDateString('tr-TR');
  doc.text(dateStr, pageW - margin - doc.getTextWidth(dateStr), 18);

  // ── Period ───────────────────────────────────────────────────────────────
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`${t ? 'Dönem' : 'Period'}: ${data.period}`, margin, 38);

  // ── Customer info box ────────────────────────────────────────────────────
  doc.setFillColor(248, 249, 250);
  doc.roundedRect(margin, 43, pageW - margin * 2, 32, 3, 3, 'F');
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  const infoLines = [
    [`${t ? 'Sayın' : 'Dear'}:`, `${data.lead.name}${data.lead.company ? ` / ${data.lead.company}` : ''}`],
    [t ? 'Vergi No:' : 'Tax ID:', data.lead.taxId || '—'],
    [t ? 'Telefon:' : 'Phone:', data.lead.phone || '—'],
    [`${t ? 'Cari Kod' : 'Account Code'}:`, data.lead.cariKod || '—'],
  ];
  infoLines.forEach(([label, value], i) => {
    doc.setFont('helvetica', 'bold');
    doc.text(label, margin + 4, 51 + i * 6);
    doc.setFont('helvetica', 'normal');
    doc.text(String(value), margin + 32, 51 + i * 6);
  });

  // ── Intro text ───────────────────────────────────────────────────────────
  doc.setFontSize(9.5);
  doc.setTextColor(50, 50, 50);
  doc.setFont('helvetica', 'normal');
  const intro = t
    ? `Şirketimizin ${data.period} dönemi itibarıyla kayıtlarımızda görünen bakiye aşağıda belirtilmiş olup, tarafınızla mutabakat sağlanması amacıyla bilgilerinize sunulmaktadır. Aşağıdaki rakamları kayıtlarınızla karşılaştırarak, ${dateStr} tarihinden itibaren 15 gün içinde yazılı bildirimde bulunmanızı rica ederiz. Aksi halde bakiyenin mutabık olarak kabul edileceğini beyan ederiz.`
    : `The balance shown below appears in our records as of period ${data.period}. We kindly request you to compare these figures with your own records and notify us in writing within 15 days from ${dateStr}. Failure to respond will be deemed acceptance of the balance.`;
  const splitIntro = doc.splitTextToSize(intro, pageW - margin * 2);
  doc.text(splitIntro, margin, 84);

  const tableStartY = 84 + splitIntro.length * 5 + 6;

  // ── Orders table ─────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: tableStartY,
    margin: { left: margin, right: margin },
    head: [[
      t ? 'Sipariş No' : 'Order No',
      t ? 'Tarih' : 'Date',
      t ? 'Tutar (TRY)' : 'Amount (TRY)',
      t ? 'Durum' : 'Status',
      t ? 'Fatura No' : 'Invoice No',
    ]],
    body: data.orders.map(o => [
      o.orderNo,
      o.date,
      o.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 }),
      o.status,
      o.faturaNo || '—',
    ]),
    foot: [[
      { content: t ? 'TOPLAM' : 'TOTAL', colSpan: 2, styles: { fontStyle: 'bold', halign: 'right' } },
      { content: data.totalAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 }), styles: { fontStyle: 'bold' } },
      '', '',
    ]],
    styles: { fontSize: 8.5, cellPadding: 3 },
    headStyles: { fillColor: [26, 58, 92], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [240, 244, 248], textColor: [26, 58, 92] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  const afterTable = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // ── Balance summary box ──────────────────────────────────────────────────
  doc.setFillColor(240, 244, 248);
  doc.roundedRect(margin, afterTable, pageW - margin * 2, 22, 3, 3, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(26, 58, 92);
  doc.text(t ? 'Güncel Cari Bakiye:' : 'Current Account Balance:', margin + 6, afterTable + 9);
  const balStr = `₺${data.lead.bakiye.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
  doc.text(balStr, pageW - margin - 6 - doc.getTextWidth(balStr), afterTable + 9);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(t ? '(Mikro ERP kayıtlarından alınmıştır)' : '(Sourced from Mikro ERP records)', margin + 6, afterTable + 17);

  // ── Signature area ───────────────────────────────────────────────────────
  const sigY = afterTable + 36;
  doc.setDrawColor(180, 180, 180);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);

  // Cetpa signature
  doc.text(t ? 'Cetpa Yetkili İmzası:' : 'Cetpa Authorised Signature:', margin, sigY);
  doc.line(margin, sigY + 12, margin + 70, sigY + 12);

  // Customer confirmation
  doc.text(t ? 'Müşteri Onay / İtiraz:' : 'Customer Confirmation / Objection:', pageW / 2 + 4, sigY);
  doc.line(pageW / 2 + 4, sigY + 12, pageW - margin, sigY + 12);

  const boxY = sigY + 18;
  doc.setFillColor(252, 252, 252);
  doc.roundedRect(margin, boxY, pageW - margin * 2, 22, 2, 2, 'FD');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(t
    ? '☐ Bakiyeyi kabul ediyorum   ☐ Aşağıdaki şekilde itiraz ediyorum:'
    : '☐ I confirm the balance   ☐ I object as follows:',
    margin + 4, boxY + 8);
  doc.line(margin + 4, boxY + 14, pageW - margin - 4, boxY + 14);
  doc.text(t ? 'Tarih: _______________   İmza: _______________' : 'Date: _______________   Signature: _______________', margin + 4, boxY + 20);

  // ── Footer ───────────────────────────────────────────────────────────────
  doc.setFillColor(240, 244, 248);
  doc.rect(0, doc.internal.pageSize.getHeight() - 12, pageW, 12, 'F');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text('Cetpa Yazılım A.Ş. • www.cetpa.com.tr', margin, doc.internal.pageSize.getHeight() - 4);
  doc.text(`${t ? 'Oluşturulma' : 'Generated'}: ${new Date(data.generatedAt).toLocaleString('tr-TR')}`, pageW - margin - 80, doc.internal.pageSize.getHeight() - 4);

  return doc;
}

// ── Main Component ────────────────────────────────────────────────────────────

interface MutabakatPanelProps {
  leadId: string;
  currentLanguage?: string;
}

export default function MutabakatPanel({ leadId, currentLanguage = 'tr' }: MutabakatPanelProps) {
  const t = currentLanguage === 'tr';
  const [loading, setLoading]   = useState(false);
  const [data, setData]         = useState<MutabakatData | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [sending, setSending]   = useState<'whatsapp' | 'email' | null>(null);
  const [sent, setSent]         = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true); setError(null); setData(null); setSent(null);
    try {
      const r = await fetch(`/api/mutabakat/${leadId}`);
      const d = await r.json() as MutabakatData & { error?: string };
      if (!d.success) throw new Error(d.error || 'Veri alınamadı.');
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPDF = () => {
    if (!data) return;
    const doc = generateMutabakatPDF(data, currentLanguage);
    doc.save(`mutabakat-${data.lead.name.replace(/\s+/g, '-')}-${data.period}.pdf`);
  };

  const handleSendWhatsApp = async () => {
    if (!data?.lead.phone) return;
    setSending('whatsapp');
    try {
      const doc = generateMutabakatPDF(data, currentLanguage);
      const pdfBase64 = doc.output('datauristring');
      // Send a WhatsApp message with a link/notification (PDF inline not supported in basic API)
      const msg = t
        ? `Merhaba ${data.lead.name}, ${data.period} dönemi cari hesap mutabakat mektubumuz hazırlanmıştır. Toplam bakiye: ₺${data.totalAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}. Lütfen kayıtlarınızla karşılaştırınız.`
        : `Hello ${data.lead.name}, your account reconciliation letter for ${data.period} is ready. Total: ₺${data.totalAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}. Please compare with your records.`;
      const r = await fetch('/api/whatsapp/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: data.lead.phone, message: msg }),
      });
      const result = await r.json() as { success: boolean; notConfigured?: boolean; error?: string };
      if (result.success) {
        setSent(t ? 'WhatsApp mesajı gönderildi ✓' : 'WhatsApp message sent ✓');
        // Also download the PDF so the user can forward it manually if needed
        doc.save(`mutabakat-${data.lead.name.replace(/\s+/g, '-')}-${data.period}.pdf`);
        void pdfBase64; // suppress lint
      } else if (result.notConfigured) {
        setError(t ? 'WhatsApp sağlayıcısı yapılandırılmamış. Ayarlar\'dan API Key ekleyin.' : 'WhatsApp provider not configured.');
      } else {
        setError(result.error || 'WhatsApp gönderme hatası.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(null);
    }
  };

  const handleSendEmail = async () => {
    if (!data?.lead.email) return;
    setSending('email');
    try {
      // Generate PDF and trigger mailto with the PDF as download
      const doc = generateMutabakatPDF(data, currentLanguage);
      doc.save(`mutabakat-${data.lead.name.replace(/\s+/g, '-')}-${data.period}.pdf`);
      const subject = encodeURIComponent(t ? `${data.period} Cari Hesap Mutabakat Mektubu` : `${data.period} Account Reconciliation`);
      const body = encodeURIComponent(t
        ? `Sayın ${data.lead.name},\n\n${data.period} dönemi cari hesap mutabakat mektubumuz ekte yer almaktadır.\n\nSaygılarımızla,\nCetpa`
        : `Dear ${data.lead.name},\n\nPlease find attached the account reconciliation letter for ${data.period}.\n\nBest regards,\nCetpa`);
      window.open(`mailto:${data.lead.email}?subject=${subject}&body=${body}`);
      setSent(t ? 'PDF indirildi, e-posta istemcisi açıldı ✓' : 'PDF downloaded, email client opened ✓');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Header + fetch button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#1a3a5c]" />
          <span className="text-sm font-bold text-gray-800">{t ? 'Mutabakat Mektubu' : 'Reconciliation Letter'}</span>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl bg-[#1a3a5c] hover:bg-[#1a3a5c]/90 text-white text-xs font-bold transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? (t ? 'Yükleniyor…' : 'Loading…') : (t ? 'Hazırla' : 'Prepare')}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl p-3 bg-red-50 text-red-600 text-xs flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Success notice */}
      {sent && (
        <div className="rounded-xl p-3 bg-green-50 text-green-700 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> {sent}
        </div>
      )}

      {/* Preview card */}
      {data && (
        <div className="rounded-2xl border border-[#1a3a5c]/20 bg-[#f4f7fb] p-4 space-y-3">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[10px] text-gray-500 font-bold uppercase">{t ? 'Dönem' : 'Period'}</div>
              <div className="text-xs font-bold text-gray-800">{data.period}</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500 font-bold uppercase">{t ? 'Açık Sipariş' : 'Open Orders'}</div>
              <div className="text-xs font-bold text-gray-800">{data.orders.length}</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500 font-bold uppercase">{t ? 'Toplam Tutar' : 'Total Amount'}</div>
              <div className="text-xs font-bold text-[#1a3a5c]">₺{data.totalAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</div>
            </div>
          </div>

          {/* Orders mini-list */}
          {data.orders.length > 0 && (
            <div className="bg-white rounded-xl divide-y divide-gray-50 overflow-hidden max-h-40 overflow-y-auto">
              {data.orders.map(o => (
                <div key={o.id} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="font-mono text-gray-500">{o.orderNo}</span>
                  <span className="text-gray-400">{o.date}</span>
                  <span className="font-bold text-gray-800">₺{o.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              onClick={handleDownloadPDF}
              className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl bg-white border border-[#1a3a5c]/20 text-[#1a3a5c] hover:bg-[#1a3a5c]/5 text-xs font-bold transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
            <button
              onClick={handleSendWhatsApp}
              disabled={!data.lead.phone || sending !== null}
              className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-bold transition-colors disabled:opacity-40"
            >
              {sending === 'whatsapp'
                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                : <MessageSquare className="w-3.5 h-3.5" />}
              WhatsApp
            </button>
            <button
              onClick={handleSendEmail}
              disabled={!data.lead.email || sending !== null}
              className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors disabled:opacity-40"
            >
              {sending === 'email'
                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                : <Mail className="w-3.5 h-3.5" />}
              {t ? 'E-posta' : 'Email'}
            </button>
          </div>
        </div>
      )}

      {!data && !loading && !error && (
        <p className="text-[11px] text-gray-400 text-center py-2">
          {t ? '"Hazırla" butonuna basarak müşteri için mutabakat mektubu oluşturun.' : 'Press "Prepare" to generate a reconciliation letter for this customer.'}
        </p>
      )}
    </div>
  );
}

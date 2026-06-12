import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, ChevronRight, Check, AlertCircle } from 'lucide-react';
import {
  collection,
  serverTimestamp,
  writeBatch,
  doc,
} from '../lib/dbClient';
import { db } from '../firebase';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DataImportWizardProps {
  isOpen: boolean;
  onClose: () => void;
  currentLanguage: string;
  userId: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportType = 'products' | 'customers';
type WizardStep = 1 | 2 | 3;

interface ParsedCSV {
  headers: string[];
  rows: string[][];
  rowCount: number;
}

interface ColumnMapping {
  [fieldKey: string]: string; // fieldKey → csv column name
}

// ─── CSV parser (no external lib) ────────────────────────────────────────────

function parseCSV(text: string): ParsedCSV {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], rowCount: 0 };

  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(parseRow);
  return { headers, rows, rowCount: rows.length };
}

// ─── Field definitions ────────────────────────────────────────────────────────

interface FieldDef {
  key: string;
  labelTR: string;
  labelEN: string;
  required: boolean;
}

const PRODUCT_FIELDS: FieldDef[] = [
  { key: 'name',       labelTR: 'Ürün Adı',     labelEN: 'Name',       required: true },
  { key: 'sku',        labelTR: 'SKU',           labelEN: 'SKU',        required: true },
  { key: 'stockLevel', labelTR: 'Stok',          labelEN: 'Stock',      required: true },
  { key: 'costPrice',  labelTR: 'Maliyet Fiyatı',labelEN: 'Cost Price', required: true },
  { key: 'category',   labelTR: 'Kategori',      labelEN: 'Category',   required: false },
  { key: 'location',   labelTR: 'Konum',         labelEN: 'Location',   required: false },
  { key: 'supplier',   labelTR: 'Tedarikçi',     labelEN: 'Supplier',   required: false },
];

const CUSTOMER_FIELDS: FieldDef[] = [
  { key: 'name',    labelTR: 'Ad Soyad / Firma', labelEN: 'Name',    required: true },
  { key: 'email',   labelTR: 'E-posta',          labelEN: 'Email',   required: true },
  { key: 'phone',   labelTR: 'Telefon',          labelEN: 'Phone',   required: true },
  { key: 'company', labelTR: 'Şirket',           labelEN: 'Company', required: false },
  { key: 'address', labelTR: 'Adres',            labelEN: 'Address', required: false },
  { key: 'taxNo',   labelTR: 'Vergi No',         labelEN: 'Tax No',  required: false },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function autoMap(headers: string[], fields: FieldDef[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const field of fields) {
    const match = headers.find(
      (h) => h.toLowerCase().replace(/[\s_-]/g, '') === field.key.toLowerCase()
    );
    if (match) mapping[field.key] = match;
  }
  return mapping;
}

function getCellValue(row: string[], headers: string[], colName: string): string {
  const idx = headers.indexOf(colName);
  return idx >= 0 ? (row[idx] ?? '') : '';
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current, lang }: { current: WizardStep; lang: string }) {
  const steps = lang === 'tr'
    ? ['Yükle', 'Eşleştir', 'Önizle']
    : ['Upload', 'Map', 'Preview'];
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((label, i) => {
        const num = (i + 1) as WizardStep;
        const done = num < current;
        const active = num === current;
        return (
          <React.Fragment key={num}>
            <div className="flex items-center gap-1.5">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  done
                    ? 'bg-green-500 text-white'
                    : active
                    ? 'bg-[#ff4000] text-white shadow-md shadow-[#ff4000]/30'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {done ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : num}
              </div>
              <span
                className={`text-xs font-medium hidden sm:inline ${
                  active ? 'text-[#1D1D1F]' : 'text-[#86868B]'
                }`}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`w-8 h-0.5 rounded transition-all ${
                  done ? 'bg-green-500' : 'bg-gray-200'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DataImportWizard({
  isOpen,
  onClose,
  currentLanguage,
  userId,
}: DataImportWizardProps) {
  const lang = currentLanguage === 'tr' ? 'tr' : 'en';

  // Wizard state
  const [step, setStep] = useState<WizardStep>(1);
  const [importType, setImportType] = useState<ImportType | null>(null);
  const [parsed, setParsed] = useState<ParsedCSV | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [skipOptional, setSkipOptional] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [parseError, setParseError] = useState('');

  // Import progress state
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importDone, setImportDone] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fields = importType === 'products' ? PRODUCT_FIELDS : CUSTOMER_FIELDS;
  const requiredFields = fields.filter((f) => f.required);
  const optionalFields = fields.filter((f) => !f.required);

  // ── Reset on close ─────────────────────────────────────────────────────────
  const handleClose = () => {
    setStep(1);
    setImportType(null);
    setParsed(null);
    setFileName('');
    setMapping({});
    setSkipOptional(false);
    setParseError('');
    setImporting(false);
    setImportProgress(0);
    setImportDone(false);
    setImportedCount(0);
    onClose();
  };

  // ── File handling ──────────────────────────────────────────────────────────
  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith('.csv')) {
        setParseError(lang === 'tr' ? 'Sadece .csv dosyaları kabul edilir.' : 'Only .csv files are accepted.');
        return;
      }
      setParseError('');
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const result = parseCSV(text);
        if (result.headers.length === 0) {
          setParseError(lang === 'tr' ? 'Dosya okunamadı veya boş.' : 'File could not be read or is empty.');
          return;
        }
        setParsed(result);
        // Auto-map
        const active = importType === 'products' ? PRODUCT_FIELDS : CUSTOMER_FIELDS;
        setMapping(autoMap(result.headers, active));
      };
      reader.readAsText(file, 'UTF-8');
    },
    [importType, lang]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  // ── Validation ─────────────────────────────────────────────────────────────
  const canProceedStep1 = importType !== null && parsed !== null;

  const canProceedStep2 = requiredFields.every((f) => mapping[f.key]);

  // ── Preview rows ───────────────────────────────────────────────────────────
  const previewRows = parsed ? parsed.rows.slice(0, 5) : [];

  // ── Build mapped record ────────────────────────────────────────────────────
  const buildRecord = (row: string[]): Record<string, unknown> => {
    if (!parsed) return {};
    const record: Record<string, unknown> = {};
    const allFields = skipOptional ? requiredFields : fields;
    for (const field of allFields) {
      const col = mapping[field.key];
      if (!col) continue;
      const val = getCellValue(row, parsed.headers, col);
      record[field.key] = val;
    }
    return record;
  };

  // ── Import ─────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!parsed || !importType) return;
    setImporting(true);
    setImportProgress(0);

    const rows = parsed.rows;
    const total = rows.length;
    const BATCH_SIZE = 20;
    let done = 0;

    try {
      for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = rows.slice(i, i + BATCH_SIZE);

        for (const row of chunk) {
          const mapped = buildRecord(row);

          if (importType === 'products') {
            const ref = doc(collection(db, 'inventory'));
            batch.set(ref, {
              name: mapped.name ?? '',
              sku: mapped.sku ?? '',
              stockLevel: Number(mapped.stockLevel) || 0,
              costPrice: Number(mapped.costPrice) || 0,
              category: mapped.category ?? '',
              location: mapped.location ?? '',
              supplier: mapped.supplier ?? '',
              prices: {
                Retail: 0,
                'B2B Standard': 0,
                'B2B Premium': 0,
                Dealer: 0,
              },
              lowStockThreshold: 5,
              createdAt: serverTimestamp(),
            });
          } else {
            const ref = doc(collection(db, 'leads'));
            batch.set(ref, {
              name: mapped.name ?? '',
              email: mapped.email ?? '',
              phone: mapped.phone ?? '',
              company: mapped.company ?? '',
              address: mapped.address ?? '',
              taxNo: mapped.taxNo ?? '',
              status: 'New',
              assignedTo: userId,
              customerType: 'B2B',
              createdAt: serverTimestamp(),
            });
          }
        }

        await batch.commit();
        done += chunk.length;
        setImportProgress(Math.round((done / total) * 100));
      }

      setImportedCount(done);
      setImportDone(true);
    } catch (err) {
      console.error('Import error:', err);
      setParseError(
        lang === 'tr'
          ? 'İçe aktarma sırasında bir hata oluştu.'
          : 'An error occurred during import.'
      );
    } finally {
      setImporting(false);
    }
  };

  // ── Portal render ──────────────────────────────────────────────────────────
  if (!isOpen) return null;

  const modal = (
    <div className="fixed inset-0 z-[300] flex items-start justify-center overflow-y-auto">
      {/* Backdrop */}
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <motion.div
        key="modal"
        initial={{ opacity: 0, y: -20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.97 }}
        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
        className="apple-card relative w-full max-w-2xl mx-4 mt-20 mb-10 p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors"
        >
          <X className="w-4 h-4 text-[#86868B]" />
        </button>

        {/* Title */}
        <h2 className="text-xl font-black text-[#1D1D1F] mb-1">
          {lang === 'tr' ? 'Toplu Veri İçe Aktarma' : 'Bulk Data Import'}
        </h2>
        <p className="text-xs text-[#86868B] mb-5">
          {lang === 'tr'
            ? 'CSV dosyanızı yükleyin, alanları eşleştirin ve içe aktarın.'
            : 'Upload your CSV file, map fields, and import.'}
        </p>

        <StepIndicator current={step} lang={lang} />

        {/* ── STEP 1: Upload ── */}
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {/* Type selection */}
              <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider mb-3">
                {lang === 'tr' ? 'Veri Türü' : 'Data Type'}
              </p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                {(
                  [
                    { type: 'products', emoji: '📦', labelTR: 'Ürünler', labelEN: 'Products' },
                    { type: 'customers', emoji: '👥', labelTR: 'Müşteriler', labelEN: 'Customers' },
                  ] as const
                ).map(({ type, emoji, labelTR, labelEN }) => (
                  <button
                    key={type}
                    onClick={() => {
                      setImportType(type);
                      setParsed(null);
                      setFileName('');
                      setMapping({});
                    }}
                    className={`flex flex-col items-center justify-center gap-2 py-5 rounded-2xl border-2 transition-all font-semibold text-sm ${
                      importType === type
                        ? 'border-[#ff4000] bg-[#ff4000]/5 text-[#ff4000]'
                        : 'border-gray-200 text-[#1D1D1F] hover:border-gray-300'
                    }`}
                  >
                    <span className="text-3xl">{emoji}</span>
                    <span>{lang === 'tr' ? labelTR : labelEN}</span>
                  </button>
                ))}
              </div>

              {/* Drop zone */}
              {importType && (
                <>
                  <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider mb-3">
                    {lang === 'tr' ? 'CSV Dosyası' : 'CSV File'}
                  </p>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-2xl py-10 cursor-pointer transition-all ${
                      isDragging
                        ? 'border-[#ff4000] bg-[#ff4000]/5'
                        : parsed
                        ? 'border-green-400 bg-green-50'
                        : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={onFileChange}
                    />
                    {parsed ? (
                      <>
                        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                          <Check className="w-5 h-5 text-green-600" />
                        </div>
                        <p className="font-semibold text-sm text-green-700">{fileName}</p>
                        <p className="text-xs text-green-600">
                          {parsed.rowCount} {lang === 'tr' ? 'satır,' : 'rows,'}{' '}
                          {parsed.headers.length} {lang === 'tr' ? 'sütun algılandı' : 'columns detected'}
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                          <Upload className="w-5 h-5 text-[#86868B]" />
                        </div>
                        <p className="font-semibold text-sm text-[#1D1D1F]">
                          {lang === 'tr' ? 'CSV yüklemek için tıklayın veya sürükleyin' : 'Click or drag to upload CSV'}
                        </p>
                        <p className="text-xs text-[#86868B]">
                          {lang === 'tr' ? 'Yalnızca .csv formatı' : '.csv format only'}
                        </p>
                      </>
                    )}
                  </div>
                </>
              )}

              {parseError && (
                <div className="flex items-center gap-2 mt-3 p-3 bg-red-50 rounded-xl text-red-600 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {parseError}
                </div>
              )}

              <div className="flex justify-end mt-5">
                <button
                  onClick={() => setStep(2)}
                  disabled={!canProceedStep1}
                  className="apple-button-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {lang === 'tr' ? 'Devam' : 'Continue'}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ── STEP 2: Map Columns ── */}
          {step === 2 && parsed && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <p className="text-xs text-[#86868B] mb-4">
                {lang === 'tr'
                  ? `Algılanan sütunlar: ${parsed.headers.join(', ')}`
                  : `Detected columns: ${parsed.headers.join(', ')}`}
              </p>

              {/* Required fields */}
              <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider mb-2">
                {lang === 'tr' ? 'Zorunlu Alanlar' : 'Required Fields'}
              </p>
              <div className="space-y-2 mb-4">
                {requiredFields.map((field) => (
                  <div key={field.key} className="flex items-center gap-3">
                    <label className="w-36 text-xs font-semibold text-[#1D1D1F] flex-shrink-0">
                      {lang === 'tr' ? field.labelTR : field.labelEN}
                      <span className="text-[#ff4000] ml-0.5">*</span>
                    </label>
                    <select
                      value={mapping[field.key] ?? ''}
                      onChange={(e) =>
                        setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      className="apple-input flex-1 text-xs py-2"
                    >
                      <option value="">
                        {lang === 'tr' ? '— Sütun seçin —' : '— Select column —'}
                      </option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Optional fields */}
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="checkbox"
                  id="skip-optional"
                  checked={skipOptional}
                  onChange={(e) => setSkipOptional(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="skip-optional" className="text-xs text-[#86868B] cursor-pointer select-none">
                  {lang === 'tr' ? 'Opsiyonel alanları atla' : 'Skip optional fields'}
                </label>
              </div>

              {!skipOptional && (
                <>
                  <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider mb-2">
                    {lang === 'tr' ? 'Opsiyonel Alanlar' : 'Optional Fields'}
                  </p>
                  <div className="space-y-2 mb-4">
                    {optionalFields.map((field) => (
                      <div key={field.key} className="flex items-center gap-3">
                        <label className="w-36 text-xs font-medium text-[#86868B] flex-shrink-0">
                          {lang === 'tr' ? field.labelTR : field.labelEN}
                        </label>
                        <select
                          value={mapping[field.key] ?? ''}
                          onChange={(e) =>
                            setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          className="apple-input flex-1 text-xs py-2"
                        >
                          <option value="">
                            {lang === 'tr' ? '— Atla —' : '— Skip —'}
                          </option>
                          {parsed.headers.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="flex items-center justify-between mt-5">
                <button
                  onClick={() => setStep(1)}
                  className="apple-button-secondary text-sm"
                >
                  {lang === 'tr' ? '← Geri' : '← Back'}
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!canProceedStep2}
                  className="apple-button-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {lang === 'tr' ? 'Önizle' : 'Preview'}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ── STEP 3: Preview & Import ── */}
          {step === 3 && parsed && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {importDone ? (
                /* Success state */
                <div className="flex flex-col items-center gap-4 py-8 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 250 }}
                    className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center"
                  >
                    <Check className="w-8 h-8 text-green-600" strokeWidth={2.5} />
                  </motion.div>
                  <h3 className="text-lg font-black text-[#1D1D1F]">
                    {lang === 'tr' ? 'İçe Aktarma Tamamlandı!' : 'Import Complete!'}
                  </h3>
                  <p className="text-sm text-[#86868B]">
                    {importedCount}{' '}
                    {lang === 'tr'
                      ? (importType === 'products' ? 'ürün' : 'müşteri') + ' başarıyla aktarıldı.'
                      : (importType === 'products' ? 'products' : 'customers') + ' imported successfully.'}
                  </p>
                  <button onClick={handleClose} className="apple-button-primary mt-2">
                    {lang === 'tr' ? 'Kapat' : 'Close'}
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider mb-3">
                    {lang === 'tr' ? 'İlk 5 Satır Önizleme' : 'First 5 Rows Preview'}
                  </p>

                  {/* Preview table */}
                  <div className="overflow-x-auto rounded-xl border border-gray-100 mb-5">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          {(skipOptional ? requiredFields : fields)
                            .filter((f) => mapping[f.key])
                            .map((f) => (
                              <th
                                key={f.key}
                                className="text-left px-3 py-2 font-semibold text-[#86868B] whitespace-nowrap"
                              >
                                {lang === 'tr' ? f.labelTR : f.labelEN}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, ri) => (
                          <tr key={ri} className="border-b border-gray-50 last:border-0">
                            {(skipOptional ? requiredFields : fields)
                              .filter((f) => mapping[f.key])
                              .map((f) => (
                                <td key={f.key} className="px-3 py-2 text-[#1D1D1F] whitespace-nowrap max-w-[160px] truncate">
                                  {getCellValue(row, parsed.headers, mapping[f.key])}
                                </td>
                              ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-xs text-[#86868B] mb-4">
                    {lang === 'tr'
                      ? `Toplam ${parsed.rowCount} kayıt içe aktarılacak.`
                      : `${parsed.rowCount} total records will be imported.`}
                  </p>

                  {/* Progress bar during import */}
                  {importing && (
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-[#86868B] mb-1">
                        <span>{lang === 'tr' ? 'İçe aktarılıyor…' : 'Importing…'}</span>
                        <span>{importProgress}%</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-[#ff4000] rounded-full"
                          animate={{ width: `${importProgress}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    </div>
                  )}

                  {parseError && (
                    <div className="flex items-center gap-2 mb-4 p-3 bg-red-50 rounded-xl text-red-600 text-xs">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {parseError}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setStep(2)}
                      disabled={importing}
                      className="apple-button-secondary text-sm disabled:opacity-40"
                    >
                      {lang === 'tr' ? '← Geri' : '← Back'}
                    </button>
                    <button
                      onClick={handleImport}
                      disabled={importing}
                      className="apple-button-primary flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {importing ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          {lang === 'tr' ? 'Aktarılıyor…' : 'Importing…'}
                        </>
                      ) : (
                        <>
                          {lang === 'tr' ? `Başlat — ${parsed.rowCount} kayıt` : `Import ${parsed.rowCount} records`}
                          <ChevronRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );

  return createPortal(modal, document.body);
}

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Brain, Sparkles, X, Loader2, TrendingUp, AlertCircle } from 'lucide-react';
import Markdown from 'react-markdown';
import { analyzeDashboard } from '../services/geminiService';

interface DashboardAnalysisProps {
  data: Record<string, unknown>;
}

export default function DashboardAnalysis({ data }: DashboardAnalysisProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleAnalyze = async () => {
    setIsLoading(true);
    setIsOpen(true);
    try {
      const result = await analyzeDashboard(data);
      setAnalysis(result);
    } catch (error) {
      console.error(error);
      setAnalysis("Analiz sırasında bir hata oluştu.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={handleAnalyze}
        className="apple-button-primary flex items-center gap-2 bg-gradient-to-r from-purple-600 to-[#ff4000] hover:from-purple-700 hover:to-[#e63900] shadow-lg shadow-purple-500/20"
      >
        <Sparkles className="w-4 h-4" />
        Gemini ile Analiz Et
      </button>

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-xl">
                    <Brain className="w-6 h-6 text-purple-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Stratejik Dashboard Analizi</h2>
                    <p className="text-sm text-gray-500">Gemini 3.1 Pro tarafından hazırlanan derinlemesine rapor.</p>
                  </div>
                </div>
                <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center h-64 space-y-4">
                    <Loader2 className="w-12 h-12 text-purple-600 animate-spin" />
                    <div className="text-center">
                      <p className="text-lg font-medium text-gray-900">Veriler Analiz Ediliyor...</p>
                      <p className="text-sm text-gray-500">Yüksek düşünme modu aktif. Bu işlem biraz zaman alabilir.</p>
                    </div>
                  </div>
                ) : (
                  <div className="prose prose-purple max-w-none">
                    <div className="markdown-body">
                      <Markdown>{analysis || ''}</Markdown>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center">
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <div className="flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> Canlı Veri
                  </div>
                  <div className="flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Stratejik Öneriler
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="apple-button-secondary px-8"
                >
                  Kapat
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

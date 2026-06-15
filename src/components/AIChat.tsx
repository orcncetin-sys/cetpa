import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, Send, X, Bot, RefreshCw, Zap, Brain } from 'lucide-react';
import { auth } from '../firebase';

interface Message {
  role: 'user' | 'ai';
  text: string;
}

interface AIChatProps {
  /** Live business snapshot injected by AppContent — used as system context */
  businessContext?: string;
  currentLanguage?: string;
}

async function getToken(): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

export default function AIChat({ businessContext, currentLanguage = 'tr' }: AIChatProps) {
  const isTR = currentLanguage !== 'en';
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', text: isTR ? 'Merhaba! İşte güncel iş durumunuzu biliyorum. Size nasıl yardımcı olabilirim?' : 'Hello! I have your live business data loaded. How can I help?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isHighThinking, setIsHighThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const buildSystemInstruction = () => [
    isTR
      ? "Sen CETPA Cloud ERP platformunun akıllı iş asistanısın. Kullanıcının gerçek zamanlı iş verilerine erişimin var ve bu verilere dayanarak somut, eyleme dönüştürülebilir önerilerde bulunabilirsin. Türkçe yanıt ver. Kısa ve odaklı ol — 3 cümleyi geçme."
      : "You are the intelligent business assistant for CETPA Cloud ERP. You have access to the user's real-time business data and can give concrete, actionable recommendations based on it. Be concise — no more than 3 sentences per response.",
    businessContext ? `\n\n=== CURRENT BUSINESS SNAPSHOT (today) ===\n${businessContext}` : '',
    isTR
      ? "\n\nKullanıcı 'en iyi müşteri', 'geciken sipariş', 'stok riski', 'nakit akışı' gibi sorular sorabilir. Verilen verilere atıfta bulun. Uyarılar için emoji kullan (⚠️ 📦 💰 🚛). Asla veri uydurmaya çalışma — bilmiyorsan söyle."
      : "\n\nUsers may ask about top customers, overdue orders, stock risk, cash position. Reference the provided data. Use emojis for alerts (⚠️ 📦 💰 🚛). Never fabricate data — say 'I don't have that data' if not provided.",
  ].join('');

  /** Convert local message history (excluding the last user message) to Gemini chat format */
  const buildHistory = (msgs: Message[]) =>
    msgs
      .filter(m => m.role === 'user' || m.role === 'ai')
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }],
      }));

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    const updatedMessages = [...messages, { role: 'user' as const, text: userMessage }];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      const token = await getToken();
      // Pass all prior messages as history (exclude the one we just added as message)
      const history = buildHistory(messages);

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: userMessage,
          history,
          systemInstruction: buildSystemInstruction(),
          model: isHighThinking ? 'gemini-2.0-flash' : 'gemini-2.0-flash',
          highThinking: isHighThinking,
        }),
      });

      if (!res.ok) throw new Error(`AI proxy ${res.status}`);
      const data = await res.json() as { text: string };
      setMessages(prev => [...prev, { role: 'ai', text: data.text || (isTR ? 'Üzgünüm, bir hata oluştu.' : 'Sorry, an error occurred.') }]);
    } catch (error) {
      console.error('[AIChat]', error);
      setMessages(prev => [...prev, { role: 'ai', text: isTR ? 'Üzgünüm, şu an yanıt veremiyorum.' : 'Sorry, I cannot respond right now.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEndConversation = () => {
    setMessages([{
      role: 'ai',
      text: isTR ? 'Görüşme sonlandırıldı. Yeni bir konuda yardımcı olabilir miyim?' : 'Conversation ended. How can I help you with something new?',
    }]);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 bg-[#ff4000] text-white p-4 rounded-full shadow-lg hover:bg-[#e63900] transition-all z-50 flex items-center justify-center"
      >
        <MessageSquare size={24} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed bottom-24 right-6 w-96 h-[550px] bg-white rounded-3xl shadow-2xl border border-gray-100 flex flex-col z-50 overflow-hidden"
          >
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <div className="flex items-center gap-2 font-bold text-gray-800">
                <div className="w-8 h-8 rounded-full bg-[#ff4000]/10 flex items-center justify-center">
                  <Bot className="text-[#ff4000]" size={18} />
                </div>
                <div>
                  <div className="text-sm">Cetpa AI Asistan</div>
                  <div className="text-[10px] text-green-500 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Çevrimiçi
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsHighThinking(!isHighThinking)}
                  title={isHighThinking ? 'Yüksek Düşünme Modu Açık' : 'Düşük Gecikme Modu Açık'}
                  className={`p-2 rounded-lg transition-all ${isHighThinking ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}
                >
                  {isHighThinking ? <Brain size={16} /> : <Zap size={16} />}
                </button>
                <button
                  onClick={handleEndConversation}
                  title="Konuşmayı Sonlandır"
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <RefreshCw size={16} />
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  title="Kapat"
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
              {messages.map((m, i) => (
                <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}>
                  {m.role === 'ai' && (
                    <div className="w-8 h-8 rounded-full bg-white border border-gray-100 shadow-sm flex items-center justify-center flex-shrink-0">
                      <Bot size={16} className="text-[#ff4000]" />
                    </div>
                  )}
                  <div className={`p-3 rounded-2xl max-w-[80%] text-sm shadow-sm ${m.role === 'user' ? 'bg-[#ff4000] text-white rounded-tr-sm' : 'bg-white text-gray-800 border border-gray-100 rounded-tl-sm'}`}>
                    {m.text}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-2">
                  <div className="w-8 h-8 rounded-full bg-white border border-gray-100 shadow-sm flex items-center justify-center flex-shrink-0">
                    <Bot size={16} className="text-[#ff4000]" />
                  </div>
                  <div className="p-3 rounded-2xl bg-white border border-gray-100 rounded-tl-sm shadow-sm flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 border-t border-gray-100 bg-white">
              <div className="flex gap-2 items-center bg-gray-50 p-1 rounded-2xl border border-gray-200 focus-within:border-[#ff4000]/50 focus-within:ring-2 focus-within:ring-[#ff4000]/20 transition-all">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={isTR ? 'Mesajınızı yazın...' : 'Type your message...'}
                  className="flex-1 p-2 bg-transparent text-sm focus:outline-none"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="bg-[#ff4000] text-white p-2 rounded-xl hover:bg-[#e63900] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

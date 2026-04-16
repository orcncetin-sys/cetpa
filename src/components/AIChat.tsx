import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, Send, X, Bot, RefreshCw, Zap, Brain } from 'lucide-react';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

interface Message {
  role: 'user' | 'ai';
  text: string;
}

export default function AIChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', text: 'Merhaba! Size nasıl yardımcı olabilirim?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isHighThinking, setIsHighThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Keep track of the chat session
  const chatSessionRef = useRef<unknown>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    chatSessionRef.current = ai.chats.create({
      model: isHighThinking ? "gemini-3.1-pro-preview" : "gemini-3.1-flash-lite-preview",
      config: {
        systemInstruction: "Sen bu kurumsal yönetim ve proje takip programının akıllı asistanısın. Kullanıcılara programla ilgili sorularında yardımcı ol, nazik ve profesyonel bir dil kullan.",
        thinkingConfig: isHighThinking ? { thinkingLevel: ThinkingLevel.HIGH } : undefined
      }
    });
  }, [isHighThinking]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsLoading(true);

    try {
      if (!chatSessionRef.current) {
        chatSessionRef.current = ai.chats.create({
          model: isHighThinking ? "gemini-3.1-pro-preview" : "gemini-3.1-flash-lite-preview",
          config: {
            systemInstruction: "Sen bu kurumsal yönetim ve proje takip programının akıllı asistanısın. Kullanıcılara programla ilgili sorularında yardımcı ol, nazik ve profesyonel bir dil kullan.",
            thinkingConfig: isHighThinking ? { thinkingLevel: ThinkingLevel.HIGH } : undefined
          }
        });
      }
      const response = await (chatSessionRef.current as { sendMessage: (params: { message: string }) => Promise<{ text?: string }> }).sendMessage({ message: userMessage });
      
      setMessages(prev => [...prev, { role: 'ai', text: response.text || 'Üzgünüm, bir hata oluştu.' }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'ai', text: 'Üzgünüm, şu an yanıt veremiyorum.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEndConversation = () => {
    setMessages([{ role: 'ai', text: 'Görüşme sonlandırıldı. Yeni bir konuda yardımcı olabilir miyim?' }]);
    chatSessionRef.current = ai.chats.create({
      model: isHighThinking ? "gemini-3.1-pro-preview" : "gemini-3.1-flash-lite-preview",
      config: {
        systemInstruction: "Sen bu kurumsal yönetim ve proje takip programının akıllı asistanısın. Kullanıcılara programla ilgili sorularında yardımcı ol, nazik ve profesyonel bir dil kullan.",
        thinkingConfig: isHighThinking ? { thinkingLevel: ThinkingLevel.HIGH } : undefined
      }
    }); // Reset the chat session
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
                  title={isHighThinking ? "Yüksek Düşünme Modu Açık" : "Düşük Gecikme Modu Açık"}
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
                  placeholder="Mesajınızı yazın..."
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

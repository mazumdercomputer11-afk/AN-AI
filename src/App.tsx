/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Mic, 
  MicOff, 
  Image as ImageIcon, 
  Sparkles, 
  Trash2, 
  Loader2, 
  Volume2, 
  VolumeX, 
  Camera,
  X,
  Plus,
  LogOut,
  User as UserIcon,
  MessageSquare,
  History,
  Menu,
  ChevronLeft,
  Share2,
  Copy,
  Download,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { cn, Message, AppState } from './lib/utils';
import { 
  chatWithAI, 
  chatWithAIStream,
  generateImageFromText, 
  editImageWithAI, 
  textToSpeech 
} from './services/geminiService';
import { signInAnonymously } from 'firebase/auth';
import { auth } from './services/firebase';
import { useAuth } from './services/AuthContext';
import { historyService, ChatThread, ChatMessage } from './services/historyService';

export default function App() {
  const { user, loading: authLoading } = useAuth();
  
  useEffect(() => {
    if (!authLoading && !user) {
      signInAnonymously(auth).catch(err => {
        // If anonymous login fails, it's likely disabled in Firebase Console
        if (err.code === 'auth/admin-restricted-operation') {
          console.warn("Anonymous auth disabled. Please enable it in Firebase Console -> Auth -> Sign-in method.");
        } else {
          console.error("Auto Login Failed:", err);
        }
      });
    }
  }, [user, authLoading]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = false;
        recognitionRef.current.lang = 'bn-BD';
        
        recognitionRef.current.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setInput(transcript);
          setIsListening(false);
          handleSend(transcript);
        };
        
        recognitionRef.current.onend = () => setIsListening(false);
        recognitionRef.current.onerror = () => setIsListening(false);
      }
    }
  }, []);
  
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "আসসালামু আলাইকুম! আমি আপনাকে কীভাবে সাহায্য করতে পারি?"
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [appState, setAppState] = useState<AppState>('chat');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [autoVoice, setAutoVoice] = useState(true);
  const [isTapping, setIsTapping] = useState(false);
  
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Mouse & Touch Glow Effect
  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      const x = 'clientX' in e ? e.clientX : e.touches[0].clientX;
      const y = 'clientY' in e ? e.clientY : e.touches[0].clientY;
      setMousePos({ x, y });
    };
    const handleDown = () => setIsTapping(true);
    const handleUp = () => setIsTapping(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchstart', handleMove);
    window.addEventListener('mousedown', handleDown);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('touchstart', handleMove);
      window.removeEventListener('mousedown', handleDown);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  // Load threads
  useEffect(() => {
    let unsub: () => void;
    if (user) {
      unsub = historyService.subscribeToChats(user.uid, (newChats) => {
        setThreads(newChats);
      });
    }
    return () => unsub?.();
  }, [user]);

  // Speech Recognition Setup
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.lang = 'bn-BD';
        
        recognitionRef.current.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setInput(transcript);
          handleSend(transcript);
          setIsListening(false);
        };
        recognitionRef.current.onend = () => setIsListening(false);
        recognitionRef.current.onerror = () => setIsListening(false);
      }
    }
  }, []);

  // Sync messages with active thread
  useEffect(() => {
    let unsubscribe: () => void;
    if (activeThreadId) {
      unsubscribe = historyService.subscribeToMessages(activeThreadId, (newMessages) => {
        setMessages(newMessages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          image: m.image,
          isImageGeneration: m.isImageGeneration
        })));
      });
    }
    return () => unsubscribe?.();
  }, [activeThreadId]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setIsListening(true);
      recognitionRef.current?.start();
    }
  };

  const handleSend = async (overrideInput?: string) => {
    const text = overrideInput || input;
    if (!text.trim() && !selectedImage) return;

    setIsLoading(true);
    let currentThreadId = activeThreadId;

    // 1. Local update for UI immediate feedback
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      image: selectedImage || undefined
    };
    
    // We update local state regardless, but if there's no thread yet, we'll sync it after creation
    if (!currentThreadId) {
      setMessages(prev => [...prev, userMsg]);
    }

    try {
      // 2. Ensure thread exists ONLY if user is logged in
      if (!currentThreadId && user) {
        currentThreadId = await historyService.createChat(text.slice(0, 30) || "New Conversation") || null;
        if (currentThreadId) {
          setActiveThreadId(currentThreadId);
        }
      }

      // 3. Add user message to Firestore ONLY if user is logged in
      if (currentThreadId && user) {
        const extra: any = {};
        if (selectedImage) extra.image = selectedImage;
        await historyService.addMessage(currentThreadId, 'user', text, extra);
      }

      setInput('');
      const lowerText = text.toLowerCase();
      const isImageGen = lowerText.includes('generate') || lowerText.includes('create image') || lowerText.includes('আঁকো') || lowerText.includes('photo') || lowerText.includes('ছবি') || lowerText.includes('image') || lowerText.includes('pic');
      const isImageEdit = selectedImage && (lowerText.includes('edit') || lowerText.includes('change') || lowerText.includes('remove') || lowerText.includes('পরিবর্তন'));

      let responseContent = "";
      let responseImage: string | undefined = undefined;
      let isGen = false;

      if (isImageEdit && selectedImage) {
        setAppState('editing');
        const img = await editImageWithAI(selectedImage, text);
        responseImage = img || undefined;
        responseContent = responseImage ? "" : "Failed to edit image.";
        isGen = true;
        setSelectedImage(null);
      } else if (isImageGen) {
        setAppState('generating');
        // Clean prompt if it has command-like prefix
        const cleanPrompt = text.replace(/^\/generate_image\s+prompt:\s+/i, '').replace(/^generate\s+image\s+/i, '').replace(/^create\s+image\s+/i, '');
        const img = await generateImageFromText(cleanPrompt);
        responseImage = img || undefined;
        responseContent = responseImage ? "" : "Failed to generate image.";
        isGen = true;
      } else {
        setAppState('chat');
        // Use full messages for history to give Gemini more context
        const history = messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user' as any,
          parts: [{ text: m.content }]
        }));
        history.push({ role: 'user', parts: [{ text }] });

        // Add a temporary assistant message for streaming
        const assistantMsgId = (Date.now() + 1).toString();
        const initialAssistantMsg: Message = {
          id: assistantMsgId,
          role: 'assistant',
          content: '',
          isStreaming: true
        };
        
        setMessages(prev => [...prev, initialAssistantMsg]);

        try {
          const stream = chatWithAIStream(history);
          let fullContent = "";
          
          for await (const chunk of stream) {
            fullContent += chunk;
            setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: fullContent } : m));
          }
          responseContent = fullContent;
          setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, isStreaming: false } : m));
          
          if (autoVoice && responseContent) speakText(responseContent);
        } catch (err) {
          console.error("Stream Error:", err);
          responseContent = "দুঃখিত, সংযোগে সমস্যা হয়েছে। আবার চেষ্টা করুন।";
          setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: responseContent, isStreaming: false } : m));
        }
      }

      // 4. Save assistant message ONLY if user is logged in
      if (currentThreadId && user) {
        const extra: any = { isImageGeneration: isGen };
        if (responseImage) extra.image = responseImage;
        await historyService.addMessage(currentThreadId, 'assistant', responseContent, extra);
      } else if (!user) {
        // Handle unauthenticated user local state for images
        if (responseImage) {
          const assistantMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: responseContent,
            image: responseImage,
            isImageGeneration: isGen
          };
          setMessages(prev => [...prev, assistantMsg]);
        }
      }

    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
      setAppState('chat');
    }
  };

  const speakText = async (text: string) => {
    if (!text) return;
    setIsSpeaking(true);
    try {
      const audioUrl = await textToSpeech(text);
      if (audioUrl && audioRef.current) {
        audioRef.current.src = audioUrl;
        audioRef.current.load();
        
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            console.error("Audio playback interrupted/failed:", error);
            setIsSpeaking(false);
          });
        }

        audioRef.current.onended = () => setIsSpeaking(false);
        audioRef.current.onerror = (e) => {
          console.error("Audio Load Error:", e);
          setIsSpeaking(false);
        };
      } else {
        setIsSpeaking(false);
      }
    } catch (err) {
      console.error("Speech failure:", err);
      setIsSpeaking(false);
    }
  };

  const startNewChat = () => {
    setActiveThreadId(null);
    const welcomeMsg = "আসসালামু আলাইকুম! আমি আরফুর তৈরি 'এএন এআই' (AN ai)। আমি আপনাকে কীভাবে সাহায্য করতে পারি?";
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: welcomeMsg
      }
    ]);
    if (autoVoice) speakText(welcomeMsg);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
            setSelectedImage(reader.result as string);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Simple feedback could be added here if needed
  };

  const shareContent = async (msg: Message) => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'AN ai Response',
          text: msg.content,
          url: msg.image || window.location.href,
        });
      }
    } catch (err) {
      console.log('Error sharing', err);
    }
  };

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-neutral-950">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
      </div>
    );
  }

  // Login gate removed as requested. Users can still login via sidebar if they want to sync.

  return (
    <div className="flex h-screen bg-neutral-950 text-neutral-100 overflow-hidden relative selection:bg-brand/30 cursor-none md:cursor-auto">
      {/* Magic Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <motion.div 
          animate={{ x: mousePos.x - 200, y: mousePos.y - 200 }}
          transition={{ type: "spring", damping: 30, stiffness: 50, mass: 0.5 }}
          className="absolute w-[400px] h-[400px] bg-brand/10 blur-[120px] rounded-full"
        />
        
        {/* Custom Cursor / Tap Effect */}
        <motion.div
          animate={{ 
            x: mousePos.x - 10, 
            y: mousePos.y - 10,
            scale: isTapping ? 0.8 : 1,
          }}
          className="fixed w-5 h-5 border border-brand/40 rounded-full z-[100] hidden md:block pointer-events-none shadow-[0_0_15px_rgba(30,215,96,0.4)] bg-brand/5 backdrop-blur-[1px]"
        />
        <AnimatePresence>
          {isTapping && (
            <>
              <motion.div
                initial={{ x: mousePos.x - 10, y: mousePos.y - 10, scale: 1, opacity: 0.8 }}
                animate={{ scale: 5, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="fixed w-5 h-5 bg-brand/40 rounded-full z-[100] pointer-events-none shadow-[0_0_20px_rgba(30,215,96,0.6)]"
              />
              <motion.div
                initial={{ x: mousePos.x - 10, y: mousePos.y - 10, scale: 0.3, opacity: 1 }}
                animate={{ scale: 3, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8, delay: 0.05, ease: "easeOut" }}
                className="fixed w-5 h-5 border-2 border-brand/60 rounded-full z-[100] pointer-events-none"
              />
              <motion.div
                initial={{ x: mousePos.x - 2, y: mousePos.y - 2, scale: 1, opacity: 1 }}
                animate={{ scale: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="fixed w-1 h-1 bg-white rounded-full z-[101] pointer-events-none"
              />
            </>
          )}
        </AnimatePresence>
        <motion.div
          animate={{ 
            x: mousePos.x - 3, 
            y: mousePos.y - 3,
          }}
          className="fixed w-1.5 h-1.5 bg-brand rounded-full z-[100] hidden md:block pointer-events-none"
        />

        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-brand/5 blur-[150px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/5 blur-[150px] rounded-full" />
      </div>
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <>
            {/* Mobile Overlay */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
            />
            <motion.aside 
              initial={{ x: -280, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -280, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 z-50 w-72 bg-neutral-950 border-r border-white/5 flex flex-col md:relative"
            >
              <div className="p-4 flex flex-col h-full">
                <div className="md:hidden flex justify-end mb-4">
                  <button onClick={() => setIsSidebarOpen(false)} className="p-2 text-neutral-500 hover:text-white">
                    <X size={24} />
                  </button>
                </div>
                <button 
                  onClick={startNewChat}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl hover:bg-neutral-800 transition-all group mb-6 active:scale-95 shadow-lg shadow-brand/5"
                >
                  <Plus className="text-brand group-hover:scale-110 transition-transform" />
                  <span className="font-medium text-sm">New Conversation</span>
                </button>

                <div className="flex-1 overflow-y-auto space-y-1 scrollbar-hide px-1">
                  <p className="px-4 text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">History</p>
                  <AnimatePresence mode="popLayout">
                    {threads.map((thread, i) => (
                      <motion.button
                        key={thread.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        onClick={() => {
                          setActiveThreadId(thread.id);
                          if (window.innerWidth < 768) setIsSidebarOpen(false);
                        }}
                        className={cn(
                          "w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all",
                          activeThreadId === thread.id 
                            ? "bg-brand/10 text-brand ring-1 ring-brand/20 shadow-lg shadow-brand/5" 
                            : "hover:bg-neutral-900 text-neutral-400 hover:text-neutral-200"
                        )}
                      >
                        <MessageSquare size={16} className={cn("shrink-0", activeThreadId === thread.id ? "text-brand" : "text-neutral-600")} />
                        <span className="text-sm truncate font-medium">{thread.title}</span>
                      </motion.button>
                    ))}
                  </AnimatePresence>
                </div>

              <div className="pt-4 border-t border-white/5 mt-auto">
                <div className="pt-2 text-center group cursor-help">
                  <p className="text-[9px] text-neutral-600 font-bold uppercase tracking-widest transition-colors group-hover:text-neutral-400">
                    Propelled by <span className="text-brand group-hover:animate-pulse">Arfu</span>
                  </p>
                </div>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>

      <main className="flex-1 flex flex-col relative h-full">
        {/* Top Header */}
        <header className="h-16 flex items-center justify-between px-6 border-b border-white/5 backdrop-blur-md absolute top-0 w-full z-30">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-white/5 rounded-xl transition-all text-neutral-400 active:scale-90"
            >
              {isSidebarOpen ? <ChevronLeft size={20} /> : <Menu size={20} />}
            </button>
            <div className="flex items-center gap-2 group cursor-pointer">
              <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center shadow-lg shadow-brand/20 group-hover:scale-110 transition-transform">
                <Sparkles className="text-white w-5 h-5" />
              </div>
              <h2 className="font-display font-black text-xl tracking-tighter text-white">AN ai</h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setAutoVoice(!autoVoice)}
              className={cn(
                "p-2 rounded-lg transition-all",
                autoVoice ? "bg-brand/10 text-brand" : "text-neutral-500 hover:text-white"
              )}
            >
              {autoVoice ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            {activeThreadId && (
              <button 
                onClick={() => {
                  historyService.deleteChat(activeThreadId);
                  startNewChat();
                }}
                className="p-2 text-neutral-500 hover:text-red-400 transition-colors"
              >
                <Trash2 size={20} />
              </button>
            )}
          </div>
        </header>

        {/* Chat Content */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 md:px-6 pt-24 pb-32 space-y-8 scrollbar-hide scroll-smooth"
        >
          <div className="max-w-4xl mx-auto w-full">
            <AnimatePresence mode="popLayout" initial={false}>
              {messages.map((msg, i) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.4, delay: i * 0.02, type: "spring", damping: 25 }}
                  className={cn(
                    "flex group mb-6",
                    msg.role === 'user' ? "justify-end" : "justify-start"
                  )}
                >
                  <div className={cn(
                    "max-w-[90%] md:max-w-[80%] flex flex-col",
                    msg.role === 'user' ? "items-end" : "items-start"
                  )}>
                    {msg.image && (
                      <motion.div 
                        layoutId={`img-${msg.id}`}
                        className="mb-3 rounded-2xl overflow-hidden border border-white/5 shadow-2xl relative group/img max-w-full"
                      >
                        <img 
                          src={msg.image} 
                          alt="AI Content" 
                          className="max-h-[500px] w-full object-contain bg-neutral-900 hover:scale-105 transition-transform duration-500"
                          referrerPolicy="no-referrer"
                        />
                        <a 
                          href={msg.image} 
                          download={`an-ai-${msg.id}.png`}
                          className="absolute top-2 right-2 p-2 bg-black/50 text-white rounded-lg opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-black"
                          title="Download Image"
                        >
                          <Download size={16} />
                        </a>
                      </motion.div>
                    )}
                    <div className={cn(
                      "inline-block px-4 md:px-6 py-3 md:py-4 rounded-[22px] md:rounded-[26px] prose-p:my-0 prose-pre:my-2 relative shadow-sm transition-all hover:shadow-md",
                      msg.role === 'user' 
                        ? "bg-brand text-white shadow-brand/10 rounded-tr-none font-medium ml-4" 
                        : "bg-white/5 backdrop-blur-2xl text-neutral-100 border border-white/10 rounded-tl-none ring-1 ring-white/5 mr-4"
                    )}>
                      <div className="prose prose-invert prose-brand max-w-none">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                        {msg.isStreaming && msg.role === 'assistant' && (
                          <motion.span 
                            animate={{ opacity: [0, 1, 0] }}
                            transition={{ repeat: Infinity, duration: 0.8 }}
                            className="inline-block w-1.5 h-4 bg-brand ml-1 align-middle"
                          />
                        )}
                      </div>
                    </div>
                    <div className={cn(
                      "mt-2 flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity translate-y-1 group-hover:translate-y-0 duration-300",
                      msg.role === 'user' ? "justify-end" : "justify-start"
                    )}>
                      <button 
                        onClick={() => copyToClipboard(msg.content)} 
                        className="p-1.5 text-neutral-500 hover:text-brand bg-neutral-900/50 rounded-lg border border-white/5 transition-all hover:scale-110"
                        title="Copy text"
                      >
                        <Copy size={14} />
                      </button>
                      {msg.role === 'assistant' && msg.content && (
                        <button 
                          onClick={() => speakText(msg.content)} 
                          className="p-1.5 text-neutral-500 hover:text-brand bg-neutral-900/50 rounded-lg border border-white/5 transition-all hover:scale-110"
                          title="Speak"
                        >
                          <Volume2 size={14} />
                        </button>
                      )}
                      <button 
                        onClick={() => shareContent(msg)} 
                        className="p-1.5 text-neutral-500 hover:text-brand bg-neutral-900/50 rounded-lg border border-white/5 transition-all hover:scale-110"
                        title="Share"
                      >
                        <Share2 size={14} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
              {isLoading && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-4 items-center text-neutral-500 mb-8">
                  <div className="flex gap-1.5 px-4 py-3 bg-neutral-900/50 backdrop-blur-xl rounded-2xl border border-white/5">
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 rounded-full bg-brand" />
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-brand" />
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-brand" />
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.2em] font-black text-brand/60 animate-pulse">
                    AN ai is {appState === 'chat' ? 'typing' : appState === 'generating' ? 'painting' : 'editing'}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Floating Input Area */}
        <div className="absolute bottom-0 left-0 w-full p-6 pb-8 bg-gradient-to-t from-neutral-950 via-neutral-950 to-transparent">
          <div className="max-w-3xl mx-auto relative">
            <AnimatePresence>
              {selectedImage && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="absolute bottom-full mb-4 left-0 glass p-2 rounded-2xl flex items-center gap-3 border-brand/30 ring-1 ring-brand/20 shadow-2xl shadow-brand/10"
                >
                  <div className="relative w-20 h-20 rounded-lg overflow-hidden">
                    <img src={selectedImage} alt="Preview" className="w-full h-full object-cover" />
                    <button 
                      onClick={() => setSelectedImage(null)}
                      className="absolute top-1 right-1 bg-black/60 p-1 rounded-full text-white"
                    >
                      <X size={10} />
                    </button>
                  </div>
                  <div className="pr-4">
                    <p className="text-xs font-bold text-white">READY TO EDIT</p>
                    <p className="text-[10px] text-neutral-400">Describe the changes you want</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="glass p-2 pl-4 flex items-center gap-2 rounded-[28px] shadow-2xl border-white/10 ring-1 ring-white/5 bg-neutral-900/40 backdrop-blur-3xl transition-all focus-within:ring-brand/30 focus-within:border-brand/30">
              <label className="p-3 text-neutral-400 hover:text-brand cursor-pointer transition-all shrink-0 hover:scale-110 active:scale-90">
                <Camera size={22} />
                <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => setSelectedImage(reader.result as string);
                    reader.readAsDataURL(file);
                  }
                }} />
              </label>

              <input 
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                onPaste={handlePaste}
                placeholder="ম্যাজিক এর মতো কিছু তৈরি করুন..."
                className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder-neutral-500 py-4 text-sm font-sans"
              />

              <div className="flex items-center gap-2 pr-1">
                <button 
                  onClick={toggleListening}
                  className={cn(
                    "p-3 rounded-2xl transition-all shadow-lg active:scale-90",
                    isListening ? "bg-red-500 text-white animate-pulse shadow-red-500/20" : "bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10"
                  )}
                >
                  {isListening ? <MicOff size={20} /> : <Mic size={20} />}
                </button>
                <button 
                  onClick={() => handleSend()}
                  disabled={isLoading || (!input.trim() && !selectedImage)}
                  className="p-3 bg-brand text-white rounded-2xl shadow-lg shadow-brand/20 hover:scale-110 active:scale-90 disabled:opacity-30 transition-all shrink-0 hover:bg-brand/90"
                >
                  {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <audio ref={audioRef} className="hidden" />

      {/* Voice feedback overlay */}
      <AnimatePresence>
        {isSpeaking && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed top-20 right-6 z-50 glass px-4 py-3 rounded-full flex items-center gap-3 border-brand shadow-2xl">
            <div className="flex gap-1 h-3 items-end">
              {[...Array(4)].map((_, i) => (
                <motion.div key={i} animate={{ height: [4, 12, 6, 12, 4] }} transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }} className="w-1 bg-brand rounded-full" />
              ))}
            </div>
            <span className="text-xs font-bold text-brand uppercase tracking-widest">Speaking</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


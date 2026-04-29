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
  generateImageFromText, 
  editImageWithAI, 
  textToSpeech 
} from './services/geminiService';
import { useAuth } from './services/AuthContext';
import { historyService, ChatThread, ChatMessage } from './services/historyService';

export default function App() {
  const { user, login, logout, loading: authLoading } = useAuth();
  
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "আমি আপনাকে কী ভাবে সাহায্য করতে পারি?"
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [appState, setAppState] = useState<AppState>('chat');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [autoVoice, setAutoVoice] = useState(false);
  
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load threads
  useEffect(() => {
    if (user) {
      loadThreads();
    }
  }, [user]);

  const loadThreads = async () => {
    const userThreads = await historyService.getUserChats();
    setThreads(userThreads);
  };

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
  }, [activeThreadId, user]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Speech Recognition Setup
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        handleSend(transcript);
        setIsListening(false);
      };
      recognitionRef.current.onend = () => setIsListening(false);
      recognitionRef.current.onerror = () => setIsListening(false);
    }
  }, []);

  const handleSend = async (overrideInput?: string) => {
    const text = overrideInput || input;
    if (!text.trim() && !selectedImage) return;

    setIsLoading(true);
    let currentThreadId = activeThreadId;

    // Local update for UI immediate feedback
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      image: selectedImage || undefined
    };
    
    if (!user) {
      setMessages(prev => [...prev, userMsg]);
    }

    try {
      // 1. Ensure thread exists ONLY if user is logged in
      if (!currentThreadId && user) {
        currentThreadId = await historyService.createChat(text.slice(0, 30) || "New Conversation") || null;
        if (currentThreadId) {
          setActiveThreadId(currentThreadId);
          loadThreads();
        }
      }

      // 2. Add user message to Firestore ONLY if user is logged in
      if (currentThreadId && user) {
        const extra: any = {};
        if (selectedImage) extra.image = selectedImage;
        await historyService.addMessage(currentThreadId, 'user', text, extra);
      }

      setInput('');
      const lowerText = text.toLowerCase();
      const isImageGen = lowerText.includes('generate') || lowerText.includes('create image') || lowerText.includes('আঁকো');
      const isImageEdit = selectedImage && (lowerText.includes('edit') || lowerText.includes('change') || lowerText.includes('remove'));

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
        const img = await generateImageFromText(text);
        responseImage = img || undefined;
        responseContent = responseImage ? "" : "Failed to generate image.";
        isGen = true;
      } else {
        setAppState('chat');
        const history = messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user' as any,
          parts: [{ text: m.content }]
        }));
        history.push({ role: 'user', parts: [{ text }] });
        responseContent = await chatWithAI(history);
        
        if (autoVoice && responseContent) speakText(responseContent);
      }

      // 3. Save assistant message ONLY if user is logged in
      if (currentThreadId && user) {
        const extra: any = { isImageGeneration: isGen };
        if (responseImage) extra.image = responseImage;
        await historyService.addMessage(currentThreadId, 'assistant', responseContent, extra);
      } else if (!user) {
        // Update local state for unauthenticated users
        const assistantMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: responseContent,
          image: responseImage,
          isImageGeneration: isGen
        };
        setMessages(prev => [...prev, assistantMsg]);
      }

    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
      setAppState('chat');
    }
  };

  const speakText = async (text: string) => {
    setIsSpeaking(true);
    const audioUrl = await textToSpeech(text);
    if (audioUrl && audioRef.current) {
      audioRef.current.src = audioUrl;
      audioRef.current.play();
      audioRef.current.onended = () => setIsSpeaking(false);
    } else {
      setIsSpeaking(false);
    }
  };

  const startNewChat = () => {
    setActiveThreadId(null);
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: "আমি আপনাকে কী ভাবে সাহায্য করতে পারি?"
      }
    ]);
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
    <div className="flex h-screen bg-neutral-950 text-neutral-100 overflow-hidden">
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.aside 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 300, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="border-r border-neutral-900 bg-neutral-950 flex flex-col z-40"
          >
            <div className="p-4 flex flex-col h-full">
              <button 
                onClick={startNewChat}
                className="w-full flex items-center gap-3 px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl hover:bg-neutral-800 transition-all group mb-6"
              >
                <Plus className="text-brand group-hover:scale-110 transition-transform" />
                <span className="font-medium text-sm">New Conversation</span>
              </button>

              <div className="flex-1 overflow-y-auto space-y-1 scrollbar-hide">
                <p className="px-4 text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">History</p>
                {threads.map((thread) => (
                  <button
                    key={thread.id}
                    onClick={() => setActiveThreadId(thread.id)}
                    className={cn(
                      "w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-colors",
                      activeThreadId === thread.id ? "bg-brand/10 text-brand outline outline-brand/20" : "hover:bg-neutral-900/50 text-neutral-400 hover:text-neutral-200"
                    )}
                  >
                    <MessageSquare size={16} className="shrink-0" />
                    <span className="text-sm truncate font-medium">{thread.title}</span>
                  </button>
                ))}
              </div>

              <div className="pt-4 border-t border-neutral-900 mt-4 space-y-4">
                {user ? (
                  <>
                    <div className="flex items-center gap-3 px-2">
                      <img src={user.photoURL || ''} className="w-10 h-10 rounded-full border-2 border-brand/20" alt="Me" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white truncate">{user.displayName}</p>
                        <p className="text-[10px] text-neutral-500 truncate">{user.email}</p>
                      </div>
                    </div>
                    <button 
                      onClick={logout}
                      className="w-full flex items-center gap-3 px-4 py-3 text-neutral-400 hover:text-red-400 hover:bg-neutral-900 rounded-xl transition-all"
                    >
                      <LogOut size={16} />
                      <span className="text-sm font-medium">Log out</span>
                    </button>
                  </>
                ) : (
                  <button 
                    onClick={login}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-white text-black rounded-xl font-bold hover:bg-neutral-200 transition-all active:scale-95"
                  >
                    <UserIcon size={16} />
                    <span className="text-sm">Sign In / Logic</span>
                  </button>
                )}
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <main className="flex-1 flex flex-col relative h-full">
        {/* Top Header */}
        <header className="h-16 flex items-center justify-between px-6 border-b border-neutral-900 glass absolute top-0 w-full z-30">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-neutral-800 rounded-lg transition-colors text-neutral-400"
            >
              {isSidebarOpen ? <ChevronLeft size={20} /> : <Menu size={20} />}
            </button>
            <div className="flex items-center gap-2">
              <Sparkles className="text-brand w-5 h-5" />
              <h2 className="font-display font-bold text-lg tracking-tight">AN ai</h2>
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
                  loadThreads();
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
          className="flex-1 overflow-y-auto px-6 pt-24 pb-32 space-y-8 scrollbar-hide"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex group",
                  msg.role === 'user' ? "justify-end" : "justify-start"
                )}
              >
                <div className={cn(
                  "max-w-[80%]",
                  msg.role === 'user' ? "text-right" : "text-left"
                )}>
                  {msg.image && (
                    <motion.div 
                      layoutId={`img-${msg.id}`}
                      className="mb-3 rounded-2xl overflow-hidden border border-neutral-800 shadow-2xl relative group/img"
                    >
                      <img 
                        src={msg.image} 
                        alt="AI Content" 
                        className="max-h-[400px] w-full object-contain bg-neutral-900"
                        referrerPolicy="no-referrer"
                      />
                      <a 
                        href={msg.image} 
                        download={`nexus-ai-${msg.id}.png`}
                        className="absolute top-2 right-2 p-2 bg-black/50 text-white rounded-lg opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-black"
                      >
                        <ImageIcon size={16} />
                      </a>
                    </motion.div>
                  )}
                  <div className={cn(
                    "inline-block px-5 py-4 rounded-2xl markdown-body relative",
                    msg.role === 'user' 
                      ? "bg-brand text-white shadow-xl shadow-brand/10" 
                      : "glass text-neutral-200 border border-neutral-800"
                  )}>
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                  <div className={cn(
                    "mt-2 flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity",
                    msg.role === 'user' ? "justify-end" : "justify-start"
                  )}>
                    <button 
                      onClick={() => copyToClipboard(msg.content)} 
                      className="p-1.5 text-neutral-500 hover:text-brand bg-neutral-900/50 rounded-lg border border-neutral-800 transition-all hover:scale-110"
                      title="Copy text"
                    >
                      <Copy size={14} />
                    </button>
                    {msg.role === 'assistant' && (
                      <button 
                        onClick={() => speakText(msg.content)} 
                        className="p-1.5 text-neutral-500 hover:text-brand bg-neutral-900/50 rounded-lg border border-neutral-800 transition-all hover:scale-110"
                        title="Speak"
                      >
                        <Volume2 size={14} />
                      </button>
                    )}
                    <button 
                      onClick={() => shareContent(msg)} 
                      className="p-1.5 text-neutral-500 hover:text-brand bg-neutral-900/50 rounded-lg border border-neutral-800 transition-all hover:scale-110"
                      title="Share"
                    >
                      <Share2 size={14} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
            {isLoading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-4 items-center text-neutral-500">
                <Loader2 size={16} className="animate-spin text-brand" />
                <span className="text-xs uppercase tracking-widest font-bold">
                  AN ai is {appState === 'chat' ? 'typing' : appState === 'generating' ? 'painting' : 'editing'}...
                </span>
              </motion.div>
            )}
          </AnimatePresence>
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

            <div className="glass p-2 pl-4 flex items-center gap-2 rounded-3xl shadow-2xl border-neutral-800 ring-1 ring-white/5">
              <label className="p-3 text-neutral-400 hover:text-white cursor-pointer transition-colors shrink-0">
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
                placeholder="যেকোনো কিছু জিজ্ঞাসা করুন বা ছবি তৈরি করতে বলুন..."
                className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder-neutral-500 py-4 text-sm font-sans"
              />

              <div className="flex items-center gap-2 pr-1">
                <button 
                  onClick={() => {
                    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
                    if (isListening) recognitionRef.current?.stop();
                    else { setIsListening(true); recognitionRef.current?.start(); }
                  }}
                  className={cn(
                    "p-3 rounded-2xl transition-all",
                    isListening ? "bg-red-500 text-white animate-pulse" : "bg-neutral-800/50 text-neutral-400 hover:text-white"
                  )}
                >
                  {isListening ? <MicOff size={20} /> : <Mic size={20} />}
                </button>
                <button 
                  onClick={() => handleSend()}
                  disabled={isLoading || (!input.trim() && !selectedImage)}
                  className="p-3 bg-brand text-white rounded-2xl shadow-lg shadow-brand/20 hover:scale-105 active:scale-95 disabled:opacity-50 transition-all shrink-0"
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


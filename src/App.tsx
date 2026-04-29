/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Image as ImageIcon, 
  Sparkles, 
  Trash2, 
  Loader2, 
  Camera,
  X,
  Plus,
  Pin,
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
  editImageWithAI 
} from './services/geminiService';
import { signInAnonymously } from 'firebase/auth';
import { auth, checkConnection } from './services/firebase';
import { useAuth } from './services/AuthContext';
import { historyService, ChatThread, ChatMessage } from './services/historyService';

export default function App() {
  const { user, loading: authLoading, login, logout } = useAuth();
  const [connectionOk, setConnectionOk] = useState(true);
  
  const [anonDisabled, setAnonDisabled] = useState(false);
  
  useEffect(() => {
    if (!authLoading && !user) {
      signInAnonymously(auth).catch(err => {
        if (err.code === 'auth/admin-restricted-operation') {
          console.warn("Anonymous auth disabled.");
          setAnonDisabled(true);
        } else if (err.code === 'auth/network-request-failed') {
          console.warn("Firebase network connection failed. Retrying implicitly...");
          setConnectionOk(false);
        } else {
          console.error("Auto Login Failed:", err);
          setConnectionOk(false);
        }
      });
    }
  }, [user, authLoading]);

  // Periodic connection check
  useEffect(() => {
    const check = async () => {
      const ok = await checkConnection();
      setConnectionOk(ok);
    };
    const interval = setInterval(check, 60000); // Check every 60s
    check();
    return () => clearInterval(interval);
  }, []);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "আসসালামু আলাইকুম! আমি AN - AI। বলুন তো, আজ আপনাকে কীভাবে সাহায্য করতে পারি?"
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [appState, setAppState] = useState<AppState>('chat');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);

  const scrollRef = useRef<HTMLDivElement>(null);

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

  const startNewChat = () => {
    setActiveThreadId(null);
    const welcomeMsg = "আসসালামু আলাইকুম! আমি AN - AI। বলুন তো, আমি আপনাকে কীভাবে সাহায্য করতে পারি?";
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: welcomeMsg
      }
    ]);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const handleTogglePin = async (e: React.MouseEvent, threadId: string, currentPin: boolean) => {
    e.stopPropagation();
    await historyService.togglePinChat(threadId, currentPin);
  };

  const handleDeleteThread = async (e: React.MouseEvent, threadId: string) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (window.confirm("আপনি কি নিশ্চিতভাবে এই চ্যাটটি ডিলিট করতে চান? এটি আর ফিরিয়ে আনা যাবে না।")) {
      try {
        await historyService.deleteChat(threadId);
        if (activeThreadId === threadId) {
          startNewChat();
        }
        alert("চ্যাটটি সফলভাবে ডিলিট করা হয়েছে।");
      } catch (error: any) {
        console.error("Delete failure details:", error);
        alert("দুঃখিত, চ্যাট ডিলিট করতে গিয়ে টেকনিক্যাল সমস্যা হয়েছে। দয়া করে আবার ট্রাই করুন।");
      }
    }
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
    <div className="flex h-screen bg-neutral-950 text-neutral-100 overflow-hidden relative selection:bg-brand/30 selection:text-white">
      {/* Subtle Background Pulses */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-brand/5 blur-[150px] rounded-full" />
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
                      <motion.div
                        key={thread.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="group relative"
                      >
                        <button
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
                          <span className="text-sm truncate font-medium pr-12">{thread.title}</span>
                          {thread.isPinned && (
                            <Pin size={10} className="absolute right-4 top-1/2 -translate-y-1/2 text-brand fill-brand opacity-100 group-hover:opacity-0 transition-opacity" />
                          )}
                        </button>
                        
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={(e) => handleTogglePin(e, thread.id, !!thread.isPinned)}
                            className="p-1.5 hover:bg-neutral-800 rounded-lg text-neutral-500 hover:text-brand transition-colors"
                            title={thread.isPinned ? "Unpin" : "Pin"}
                          >
                            <Pin size={14} className={cn(thread.isPinned ? "fill-brand text-brand" : "")} />
                          </button>
                          <button 
                            onClick={(e) => handleDeleteThread(e, thread.id)}
                            className="p-1.5 hover:bg-neutral-800 rounded-lg text-neutral-500 hover:text-red-500 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>

                <div className="pt-4 border-t border-white/5 mt-auto">
                  {user && (
                    <div className="mb-4">
                      <div className="flex items-center gap-3 px-4 py-3 bg-neutral-900/50 rounded-xl mb-2">
                        <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center overflow-hidden border border-brand/20">
                          {user.photoURL ? (
                            <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" />
                          ) : (
                            <UserIcon size={16} className="text-brand" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate text-white">{user.displayName || 'User'}</p>
                          <p className="text-[10px] text-neutral-500 truncate">{user.email}</p>
                        </div>
                      </div>
                      <button 
                        onClick={async () => {
                          if (confirm("আপনি কি লগআউট করতে চান?")) {
                            await logout();
                            startNewChat();
                          }
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2 text-neutral-400 hover:text-red-400 hover:bg-red-400/5 transition-all rounded-lg group"
                      >
                        <LogOut size={16} className="group-hover:scale-110 transition-transform" />
                        <span className="text-sm font-medium">Logout</span>
                      </button>
                    </div>
                  )}
                  <div className="pt-2 text-center group cursor-help">
                  <p className="text-[9px] text-neutral-600 font-bold uppercase tracking-widest transition-colors group-hover:text-neutral-400">
                    Powered by <a href="https://www.instagram.com/_arfan_arfu19/" target="_blank" rel="noopener noreferrer" className="text-brand group-hover:animate-pulse hover:underline">Arfu</a>
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
            {activeThreadId && (
              <button 
                onClick={(e) => handleDeleteThread(e, activeThreadId)}
                className="p-2 text-neutral-500 hover:text-red-400 transition-colors"
                title="Delete Chat"
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
            {!connectionOk && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mb-8 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-between backdrop-blur-xl"
              >
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-sm font-medium">Internet error! Connecting...</span>
                </div>
                <button 
                  onClick={async () => {
                    const ok = await checkConnection();
                    setConnectionOk(ok);
                  }}
                  className="px-4 py-1.5 bg-red-500 text-white rounded-xl text-xs font-bold hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20"
                >
                  RETRY
                </button>
              </motion.div>
            )}

            {anonDisabled && !user && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8 p-5 rounded-2xl bg-brand/10 border border-brand/20 text-brand backdrop-blur-xl flex flex-col md:flex-row items-center gap-4 text-center md:text-left"
              >
                <div className="flex-1">
                  <h3 className="font-bold text-base mb-1">Anonymous Auth is Disabled</h3>
                  <p className="text-sm text-neutral-300">হিস্ট্রি সেভ করতে এবং AI এর সাথে আড্ডা দিতে প্রপারলি লগইন করুন অথবা Firebase কনসোলে Anonymous Auth এনাবল করুন।</p>
                </div>
                <button 
                  onClick={login}
                  className="px-6 py-2.5 bg-brand text-black rounded-xl text-sm font-black hover:bg-white transition-all shadow-lg shadow-brand/20 active:scale-95 whitespace-nowrap"
                >
                  LOGIN WITH GOOGLE
                </button>
              </motion.div>
            )}
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
        <div className="absolute bottom-0 left-0 w-full p-4 md:p-6 pb-6 md:pb-8 bg-gradient-to-t from-neutral-950 via-neutral-950 to-transparent">
          <div className="max-w-3xl mx-auto relative w-full px-4">
            <AnimatePresence>
              {selectedImage && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="absolute bottom-full mb-4 left-0 glass p-2 rounded-2xl flex items-center gap-3 border-brand/30 ring-1 ring-brand/20 shadow-2xl shadow-brand/10 mx-2"
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

            <div className="glass p-1.5 md:p-2 pl-3 md:pl-4 flex items-center gap-1 md:gap-2 rounded-[28px] shadow-2xl border-white/10 ring-1 ring-white/5 bg-neutral-900/40 backdrop-blur-3xl transition-all focus-within:ring-brand/30 focus-within:border-brand/30">
              <label className="p-2 md:p-3 text-neutral-400 hover:text-brand cursor-pointer transition-all shrink-0 hover:scale-110 active:scale-90">
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
                className="flex-1 min-w-0 bg-transparent border-none focus:ring-0 text-white placeholder-neutral-500 py-4 text-sm font-sans"
              />

              <div className="flex items-center gap-1 md:gap-2 pr-1.5 md:pr-2">
                <button 
                  onClick={() => handleSend()}
                  disabled={isLoading || (!input.trim() && !selectedImage)}
                  className="p-2.5 md:p-3 bg-brand text-white rounded-2xl shadow-lg shadow-brand/20 hover:scale-110 active:scale-90 disabled:opacity-30 transition-all shrink-0 hover:bg-brand/90"
                >
                  {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Voice feedback overlay removed */}
    </div>
  );
}


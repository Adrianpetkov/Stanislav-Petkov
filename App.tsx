
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { Message, ConnectionStatus } from './types';
import { decode, encode, decodeAudioData, floatTo16BitPCM } from './utils/audio';
import { 
  Mic, 
  Send, 
  Loader2, 
  Zap,
  MessageSquare,
  AlertCircle
} from 'lucide-react';

const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const TEXT_MODEL = 'gemini-3-flash-preview';

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTab, setActiveTab] = useState<'voice' | 'chat'>('chat');
  const [textInput, setTextInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<any>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  useEffect(() => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
    chatRef.current = ai.chats.create({
      model: TEXT_MODEL,
      config: {
        systemInstruction: "Ти си Z04, интелигентен асистент на български. Отговаряй винаги на български език, ясно и приятелски. Функцията за генериране на снимки е изключена.",
      }
    });
  }, []);

  const stopSession = useCallback(() => {
    if (sessionRef.current) { sessionRef.current.close(); sessionRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(track => track.stop()); streamRef.current = null; }
    if (scriptProcessorRef.current) { scriptProcessorRef.current.disconnect(); scriptProcessorRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setStatus(ConnectionStatus.DISCONNECTED);
  }, []);

  const startVoiceSession = async () => {
    try {
      setStatus(ConnectionStatus.CONNECTING);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const sessionPromise = ai.live.connect({
        model: LIVE_MODEL,
        callbacks: {
          onopen: () => setStatus(ConnectionStatus.CONNECTED),
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts?.find(p => p.inlineData)?.inlineData?.data;
            if (base64Audio && outputContextRef.current) {
              const ctx = outputContextRef.current;
              if (ctx.state === 'suspended') await ctx.resume();
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const sourceNode = ctx.createBufferSource();
              sourceNode.buffer = audioBuffer;
              sourceNode.connect(ctx.destination);
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              sourceNode.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(sourceNode);
            }
          },
          onerror: () => stopSession(),
          onclose: () => setStatus(ConnectionStatus.DISCONNECTED)
        },
        config: { responseModalities: [Modality.AUDIO], systemInstruction: "Ти си Z04. Отговаряй кратко на български." },
      });
      sessionRef.current = await sessionPromise;
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const scriptProcessor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      scriptProcessor.onaudioprocess = (e) => {
        if (!sessionRef.current) return;
        sessionRef.current.sendRealtimeInput({ media: { data: encode(floatTo16BitPCM(e.inputBuffer.getChannelData(0))), mimeType: 'audio/pcm;rate=16000' } });
      };
      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContextRef.current.destination);
      scriptProcessorRef.current = scriptProcessor;
    } catch (error) { setStatus(ConnectionStatus.ERROR); }
  };

  const handleSendText = async () => {
    if (!textInput.trim() || !chatRef.current) return;
    const userText = textInput;
    setTextInput('');
    setIsThinking(true);
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text: userText, timestamp: new Date() }]);
    try {
      const result = await chatRef.current.sendMessage({ message: userText });
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'model', text: result.text, timestamp: new Date() }]);
    } catch (err) { setMessages(prev => [...prev, { id: 'err', role: 'model', text: "Възникна грешка в системата на Z04.", timestamp: new Date() }]); }
    finally { setIsThinking(false); }
  };

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto p-4 md:p-6">
      <header className="flex items-center justify-between mb-4 bg-slate-800/40 p-4 rounded-3xl border border-white/5 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500 rounded-xl shadow-lg"><Zap className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="font-bold text-lg text-white/90">Z04</h1>
            <p className="text-[10px] text-indigo-400 font-bold tracking-widest uppercase">Система Активна</p>
          </div>
        </div>
        <div className="flex bg-slate-900/50 p-1 rounded-xl border border-white/5">
          {['chat', 'voice'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab as any)} className={`px-6 py-1.5 rounded-lg text-xs font-bold transition-all uppercase ${activeTab === tab ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-500'}`}>{tab === 'chat' ? 'Чат' : 'Глас'}</button>
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex flex-col bg-slate-900/40 rounded-[2.5rem] border border-white/10 shadow-2xl relative">
        {activeTab === 'chat' ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center opacity-30 text-center px-10">
                <MessageSquare className="w-12 h-12 mb-4 text-indigo-400" />
                <p className="text-sm font-medium">Система Z04 е готова за разговор.</p>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2`}>
                <div className={`max-w-[90%] px-5 py-3 rounded-2xl ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-800 text-gray-100 rounded-tl-none border border-white/5'}`}>
                  <p className="text-sm leading-relaxed">{msg.text}</p>
                </div>
              </div>
            ))}
            {isThinking && (
              <div className="flex items-center gap-2 text-indigo-400 px-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-[10px] font-black uppercase tracking-widest">Обработка...</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            {status === ConnectionStatus.CONNECTED ? (
              <div className="space-y-8">
                <div className="flex items-end gap-2 h-20">
                  {[...Array(12)].map((_, i) => <div key={i} className="w-2 bg-indigo-500 rounded-full animate-bounce" style={{ height: `${20 + Math.random() * 80}%`, animationDelay: `${i * 0.05}s` }} />)}
                </div>
                <h2 className="text-xl font-bold">Z04 слуша...</h2>
                <button onClick={stopSession} className="px-12 py-3 bg-red-500 text-white rounded-2xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-red-500/20 active:scale-95 transition-all">Прекрати</button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="p-8 bg-indigo-500/10 rounded-full inline-block border border-indigo-500/20"><Mic className="w-10 h-10 text-indigo-500" /></div>
                <h2 className="text-xl font-bold text-white">Гласов режим</h2>
                <button onClick={startVoiceSession} className="bg-indigo-600 text-white px-12 py-4 rounded-2xl font-black text-sm shadow-2xl shadow-indigo-600/40 uppercase tracking-widest active:scale-95 transition-all">Старт</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="p-4 bg-slate-900/80 border-t border-white/5 backdrop-blur-md">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-[10px] text-amber-200/80 font-bold uppercase tracking-tight">Функцията вече не е налична за снимки</span>
              </div>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                  placeholder="Въведете съобщение към Z04..."
                  className="flex-1 bg-slate-800 border border-white/10 rounded-2xl px-5 py-3.5 outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-white transition-all shadow-inner"
                />
                <button onClick={handleSendText} disabled={isThinking || !textInput.trim()} className="p-4 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-500 disabled:opacity-20 transition-all active:scale-95"><Send className="w-5 h-5" /></button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;

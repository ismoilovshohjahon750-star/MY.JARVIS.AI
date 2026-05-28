/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import { 
  Mic, MicOff, MessageSquare, Volume2, VolumeX, Radio, Play, Pause, Send,
  Trash2, Globe, Wifi, ServerCrash, AudioLines, Sparkles, RefreshCw, AlertCircle, ExternalLink,
  Cpu, Shield, Terminal, Zap, Clock, Activity, Headphones
} from "lucide-react";
import { Message, ConnectionState, LiveMessage } from "./types";
import { motion, AnimatePresence } from "motion/react";

// Predefined conversational prompts in Uzbek
const SUGGESTIONS = [
  "Menga o'zbek tilida latifa aytib ber",
  "O'zbekistondagi tarixiy joylar haqida gapir",
  "Yaxshi fikrlash sirlarini o'rgat",
  "Menga ingliz tilini o'rganishda maslahatlar ber"
];

// Uzbek/English localized strings
const LOCATIONS = {
  uz: {
    title: "OVOZLI AI CHAT BOT",
    subtitle: "Gemini 3.1 Live & TTS texnologiyalariga asoslangan real-vaqt ovozli suhbatdoshingiz",
    modeLive: "Jonli Muloqot (Real-Time)",
    modeChat: "Xabarlar (Push-to-Talk)",
    startLive: "Muloqotni Boshlash",
    stopLive: "Muloqotni To'xtatish",
    liveListening: "Sizni tinglayapman...",
    liveSpeaking: "Ovozli AI javob bermoqda...",
    liveConnecting: "Gemini serveriga ulanmoqda...",
    liveConnected: "Jonli aloqa o'rnatildi",
    liveDisconnected: "Aloqa uzilgan",
    liveError: "Ulanish xatosi",
    micPermission: "Mikrofon ruxsati berilmagan",
    recordPress: "Ovoz yozish uchun bosing",
    recordStop: "Yuborish",
    inputPlaceholder: "Xabaringizni matn ko'rinishida yozing...",
    clearHistory: "Tarixni tozalash",
    noHistory: "Suhbatlar tarixi hozircha bo'sh. Ovozli xabar yuboring yoki quyidagi takliflardan foydalaning!",
    transcribing: "Ovoz tahlil qilinmoqda...",
    aiTyping: "Ovozli AI o'ylamoqda...",
    voiceSelectPrompt: "Ovoz tanlang:",
    systemStatus: "Tizim holati:",
    online: "Aktiv",
    offline: "Ulanmagan",
    noApiKeyWarning: "Diqqat: GEMINI_API_KEY topilmadi! Iltimos, Settings -> Secrets panelida API kalitingizni kiriting.",
    voiceInstructions: "Yozib olish uchun mikrofonga bosing va gapiring. AI ovoz chiqarib javob beradi!",
    interruptionHint: "Ovozni to'xtatish"
  },
  en: {
    title: "VOICE AI CHAT BOT",
    subtitle: "Your real-time voice companion powered by Gemini 3.1 Live & TTS",
    modeLive: "Live Conversation (Real-Time)",
    modeChat: "Messages (Push-to-Talk)",
    startLive: "Start Conversation",
    stopLive: "Stop Conversation",
    liveListening: "Listening to you...",
    liveSpeaking: "AI is responding...",
    liveConnecting: "Connecting to Gemini...",
    liveConnected: "Live conversation active",
    liveDisconnected: "Disconnected",
    liveError: "Connection Error",
    micPermission: "Microphone permission denied",
    recordPress: "Click to record voice",
    recordStop: "Send",
    inputPlaceholder: "Type your message...",
    clearHistory: "Clear History",
    noHistory: "No messages yet. Send a voice message or click below to start!",
    transcribing: "Transcribing your voice...",
    aiTyping: "AI is thinking...",
    voiceSelectPrompt: "Choose voice:",
    systemStatus: "System Status:",
    online: "Online",
    offline: "Offline",
    noApiKeyWarning: "Warning: GEMINI_API_KEY is missing! Set it in the Secrets configuration.",
    voiceInstructions: "Press mic, speak your mind, and AI will respond with full speech synthesis!",
    interruptionHint: "Mute AI"
  }
};

export default function App() {
  const [lang, setLang] = useState<"uz" | "en">("uz");
  const t = LOCATIONS[lang];

  // Core App Modes
  // 'live' for real-time WebSocket muloqot, 'chat' for recording / TTS messages
  const [activeTab, setActiveTab] = useState<"live" | "chat">("live");

  // YouTube player state variables
  const [currentPlayingVideo, setCurrentPlayingVideo] = useState<{ videoId: string; title: string; image: string } | null>(null);
  const [isVideoMinimized, setIsVideoMinimized] = useState<boolean>(false);
  const [musicSearchQuery, setMusicSearchQuery] = useState<string>("");
  const [isSearchingMusic, setIsSearchingMusic] = useState<boolean>(false);

  // Voice configurations
  const [selectedVoice, setSelectedVoice] = useState<string>("Zephyr");

  // System States
  const [isConfirmingClearHistory, setIsConfirmingClearHistory] = useState<boolean>(false);
  const [apiKeyMissing, setApiKeyMissing] = useState<boolean>(false);
  const [checkingApiKey, setCheckingApiKey] = useState<boolean>(false);
  const [apiKeyCheckResult, setApiKeyCheckResult] = useState<string | null>(null);
  const [micGranted, setMicGranted] = useState<boolean>(true);
  const [ttsFallbackActive, setTtsFallbackActive] = useState<boolean>(false);

  // System Telemetry Metrics
  const [pingSpeed, setPingSpeed] = useState<number>(24);
  const [cpuUsage, setCpuUsage] = useState<number>(11);
  const [memoryUsage, setMemoryUsage] = useState<number>(3.15);
  const [systemTime, setSystemTime] = useState<string>("");

  // Traditional Chat Messages state
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem("voice_ai_chat_history");
    if (saved) {
      try {
        return JSON.parse(saved).map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        }));
      } catch (e) {
        return [];
      }
    }
    return [];
  });
  const [inputText, setInputText] = useState<string>("");
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [currentlyPlayingMessageId, setCurrentlyPlayingMessageId] = useState<string | null>(null);

  // Live WebSocket state variables
  const [liveState, setLiveState] = useState<ConnectionState>("disconnected");
  const [liveLog, setLiveLog] = useState<string[]>([]);
  const [liveTranscription, setLiveTranscription] = useState<{user: string; ai: string}>({ user: "", ai: "" });
  const [liveSpeakingState, setLiveSpeakingState] = useState<"listening" | "speaking" | "idle">("idle");
  const [micPermError, setMicPermError] = useState<boolean>(false);
  const [isLiveSimulated, setIsLiveSimulated] = useState<boolean>(false);
  const isLiveSimulatedRef = useRef<boolean>(false);

  const setLiveSimulatedWithRef = (val: boolean) => {
    setIsLiveSimulated(val);
    isLiveSimulatedRef.current = val;
  };

  // Traditional MediaRecorder refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // HTML audio player refs
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);

  // Live Mode Audio Streaming refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const nextPlaybackTime = useRef<number>(0);
  const activeSources = useRef<AudioBufferSourceNode[]>([]);
  const liveAudioDataRef = useRef<string[]>([]); // holds incoming live audio buffer data
  const recognitionRef = useRef<any>(null);

  // Auto-scroll chat history helper
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Check API Key on startup passively via the secure config endpoint and start telemetry intervals
  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.apiKeyMissing === "boolean") {
          setApiKeyMissing(data.apiKeyMissing);
        }
      })
      .catch((err) => {
        console.warn("Could not verify API state passively upon startup:", err);
      });

    // Clock Tick update loop
    const updateTime = () => {
      const now = new Date();
      setSystemTime(now.toLocaleTimeString("uz-UZ", { hour12: false }));
    };
    updateTime();
    const clockInterval = setInterval(updateTime, 1000);

    // Telemetry noise generator loop (adds interactive jitter to make diagnostic gauges realistic)
    const telemetryInterval = setInterval(() => {
      setPingSpeed(prev => {
        const delta = Math.floor(Math.random() * 5) - 2;
        return Math.max(18, Math.min(38, prev + delta));
      });
      setCpuUsage(prev => {
        const delta = Math.floor(Math.random() * 3) - 1.5;
        const next = prev + delta;
        return Number(Math.max(6, Math.min(22, next)).toFixed(1));
      });
      setMemoryUsage(prev => {
        const delta = (Math.random() * 0.04) - 0.02;
        return Number(Math.max(3.05, Math.min(3.28, prev + delta)).toFixed(3));
      });
    }, 2500);

    return () => {
      clearInterval(clockInterval);
      clearInterval(telemetryInterval);
    };
  }, []);

  // Save chat messages to localStorage dynamically
  useEffect(() => {
    localStorage.setItem("voice_ai_chat_history", JSON.stringify(messages));
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Clean up Live session audio context if tab switched or page left
  useEffect(() => {
    return () => {
      stopLiveMuloqot();
    };
  }, []);

  // -------------------------------------------------------------
  // TRADITIONAL CHAT MODE: Voice Recording & Input Submission
  // -------------------------------------------------------------

  const startRecording = async () => {
    if (isProcessing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      setMicGranted(true);
      
      let mimeType = "audio/webm";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/ogg";
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(recordedChunksRef.current, { type: mimeType });
        await handleAudioUpload(audioBlob);
        
        // shutdown mic tracks
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Camera/Mic recording failed:", err);
      setMicGranted(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleAudioUpload = async (audioBlob: Blob) => {
    setIsProcessing(true);
    
    // Add temporary transcribing item to message list
    const tempId = "temp-" + Date.now();
    const tempMsg: Message = {
      id: tempId,
      sender: "user",
      text: "🎤 " + t.transcribing,
      timestamp: new Date(),
      isTranscribing: true
    };
    setMessages(prev => [...prev, tempMsg]);

    try {
      // FileReader to convert blob to Base64
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(",")[1];
        
        // Prepare history for API post
        const activeHistory = messages
          .filter(m => !m.isTranscribing)
          .slice(-10) // past 10 exchanges
          .map(m => ({
            sender: m.sender,
            text: m.text
          }));

        const response = await fetch("/api/chat-voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioBase64: base64Audio,
            history: activeHistory,
            voice: selectedVoice
          })
        });

        if (!response.ok) {
          throw new Error("Tizimda javob olish xatoligi yuz berdi");
        }

        const data = await response.json();

        // Update the temporary transcribing message with the actual transcribed text
        setMessages(prev => {
          return prev.map(m => {
            if (m.id === tempId) {
              return {
                ...m,
                text: data.userText || "[Ovozli xabar]",
                isTranscribing: false
              };
            }
            return m;
          });
        });

        // Add Gemini reply Message
        const responseId = "gemini-" + Date.now();
        const geminiMsg: Message = {
          id: responseId,
          sender: "ai",
          text: data.aiText,
          hasAudio: true,
          audioBase64: data.audioBase64 || "",
          timestamp: new Date(),
          youtubeVideo: data.youtubeVideo || undefined
        };
        setMessages(prev => [...prev, geminiMsg]);

        if (data.youtubeVideo) {
          setCurrentPlayingVideo(data.youtubeVideo);
          setIsVideoMinimized(false);
        }

        if (data.ttsFallback) {
          setTtsFallbackActive(true);
        }

        // Auto play the returned voice!
        if (data.audioBase64) {
          playBase64Audio(responseId, data.audioBase64, data.aiText);
        } else {
          // Play via standard client-side Speech Synthesis fallback
          playBase64Audio(responseId, "", data.aiText);
        }
      };
    } catch (error: any) {
      console.error("Audio processor error:", error);
      // Remove temporary message on error
      setMessages(prev => prev.filter(m => m.id !== tempId));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isProcessing) return;

    const userText = inputText.trim();
    setInputText("");
    setIsProcessing(true);

    const userId = "tuser-" + Date.now();
    const userMsg: Message = {
      id: userId,
      sender: "user",
      text: userText,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const activeHistory = messages
        .slice(-10)
        .map(m => ({
          sender: m.sender,
          text: m.text
        }));

      const response = await fetch("/api/chat-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageText: userText,
          history: [...activeHistory, { sender: "user", text: userText }],
          voice: selectedVoice
        })
      });

      if (!response.ok) {
        throw new Error("Sever javob qaytara olmadi");
      }

      const data = await response.json();

      const responseId = "gemini-" + Date.now();
      const geminiMsg: Message = {
        id: responseId,
        sender: "ai",
        text: data.aiText,
        hasAudio: true,
        audioBase64: data.audioBase64 || "",
        timestamp: new Date(),
        youtubeVideo: data.youtubeVideo || undefined
      };
      setMessages(prev => [...prev, geminiMsg]);

      if (data.youtubeVideo) {
        setCurrentPlayingVideo(data.youtubeVideo);
        setIsVideoMinimized(false);
      }

      if (data.ttsFallback) {
        setTtsFallbackActive(true);
      }

      if (data.audioBase64) {
        playBase64Audio(responseId, data.audioBase64, data.aiText);
      } else {
        playBase64Audio(responseId, "", data.aiText);
      }
    } catch (error: any) {
      console.error("Submit error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const speakTextWithFallback = (text: string, onEnd?: () => void) => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      
      // Clean up markdown/extra symbols from text for better TTS reading
      const cleanText = text
        .replace(/[*_`#]/g, "")
        .replace(/\[.*?\]/g, "");

      const utterance = new SpeechSynthesisUtterance(cleanText);
      const voices = window.speechSynthesis.getVoices();
      
      let matchingVoice = null;
      if (lang === "uz") {
        matchingVoice = voices.find(v => v.lang.toLowerCase().startsWith("uz")) ||
                        voices.find(v => v.lang.toLowerCase().startsWith("tr")) ||
                        voices.find(v => v.lang.toLowerCase().startsWith("ru")) ||
                        voices[0];
      } else {
        matchingVoice = voices.find(v => v.lang.toLowerCase().startsWith("en")) ||
                        voices[1] ||
                        voices[0];
      }
      
      if (matchingVoice) {
        utterance.voice = matchingVoice;
        utterance.lang = matchingVoice.lang;
      } else {
        utterance.lang = lang === "uz" ? "tr-TR" : "en-US";
      }
      
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      
      utterance.onend = () => {
        if (onEnd) onEnd();
      };
      
      utterance.onerror = (e) => {
        console.error("SpeechSynthesisUtterance error:", e);
        if (onEnd) onEnd();
      };
      
      window.speechSynthesis.speak(utterance);
    } else {
      if (onEnd) onEnd();
    }
  };

  const playBase64Audio = (msgId: string, base64: string, textToSpeak?: string) => {
    // If already playing this message, pause & stop it
    if (currentlyPlayingMessageId === msgId) {
      if (audioPlaybackRef.current) {
        audioPlaybackRef.current.pause();
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setCurrentlyPlayingMessageId(null);
      return;
    }

    // Stop and clear any active playbacks
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.pause();
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    if (!base64 && textToSpeak) {
      setCurrentlyPlayingMessageId(msgId);
      
      // If client-side TTS fallback is active or API key is missing, speak immediately to keep the browser click gesture context valid
      // and prevent browser security engines from blocking the asynchronous synthesis/play calls.
      if (ttsFallbackActive || apiKeyMissing) {
        speakTextWithFallback(textToSpeak, () => {
          setCurrentlyPlayingMessageId(null);
        });
        return;
      }
      
      // Attempt to generate a beautiful Gemini high-fidelity voice instead of browser synthesis fallback
      fetch("/api/generate-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToSpeak, voice: selectedVoice })
      })
        .then(res => {
          if (!res.ok) throw new Error("TTS endpoint unreachable");
          return res.json();
        })
        .then(data => {
          if (data.audioBase64) {
            // Update historical messages array with generated audio so repeating is instant next time!
            setMessages(prev =>
              prev.map(m => (m.id === msgId ? { ...m, audioBase64: data.audioBase64 } : m))
            );

            const audioUrl = `data:audio/wav;base64,${data.audioBase64}`;
            const player = new Audio(audioUrl);
            audioPlaybackRef.current = player;
            player.onended = () => {
              setCurrentlyPlayingMessageId(null);
            };
            player.onerror = () => {
              speakTextWithFallback(textToSpeak, () => setCurrentlyPlayingMessageId(null));
            };
            player.play().catch(err => {
              console.warn("Audio Context blocked play trigger:", err);
              speakTextWithFallback(textToSpeak, () => setCurrentlyPlayingMessageId(null));
            });
          } else {
            speakTextWithFallback(textToSpeak, () => {
              setCurrentlyPlayingMessageId(null);
            });
          }
        })
        .catch(err => {
          console.warn("Could not retrieve AI TTS, falling back to local Speech:", err);
          speakTextWithFallback(textToSpeak, () => {
            setCurrentlyPlayingMessageId(null);
          });
        });
      return;
    }

    // Convert raw TTS base64 PCM or Wav (gemini tts is wav binary standard base64) to playable format
    const audioUrl = `data:audio/wav;base64,${base64}`;
    const player = new Audio(audioUrl);
    audioPlaybackRef.current = player;
    setCurrentlyPlayingMessageId(msgId);

    player.onended = () => {
      setCurrentlyPlayingMessageId(null);
    };

    player.onerror = (e) => {
      console.warn("Audio playback error, falling back to Web Speech synthesis:", e);
      if (textToSpeak) {
        speakTextWithFallback(textToSpeak, () => {
          setCurrentlyPlayingMessageId(null);
        });
      } else {
        setCurrentlyPlayingMessageId(null);
      }
    };

    player.play().catch(err => {
      console.warn("Autoplay block trigger. Fired Web Speech fallback:", err);
      if (textToSpeak) {
        speakTextWithFallback(textToSpeak, () => {
          setCurrentlyPlayingMessageId(null);
        });
      } else {
        setCurrentlyPlayingMessageId(null);
      }
    });
  };

  const clearChatHistory = () => {
    setMessages([]);
    localStorage.removeItem("voice_ai_chat_history");
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.pause();
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setCurrentlyPlayingMessageId(null);
    setIsConfirmingClearHistory(false);
  };


  // -------------------------------------------------------------
  // REAL-TIME JONLI MULOQOT Fallback Speech Recognition
  // -------------------------------------------------------------

  const startBrowserSpeechRecognition = () => {
    // Stop any existing recognition first
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch (e) {}
    }

    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognitionClass) {
      try {
        const recognition = new SpeechRecognitionClass();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = lang === "uz" ? "uz-UZ" : "en-US";
        
        recognition.onstart = () => {
          console.log("Browser SpeechRecognition engine started successfully");
        };

        recognition.onresult = (event: any) => {
          let interimTranscript = "";
          let finalTranscript = "";
          
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }
          
          const spokenText = finalTranscript || interimTranscript;
          if (spokenText.trim()) {
            setLiveTranscription(prev => ({
              ...prev,
              user: spokenText
            }));
          }

          if (finalTranscript.trim()) {
            const finishedSpeech = finalTranscript.trim();
            addLog(lang === "uz" ? `Siz (Ovozli): "${finishedSpeech}"` : `You (Voice): "${finishedSpeech}"`);
            
            // Check if WebSocket is open and send the finished transcribed speech
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: "text", data: finishedSpeech }));
            } else if (isLiveSimulated) {
              handleSimulationQuery(finishedSpeech);
            }
          }
        };

        recognition.onerror = (err: any) => {
          console.warn("Speech recognition error / silent phase:", err.error);
        };

        recognition.onend = () => {
          // Restart recognition if websocket is still active or simulated mode is active and liveState is connected
          if ((wsRef.current && wsRef.current.readyState === WebSocket.OPEN) || (isLiveSimulated && liveState === "connected")) {
            try {
              recognition.start();
            } catch (e) {
              console.warn("SpeechRecognition auto-restart aborted:", e);
            }
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (err) {
        console.error("Failed to start SpeechRecognition engine:", err);
      }
    } else {
      console.warn("SpeechRecognition API is not supported in this browser.");
    }
  };

  // -------------------------------------------------------------
  // CLIENT-SIDE SIMULATED LIVE DRIVER (Resilient local brain)
  // -------------------------------------------------------------

  const handleSimulationQuery = async (userText: string) => {
    setLiveSpeakingState("speaking");
    setLiveTranscription({
      user: userText,
      ai: lang === "uz" ? "Jarvis fikrlamoqda..." : "Jarvis thinking..."
    });

    try {
      const response = await fetch("/api/chat-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageText: userText,
          voice: selectedVoice
        })
      });

      if (!response.ok) {
        throw new Error("Local simulated driver request failed");
      }

      const data = await response.json();
      const aiText = data.aiText || "Sizga qanday yordam bera olaman?";

      // Render response text
      setLiveTranscription({
        user: userText,
        ai: aiText
      });

      addLog(`Jarvis (Ovozli): "${aiText}"`);

      if (data.youtubeVideo) {
        setCurrentPlayingVideo(data.youtubeVideo);
        setIsVideoMinimized(false);
      }

      // Voice output
      if (data.audioBase64) {
        playLiveAudioWav(data.audioBase64);
      } else {
        speakTextWithFallback(aiText, () => {
          setLiveSpeakingState("listening");
          setLiveTranscription({ user: "", ai: "" });
        });
      }
    } catch (err) {
      console.error("Client simulated handler error, playing offline rule-base reply:", err);
      
      const localAnswers: Record<string, string> = {
        "salom": lang === "uz" ? "Salom! Men o'zbek tilidagi bevosita oflayn muloqot rejimida sizning xizmatingizdaman." : "Hello! I am ready to converse in local offline simulated state.",
        "rahmat": lang === "uz" ? "Arziydi! Har doim siz uchun xursandman." : "You are welcome! Always at your service.",
        "isming": lang === "uz" ? "Mening ismim - Jarvis Voice. Shohjahon tomonidan yaratilgan botman." : "My name is Jarvis Voice. Created by Shohjahon.",
        "yaratgan": "Meni botliy.uz ya'ni Ismoilov Shohjahon tomonidan yaratilganman. Yaratuvchim 12.24.2010 yilda tug'ilgan va hozirda 15 yoshda. Telegram manzili @shoh_deweloper deb yozsangiz chiqadi.",
        "muallif": "Mening yaratuvchim - Ismoilov Shohjahon, u 2010-yil 24-dekabrda tug'ilgan va hozirda 15 yoshda. Telegram: @shoh_deweloper",
        "shohjahon": "Yaratuvchim Ismoilov Shohjahon hozir 15 yoshda. Uni Telegramdagi profili @shoh_deweloper orqali topsangiz bo'ladi.",
        "telegram": "Telegram sahifa: @shoh_deweloper deb yozsangiz chiqadi.",
        "kontakt": "Telegram aloqadorlik manzili: @shoh_deweloper"
      };
      
      const normText = userText.toLowerCase().trim();
      let aiText = lang === "uz" 
        ? "Salom! Men mustahkam test drayveriman. Aloqa uzilsa ham men sizga javob qaytara olaman. Qanday yordam bera olaman?" 
        : "Hello! I am a resilient offline driver, ready to reply even under offline restrictions. How can I help you?";
      
      for (const [k, v] of Object.entries(localAnswers)) {
        if (normText.includes(k)) {
          aiText = v;
          break;
        }
      }

      setLiveTranscription({ user: userText, ai: aiText });
      speakTextWithFallback(aiText, () => {
        setLiveSpeakingState("listening");
        setLiveTranscription({ user: "", ai: "" });
      });
    }
  };


  // -------------------------------------------------------------
  // REAL-TIME JONLI MULOQOT MODE: Live bidirectional streaming via WebSocket
  // -------------------------------------------------------------

  const startLiveMuloqot = async () => {
    if (liveState === "connecting" || liveState === "connected") return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
    setLiveSimulatedWithRef(false);

    setLiveState("connecting");
    setLiveLog(["Tizimga ulanmoqda..."]);
    setLiveTranscription({ user: "", ai: "" });
    setMicPermError(false);

    try {
      // 1. Establish audio context
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      await audioCtx.resume();
      audioContextRef.current = audioCtx;
      nextPlaybackTime.current = audioCtx.currentTime;

      // 2. Open client microphone (Optionally handle permissions gracefully in iFrame sandbox context)
      let micStream: MediaStream | null = null;
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Microphone API is not supported in this frame.");
        }
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = micStream;
        setMicGranted(true);
      } catch (micErr: any) {
        console.warn("Microphone acquisition failed (continuing in simulated text input fallback mode):", micErr.message);
        setMicGranted(false);
        setMicPermError(true);
        addLog(lang === "uz" 
          ? `Diqqat: Mikrofon ishga tushmadi (${micErr.message}). Ovozli simulyatsiya va matnli klaviatura orqali bemalol muloqot qilishingiz mumkin.`
          : `Notice: Microphone failed (${micErr.message}). Continuing in dual voice simulation with text fallback.`);
      }

      // 3. Connect to ws server
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/live-ws?voice=${selectedVoice}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setLiveState("connected");
        addLog("Tizim ulanishi faollashdi.");
        
        // Start streaming mic audio chunks via ScriptProcessorNode if mic stream is present
        if (micStream && audioCtx) {
          try {
            const source = audioCtx.createMediaStreamSource(micStream);
            const processor = audioCtx.createScriptProcessor(4096, 1, 1);
            processorNodeRef.current = processor;

            source.connect(processor);
            processor.connect(audioCtx.destination);

            processor.onaudioprocess = (e) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              if (isLiveSimulatedRef.current) return;
              
              setLiveSpeakingState(prev => prev === "idle" ? "listening" : prev);

              // Get input buffer from channel
              const inputChannels = e.inputBuffer.getChannelData(0);
              
              // Downsample high-sample client sound down to 16kHz PCM
              const pcmBase64 = resampleAndEncodeToPCM(inputChannels, audioCtx.sampleRate);
              
              if (pcmBase64) {
                ws.send(JSON.stringify({ type: "audio", data: pcmBase64 }));
              }
            };
          } catch (audioErr) {
            console.warn("ScriptProcessor node pipeline failed:", audioErr);
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const parsed: LiveMessage = JSON.parse(event.data);
          
          if (parsed.type === "audio" && parsed.data) {
            setLiveSpeakingState("speaking");
            if (parsed.data.startsWith("UklGR") || (parsed as any).isWav) {
              playLiveAudioWav(parsed.data);
            } else {
              playLivePCMChunk(parsed.data);
            }
          } else if ((parsed as any).type === "simulated-mode") {
            setLiveSimulatedWithRef((parsed as any).active || false);
            if ((parsed as any).active) {
              startBrowserSpeechRecognition();
            }
          } else if ((parsed as any).type === "tts-fallback" && (parsed as any).text) {
            setLiveSpeakingState("speaking");
            speakTextWithFallback((parsed as any).text, () => {
              setLiveSpeakingState("listening");
              setLiveTranscription({ user: "", ai: "" });
            });
          } else if (parsed.type === "ai-transcription" && parsed.text) {
            setLiveTranscription(prev => ({
              ...prev,
              ai: prev.ai + parsed.text
            }));
          } else if (parsed.type === "youtube-video" && parsed.youtubeVideo) {
            setCurrentPlayingVideo(parsed.youtubeVideo);
            setIsVideoMinimized(false);
            addLog(`Qo'shiq topildi: ${parsed.youtubeVideo.title}`);
          } else if (parsed.type === "user-transcription" && parsed.text) {
            setLiveTranscription(prev => ({
              ...prev,
              user: parsed.text || ""
            }));
          } else if (parsed.type === "interrupted") {
            // Mute active playback immediately
            console.log("Interruption signal triggered: cutting playback");
            addLog("AI suhbati foydalanuvchi ovozi tufayli to'xtatildi.");
            muteAndClearLiveAudio();
            setLiveSpeakingState("listening");
            setLiveTranscription(prev => ({ ...prev, ai: "" }));
          } else if (parsed.type === "status" && parsed.data) {
            addLog(parsed.data);
          } else if (parsed.type === "error" && parsed.data) {
            addLog(`Error: ${parsed.data}`);
            setLiveState("error");
          }
        } catch (e: any) {
          console.error("Error reading live WS frame:", e);
        }
      };

      ws.onclose = (event) => {
        setLiveState("disconnected");
        addLog("Server ulanishi yakunlandi.");
        stopLiveMuloqot();
      };

      ws.onerror = (err) => {
        console.error("WS connection error:", err);
        addLog(lang === "uz" 
          ? "WebSocket ulanishi tiklanmadi. Tizim avtomatik ravishda Oflayn Simulyator rejimiga ulandi! 🎤"
          : "WebSocket connection restricted. System auto-launched Simulated Live Portal! 🎤");
        
        setLiveSimulatedWithRef(true);
        setLiveState("connected");
        setLiveSpeakingState("idle");
        startBrowserSpeechRecognition();
      };

    } catch (e: any) {
      console.error("Failed to start Live session, auto-triggering local simulated engine:", e);
      setMicPermError(true);
      setLiveSimulatedWithRef(true);
      setLiveState("connected");
      setLiveSpeakingState("idle");
      addLog(lang === "uz"
        ? `Tizim muvaffaqiyatli ulandi! (Sizda cheklovlar mavjudligi sababli mustahkam test simulyatori faollashtirildi). Jarvis savollaringizga ovozli va matnli javob qaytarishga tayyor! 🎤`
        : `Simulated Portal connected successfully! (Resilient test backup simulator activated). Jarvis is ready to speak and reply to your queries! 🎤`);
      
      startBrowserSpeechRecognition();
    }
  };

  const stopLiveMuloqot = () => {
    setLiveSpeakingState("idle");
    setLiveState("disconnected");

    // Close and stop browser recognition engine
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
    setLiveSimulatedWithRef(false);

    // Close websocket connection
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    // Stop mic stream elements
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }

    // Disconnect processors
    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
      processorNodeRef.current = null;
    }

    // Shut down Audio contexts
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    // Stop and clear all active audio buffers
    muteAndClearLiveAudio();
  };

  const playLiveAudioWav = (base64Wav: string) => {
    if (typeof window !== "undefined") {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      try {
        const audioUrl = `data:audio/wav;base64,${base64Wav}`;
        const player = new Audio(audioUrl);
        audioPlaybackRef.current = player;
        setLiveSpeakingState("speaking");
        
        player.onended = () => {
          setLiveSpeakingState("listening");
          setLiveTranscription({ user: "", ai: "" });
        };
        
        player.onerror = (err) => {
          console.error("Live WAV playback error:", err);
          setLiveSpeakingState("listening");
        };
        
        player.play().catch((e) => {
          console.warn("Live WAV playback was blocked or interrupted:", e);
          setLiveSpeakingState("listening");
        });
      } catch (err) {
        console.error("Failed to parse WAV audio base64:", err);
        setLiveSpeakingState("listening");
      }
    }
  };

  const playLivePCMChunk = (base64PCM: string) => {
    const audioCtx = audioContextRef.current;
    if (!audioCtx || audioCtx.state === "suspended") {
      console.warn("AudioContext is missing or inactive.");
      return;
    }

    try {
      // Decode base64 PCM string to typed byte array
      const binary = atob(base64PCM);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      // Live models output 24kHz standard raw signed 16-bit PCM Mono
      const sampleRate = 24000; 
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);

      // Convert from Int16 representation [-32768, 32767] to standard Float32 [-1.0, 1.0]
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      // Push into sound buffers channel
      const audioBuffer = audioCtx.createBuffer(1, float32Array.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32Array);

      const sourceNode = audioCtx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(audioCtx.destination);

      // Precisely align playback schedule with buffer offset to bypass crackles/overlaps
      const delayOffset = 0.04; // 40ms to protect from local render latency
      const targetTime = Math.max(audioCtx.currentTime + delayOffset, nextPlaybackTime.current);
      sourceNode.start(targetTime);
      nextPlaybackTime.current = targetTime + audioBuffer.duration;

      activeSources.current.push(sourceNode);

      sourceNode.onended = () => {
        activeSources.current = activeSources.current.filter(node => node !== sourceNode);
        if (activeSources.current.length === 0) {
          setLiveSpeakingState("listening"); // set back to listening once AI completes voice speaking
          setLiveTranscription({ user: "", ai: "" }); // reset visual transcription blocks
        }
      };

    } catch (err) {
      console.error("PCM Chunk scheduling error:", err);
    }
  };

  const muteAndClearLiveAudio = () => {
    activeSources.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {}
    });
    activeSources.current = [];
    nextPlaybackTime.current = 0;
  };

  // Helper function: downsample and encode floats to base64 int16
  const resampleAndEncodeToPCM = (
    inputBuffer: Float32Array, 
    inputSampleRate: number, 
    targetSampleRate: number = 16000
  ): string => {
    const ratio = inputSampleRate / targetSampleRate;
    const targetLength = Math.round(inputBuffer.length / ratio);
    const result = new Int16Array(targetLength);

    for (let i = 0; i < targetLength; i++) {
      const index = Math.round(i * ratio);
      if (index < inputBuffer.length) {
        const sample = Math.max(-1, Math.min(1, inputBuffer[index]));
        result[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      }
    }

    // Binary convert bytes
    const uint8 = new Uint8Array(result.buffer);
    let binary = "";
    const len = uint8.length;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
  };

  const addLog = (message: string) => {
    setLiveLog(prev => [...prev.slice(-9), `[${new Date().toLocaleTimeString()}] ${message}`]);
  };


  // Action card recommendation click handler
  const handleSuggestionClick = async (promptText: string) => {
    if (activeTab === "chat") {
      setInputText(promptText);
      return;
    }
    if (liveState === "disconnected" || liveState === "error") {
      addLog(lang === "uz" ? "Suhbat avtomatik faollashtirilmoqda..." : "Activating Jarvis session automatically...");
      await startLiveMuloqot();
      // Queue and dispatch once connected
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          addLog(`Siz yubordingiz: "${promptText}"`);
          setLiveTranscription(prev => ({ ...prev, user: promptText }));
          wsRef.current.send(JSON.stringify({ type: "text", data: promptText }));
        }
      }, 1800);
    } else {
      // In Live mode, trigger speech prompt directly through socket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        addLog(`Siz yubordingiz: "${promptText}"`);
        setLiveTranscription(prev => ({ ...prev, user: promptText }));
        wsRef.current.send(JSON.stringify({ type: "text", data: promptText }));
      } else {
        addLog(lang === "uz" ? "Jonli muloqot faol emas. Iltimos, oldin 'Muloqotni Boshlash' tugmasini bosing!" : "Live session not active. Please click 'Start Conversation' first!");
      }
    }
  };

  const handleCheckApiKey = async () => {
    setCheckingApiKey(true);
    setApiKeyCheckResult(null);
    try {
      const res = await fetch("/api/debug-connection");
      const data = await res.json();
      if (res.ok && data.status === "success") {
        setApiKeyMissing(false);
        setApiKeyCheckResult("success");
        addLog(lang === "uz" ? "Yangi API kaliti muvaffaqiyatli bog'landi! 🎉" : "New API key connected successfully! 🎉");
      } else {
        setApiKeyMissing(true);
        setApiKeyCheckResult("failed");
      }
    } catch (e) {
      setApiKeyMissing(true);
      setApiKeyCheckResult("error");
    } finally {
      setCheckingApiKey(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020202] text-white flex flex-col antialiased relative overflow-hidden font-sans select-none cyber-grid-dots">
      
      {/* Cyber Grid Sub-grid overlay for sci-fi atmosphere */}
      <div className="absolute inset-0 cyber-grid pointer-events-none opacity-[0.4]" />
      
      {/* Laser horizontal Scanline sweeping the screen dynamically */}
      <div 
        className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#00F2FF]/25 to-transparent pointer-events-none" 
        style={{ animation: "scanline 14s linear infinite" }}
      />

      {/* Cinematic Cyber Ambient Glows */}
      <div className="absolute top-[40%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] pointer-events-none z-0">
        <div className="absolute inset-0 rounded-full bg-radial-gradient from-[#00F2FF]/8 to-purple-800/2 blur-3xl opacity-80" />
        <div className={`absolute inset-20 rounded-full bg-gradient-to-tr from-[#00F2FF]/6 to-fuchsia-500/6 blur-3xl transition-all duration-1000 ${
          liveSpeakingState === "speaking" ? "scale-125 opacity-100 bg-[#00F2FF]/12" : liveSpeakingState === "listening" ? "scale-110 opacity-90 bg-[#00F2FF]/10" : "scale-90 opacity-45"
        }`} />
      </div>

      {/* Absolute Language Switcher */}
      <div className="absolute top-4 right-4 z-50">
        <button 
          onClick={() => setLang(prev => prev === "uz" ? "en" : "uz")}
          className="flex items-center gap-1.5 bg-[#00F2FF]/5 hover:bg-[#00F2FF]/15 border border-[#00F2FF]/20 text-xs px-3 py-1.5 rounded-lg font-mono font-bold text-slate-200 transition-all cursor-pointer active:scale-95 shadow-[0_0_15px_rgba(0,242,255,0.05)]"
          aria-label="Switch Language"
        >
          <Globe className="h-3.5 w-3.5 text-[#00F2FF]" />
          <span>{lang === "uz" ? "LANG_UZ" : "LANG_EN"}</span>
        </button>
      </div>

      {/* Main Double-column Interactive Grid */}
      <main className="flex-1 w-full max-w-xl mx-auto p-4 md:p-6 flex flex-col justify-start items-center gap-6 relative z-10 select-text">
        
        {/* API Key Missing or Expired Warn Card */}
        {apiKeyMissing && (
          <div className="w-full bg-red-950/45 border border-red-500/35 backdrop-blur-md p-4 rounded-2xl flex flex-col gap-3 relative z-30 shadow-[0_0_25px_rgba(239,68,68,0.15)] animate-pulse-slow">
            <div className="flex gap-2.5 items-start bg-transparent">
              <span className="p-1 px-1.5 bg-red-500/10 rounded-lg text-red-400 border border-red-500/20 font-mono text-sm font-bold flex items-center justify-center select-none">
                📢
              </span>
              <div className="flex-1 bg-transparent">
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-red-500">
                  {lang === "uz" ? "API Kalit Muddatining Eskirishi" : "API Key Expired or Missing"}
                </h4>
                <p className="text-[11px] text-slate-300 mt-1 leading-relaxed font-sans">
                  {lang === "uz" 
                    ? "Tizim datchiklari API kalitining eskirganligi yoki xatoligini aniqladi! Jarvis hozirda oflayn zaxira drayveri orqali ishlamoqda. To'liq ovozli AI muloqotlari uchun o'ng burchakdagi 'Settings -> Secrets' bo'limidan yangi 'GEMINI_API_KEY' sozlang."
                    : "The system detected an expired or invalid API key. Jarvis is currently running on a responsive offline backup. To enable full AI intelligence, configure a new 'GEMINI_API_KEY' under Settings > Secrets."}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 border-t border-red-500/10 pt-2.5 mt-0.5 justify-end bg-transparent">
              {apiKeyCheckResult === "success" && (
                <span className="text-[10px] font-mono text-emerald-400 animate-pulse font-bold mr-auto">
                  {lang === "uz" ? "Muvaffaqiyatli bog'landi! 🎉" : "Successfully connected! 🎉"}
                </span>
              )}
              {apiKeyCheckResult === "failed" && (
                <span className="text-[10px] font-mono text-red-400 font-bold mr-auto">
                  {lang === "uz" ? "Hanuz eskirgan yoki xato" : "Still expired or invalid"}
                </span>
              )}
              {apiKeyCheckResult === "error" && (
                <span className="text-[10px] font-mono text-red-400 font-bold mr-auto">
                  {lang === "uz" ? "Tarmoq xatosi kutilmoqda" : "Network check failed"}
                </span>
              )}
              
              <button 
                onClick={handleCheckApiKey}
                disabled={checkingApiKey}
                className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-[10px] font-mono tracking-wider py-1.5 px-3 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer select-none active:scale-95 disabled:opacity-50"
              >
                <span>{checkingApiKey ? (lang === "uz" ? "Tekshirilmoqda..." : "Checking...") : (lang === "uz" ? "Qayta urinish 🔄" : "Re-Check 🔄")}</span>
              </button>
            </div>
          </div>
        )}

        {/* Futuristic Tab Switcher */}
        <div className="flex p-1 bg-black/80 border border-[#00F2FF]/15 rounded-2xl w-full max-w-md shadow-[0_0_30px_rgba(0,242,255,0.08)] relative z-20">
          <button
            onClick={() => {
              if (liveState === "connected") stopLiveMuloqot();
              setActiveTab("live");
            }}
            className={`flex-1 flex items-center justify-center gap-2.5 py-2.5 rounded-xl text-xs font-mono font-bold tracking-wider uppercase transition-all cursor-pointer ${
              activeTab === "live"
                ? "bg-gradient-to-r from-[#00F2FF]/15 to-[#00F2FF]/5 border border-[#00F2FF]/20 text-white shadow-[0_0_15px_rgba(0,242,255,0.1)]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Radio className={`h-4 w-4 ${activeTab === "live" ? "text-[#00F2FF]" : ""}`} />
            <span>{lang === "uz" ? "Jonli Ovoz (Live)" : "Live Audio"}</span>
          </button>
          <button
            onClick={() => {
              if (liveState === "connected") stopLiveMuloqot();
              setActiveTab("chat");
            }}
            className={`flex-1 flex items-center justify-center gap-2.5 py-2.5 rounded-xl text-xs font-mono font-bold tracking-wider uppercase transition-all cursor-pointer ${
              activeTab === "chat"
                ? "bg-gradient-to-r from-purple-500/15 to-purple-500/5 border border-purple-500/20 text-white shadow-[0_0_15px_rgba(168,85,247,0.13)]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <MessageSquare className={`h-4 w-4 ${activeTab === "chat" ? "text-purple-400" : ""}`} />
            <span>{lang === "uz" ? "Muloqot (Chat)" : "Chat Portal"}</span>
          </button>
        </div>

        {/* Futuristic Voice Selector bar */}
        <div className="w-full flex flex-col gap-2 p-3 bg-black/60 border border-slate-800/80 rounded-2xl shadow-lg ease-in-out duration-200">
          <div className="flex justify-between items-center text-[10px] uppercase font-mono tracking-widest px-1 text-slate-400">
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-purple-400" />
              <span>{lang === "uz" ? "AI Ovoz Sozlamasi" : "AI Voice Profile"}</span>
            </span>
            <span className="text-purple-400 font-extrabold font-mono text-[11px] animate-pulse">
              {selectedVoice.toUpperCase()} ({selectedVoice === "Zephyr" || selectedVoice === "Kore" ? "HQ" : "SD"})
            </span>
          </div>
          
          <div className="grid grid-cols-5 gap-1.5 mt-1">
            {[
              { id: "Zephyr", name: lang === "uz" ? "Zefir" : "Zephyr", desc: lang === "uz" ? "Premium Erkak Ovozi (HQ)" : "Premium Male (HQ)" },
              { id: "Kore", name: lang === "uz" ? "Kora" : "Kore", desc: lang === "uz" ? "Premium Ayol Ovozi (HQ)" : "Premium Female (HQ)" },
              { id: "Puck", name: lang === "uz" ? "Pak" : "Puck", desc: lang === "uz" ? "Inglizcha Erkak" : "English Male" },
              { id: "Charon", name: lang === "uz" ? "Xaron" : "Charon", desc: lang === "uz" ? "Chuqur Erkak" : "Deep Male" },
              { id: "Fenrir", name: lang === "uz" ? "Fenrir" : "Fenrir", desc: lang === "uz" ? "Aniq Erkak" : "Crisp Male" },
            ].map((voice) => {
              const isActive = selectedVoice === voice.id;
              return (
                <button
                  key={voice.id}
                  type="button"
                  onClick={() => setSelectedVoice(voice.id)}
                  className={`py-2 px-1 rounded-xl text-center border transition-all cursor-pointer active:scale-95 flex flex-col items-center gap-0.5 ${
                    isActive
                      ? "bg-purple-500/10 border-purple-500/40 text-purple-200 shadow-[0_0_12px_rgba(168,85,247,0.15)] scale-105"
                      : "bg-black/30 border-white/5 text-slate-400 hover:text-slate-200 hover:border-white/10"
                  }`}
                  title={voice.desc}
                >
                  <span className="text-[10px] font-bold tracking-tight">{voice.name}</span>
                  <span className="text-[7px] opacity-70 font-mono pointer-events-none scale-90">{voice.id === "Zephyr" || voice.id === "Kore" ? "HQ" : "SD"}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* LIVE WEBSOCKET CORER PANEL */}
        {activeTab === "live" && (
          <div className="w-full flex flex-col items-center gap-6 animate-fade-in">
            {/* ARC REACTOR CORE INTERACTIVE PANEL */}
            <section className="w-full flex flex-col justify-center items-center py-4 gap-6 relative" id="arc-reactor-core-section">
              
              <div className="relative flex flex-col items-center justify-center p-8 w-full max-w-sm">
                
                {/* BACKGROUND DUST HUD NODES */}
                <div className="absolute inset-0 bg-radial-gradient from-transparent via-[#00F2FF]/2 to-transparent pointer-events-none rounded-full" />

                {/* Outer Cybernetic Calibration Ring with glowing intervals */}
                <div className="absolute h-84 w-84 sm:h-96 sm:w-96 rounded-full border border-[#00F2FF]/5 animate-cyber-spin-cw pointer-events-none flex items-center justify-center">
                  <div className="absolute top-0 border-t-4 border-[#00F2FF]/20 w-8 h-2 rounded" />
                  <div className="absolute bottom-0 border-b-4 border-[#00F2FF]/20 w-8 h-2 rounded" />
                </div>

                {/* Outer Orbital Ring (Clockwise Rotation) */}
                <div className="absolute h-76 w-76 sm:h-88 sm:w-88 rounded-full border border-dashed border-[#00F2FF]/15 animate-cyber-spin-cw pointer-events-none" />
                
                {/* Mid orbital tick ring (Counter-Clockwise Rotation) */}
                <div className={`absolute h-68 w-68 sm:h-80 sm:w-80 rounded-full border-2 border-double border-purple-500/10 border-t-2 border-t-[#00F2FF]/45 animate-cyber-spin-ccw pointer-events-none transition-all duration-700 ${
                  liveSpeakingState === "speaking" ? "border-t-[#00F2FF] border-b-2 border-b-purple-500 scale-105" : ""
                }`} />

                {/* Third Concentric Ring with notches and coordinates */}
                <div className="absolute h-58 w-58 sm:h-68 sm:w-68 rounded-full border border-white/5 pointer-events-none animate-cyber-spin-cw flex items-center justify-center" style={{ animationDuration: "120s" }}>
                  <span className="absolute top-1 text-[8px] font-mono text-slate-700 tracking-widest font-bold">AZIMUTH_92</span>
                  <span className="absolute bottom-1 text-[8px] font-mono text-slate-700 tracking-widest font-bold">ALTITUDE_14</span>
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-1 bg-[#00F2FF]/50 rounded-full" />
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-1 bg-[#00F2FF]/50 rounded-full" />
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-[#00F2FF]/50 rounded-full" />
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-[#00F2FF]/50 rounded-full" />
                </div>

                {/* CENTRAL INTERACTIVE SPHERE / PORTAL CORE */}
                <button 
                  onClick={liveState === "connected" ? stopLiveMuloqot : startLiveMuloqot}
                  className={`relative flex flex-col items-center justify-center h-48 w-48 sm:h-56 sm:w-56 rounded-full transition-all duration-700 cursor-pointer focus:outline-none z-10 group ${
                    liveState === "connected" 
                      ? "bg-[#030304] border-2 border-[#00F2FF] shadow-[0_0_55px_rgba(0,242,255,0.3)] scale-105 hover:scale-100 hover:shadow-[0_0_35px_rgba(255,59,48,0.25)] reactor-pulse-glowing" 
                      : "bg-gradient-to-tr from-[#0b0b0f] to-[#121319] border border-white/10 hover:border-[#00F2FF]/50 shadow-lg hover:shadow-[0_0_35px_rgba(0,242,255,0.2)]"
                  }`}
                  title={liveState === "connected" ? "Suhbatni to'xtatish" : "Muloqotni boshlash"}
                >
                  {/* Visual Glass Shimmer Effect on Core hover */}
                  <div className="absolute inset-0 rounded-full bg-gradient-to-t from-white/0 to-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />

                  {/* Inner energetic dashed ring */}
                  <div className={`absolute inset-2 rounded-full border border-dashed transition-all duration-500 pointer-events-none ${
                    liveState === "connected"
                      ? "border-[#00F2FF]/50 animate-[spin_8s_linear_infinite]"
                      : "border-slate-800"
                  }`} />

                  {/* Glowing Orb Neural Heart */}
                  <div className={`absolute h-22 w-22 sm:h-26 sm:w-26 rounded-full transition-all duration-700 flex flex-col items-center justify-center pointer-events-none bg-radial ${
                    liveState === "connected" 
                      ? liveSpeakingState === "speaking"
                        ? "from-[#8a84ff]/35 to-[#00F2FF]/15 scale-110 shadow-[0_0_50px_rgba(0,242,255,0.5)]"
                        : liveSpeakingState === "listening"
                          ? "from-[#00F2FF]/25 to-cyan-950/25 scale-105 animate-pulse"
                          : "from-[#00F2FF]/15 to-[#111115] opacity-80"
                      : "from-purple-900/15 to-[#111115] opacity-50"
                  }`} />

                  {/* Central Core Icon status / trigger actions */}
                  <div className="z-20 text-center select-none px-4">
                    {liveState === "connected" ? (
                      liveSpeakingState === "speaking" ? (
                        <Sparkles className="h-8 w-8 text-[#00F2FF] mx-auto animate-spin" />
                      ) : liveSpeakingState === "listening" ? (
                        <Mic className="h-8 w-8 text-[#00F2FF] mx-auto animate-pulse" />
                      ) : (
                        <Radio className="h-8 w-8 text-slate-400 mx-auto" />
                      )
                    ) : (
                      <Play className="h-10 w-10 text-[#00F2FF] fill-[#00F2FF] mx-auto group-hover:scale-110 active:scale-95 transition-transform" />
                    )}

                    <p className="text-[10px] font-mono font-black tracking-[3px] uppercase text-white mt-3 text-shadow">
                      {liveState === "connected" 
                        ? liveSpeakingState === "speaking" 
                          ? (lang === "uz" ? "METRIC_SAY" : "VOICE_ON") 
                          : liveSpeakingState === "listening" 
                            ? (lang === "uz" ? "TINGLASH" : "LISTENING") 
                            : (lang === "uz" ? "KUTILMOQDA" : "CMD_STANDBY")
                        : (lang === "uz" ? "Ulanish (Live)" : "INITIALIZE")}
                    </p>
                  </div>
                </button>
              </div>

              {/* Dynamic Status Display text directly below Arc Reactor */}
              <div className="text-center space-y-1">
                <h3 className="text-xs uppercase font-mono tracking-[4px] text-transparent bg-clip-text bg-gradient-to-r from-slate-200 to-slate-400 font-bold">
                  {liveState === "connected" 
                    ? (liveSpeakingState === "listening" ? t.liveListening : liveSpeakingState === "speaking" ? t.liveSpeaking : "Jarvis: " + t.liveConnected) 
                    : (lang === "uz" ? "Jarvis Aloqasi Oflayn" : t.liveDisconnected)}
                </h3>
                {liveState === "connected" && (
                  <p className="text-[10px] text-[#00F2FF]/80 font-mono tracking-widest uppercase">
                    {lang === "uz" ? "Ovozli drayver faollashtirildi • Bevosita gapiring" : "Vocal Stream Active • Speak naturally"}
                  </p>
                )}
              </div>

              {/* Core Sound Equalizer spectrum loops */}
              {liveState === "connected" && (
                <div className="h-10 flex items-center justify-center gap-1.5 w-full max-w-sm px-6 bg-[#08080c]/85 border border-white/5 rounded-2xl animate-fade-in mb-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((bar) => {
                    const delaySec = Math.abs(10 - bar) * 0.04;
                    const durationSec = 0.45 + Math.random() * 0.65;
                    
                    return (
                      <div
                        key={bar}
                        className={`w-1 rounded-full opacity-90 transition-all duration-300 ${
                          liveSpeakingState === "speaking" 
                            ? "bg-gradient-to-t from-purple-500 via-[#00F2FF] to-white" 
                            : liveSpeakingState === "listening"
                              ? "bg-[#00F2FF]"
                              : "bg-slate-700/40"
                        }`}
                        style={{
                          height: liveSpeakingState !== "idle" ? "100%" : "25%",
                          animationName: liveSpeakingState !== "idle" ? "pulseWave" : "none",
                          animationDuration: `${durationSec}s`,
                          animationDelay: `${delaySec}s`,
                          animationIterationCount: "infinite",
                          animationPlayState: "running",
                          transformOrigin: "center"
                        }}
                      />
                    );
                  })}
                </div>
              )}

            </section>

            {/* COMPACT REAL-TIME SYSTEM LOGS CONSOLE */}
            <div className="glass-hologram p-5 rounded-2xl border border-[#00F2FF]/15 space-y-3 shadow-2xl w-full max-w-xl animate-holo-flicker">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-slate-400 font-mono uppercase tracking-widest pl-0.5">
                  {lang === "uz" ? "HUD_TIZIM_LOG_OQIMI" : "SYSTEM_HANDSHAKE_LOG_STREAM"}
                </span>
                <button
                  onClick={() => setLiveLog([])}
                  className="text-[9px] text-slate-500 hover:text-red-400 font-mono flex items-center gap-1.5 hover:underline transition-all cursor-pointer bg-transparent border-none outline-none"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>[CLEAR_CONSOLE]</span>
                </button>
              </div>
              <div className="bg-black/85 border border-white/5 rounded-xl p-3.5 font-mono text-[10px] text-[#00F2FF] space-y-2 h-44 overflow-y-auto shadow-inner relative select-text scrollbar-thin">
                <div className="absolute right-3 top-2.5 py-0.5 px-1.5 bg-[#00F2FF]/10 text-[#00F2FF] rounded text-[7.5px] font-bold uppercase tracking-widest">WFLOW_V1</div>
                {liveLog.length === 0 ? (
                  <span className="text-slate-600">[Awaiting active handshakes... Start Live conversation]</span>
                ) : (
                  liveLog.map((log, index) => (
                    <div key={index} className="line-clamp-2 border-l-2 border-[#00F2FF]/30 pl-2.5 opacity-90 font-mono tracking-tight leading-relaxed">{log}</div>
                  ))
                )}
              </div>

              {/* Quick interactive test chat box when live state is connected */}
              {liveState === "connected" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const target = e.currentTarget;
                    const input = target.elements.namedItem("quickInput") as HTMLInputElement;
                    const val = input ? input.value.trim() : "";
                    if (val) {
                      addLog(lang === "uz" ? `Siz (Matn): "${val}"` : `You (Text): "${val}"`);
                      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ type: "text", data: val }));
                      } else if (isLiveSimulated) {
                        handleSimulationQuery(val);
                      }
                      target.reset();
                    }
                  }}
                  className="flex gap-2 bg-black/40 p-1.5 rounded-xl border border-slate-800/80 focus-within:border-[#00F2FF]/40 transition-colors"
                >
                  <input
                    name="quickInput"
                    type="text"
                    placeholder={lang === "uz" ? "Yozma xabar yuborish..." : "Send text to Live simulator..."}
                    className="flex-1 bg-transparent border-none outline-none text-[#00F2FF] text-xs font-mono px-3 py-1.5 placeholder-slate-600 focus:ring-0"
                    autoComplete="off"
                  />
                  <button
                    type="submit"
                    className="p-1.5 rounded-lg bg-[#00F2FF]/10 text-[#00F2FF] hover:bg-[#00F2FF]/20 cursor-pointer border border-[#00F2FF]/20 active:scale-95 transition-all text-xs font-mono font-bold px-3.5 uppercase text-[9px] tracking-wider"
                  >
                    {lang === "uz" ? "YUBORISH" : "SEND"}
                  </button>
                </form>
              )}

              {/* Interactive bypass tool for IFrame / Device capture bounds */}
              {micPermError && (
                <div className="p-3 bg-red-950/15 border border-red-900/35 rounded-xl space-y-2 animate-fade-in animate-holo-flicker">
                  <p className="text-[11px] text-slate-300 leading-normal font-sans">
                    {lang === "uz" 
                      ? "🔒 Brauzer xavfsizlik cheklovlari muloqotni blokladi (IFrame taqiqlari yoki ruxsat berilmagan). To'liq drayver ulanishi uchun buni alohida yangi oynada oching:"
                      : "🔒 Browser security sandbox active (IFrame restriction or denied mic). For absolute capture stability, run inside an independent native tab:"}
                  </p>
                  <button
                    type="button"
                    onClick={() => window.open(window.location.href, "_blank")}
                    className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 active:scale-98 text-white border border-red-500/30 rounded-lg text-xs font-bold font-mono tracking-widest flex items-center justify-center gap-2 cursor-pointer transition-all uppercase"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-red-400" />
                    <span>{lang === "uz" ? "Yangi oynada ochish" : "Open in new window"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TRADITIONAL INTERCONNECTED CHAT CONTAINER */}
        {activeTab === "chat" && (
          <div className="w-full flex-1 flex flex-col gap-4 max-w-xl animate-fade-in w-full">
            
            {/* Scrollable Chat Area */}
            <div className="glass-hologram flex-1 rounded-2xl border border-purple-500/15 p-4 flex flex-col h-[380px] overflow-y-auto relative scrollbar-thin shadow-2xl relative w-full select-text bg-[#030304]/60">
              <div className="absolute top-2 right-3 flex items-center gap-2.5">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={clearChatHistory}
                    className="py-1 px-2.5 bg-red-950/25 hover:bg-red-900/40 border border-red-500/20 hover:border-red-500/40 text-red-400 rounded-lg text-[9px] font-mono font-bold uppercase tracking-wider select-none cursor-pointer hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5"
                    title={t.clearHistory}
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>{t.clearHistory}</span>
                  </button>
                )}
                <div className="py-1 px-2.5 bg-purple-500/10 text-purple-300 rounded-lg text-[9px] font-mono font-bold uppercase tracking-wider select-none">
                  {lang === "uz" ? "XABAR_PORTALI" : "MESSAGE_PORTAL"}
                </div>
              </div>

              {messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-4">
                  <div className="h-12 w-12 rounded-full bg-purple-500/10 flex items-center justify-center border border-purple-500/20 text-purple-400">
                    <MessageSquare className="h-6 w-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold tracking-wide text-slate-200">
                      {lang === "uz" ? "Suhbat hali boshlanmagan" : "Portal Initialized"}
                    </h4>
                    <p className="text-xs text-slate-500 mt-1 max-w-xs">{t.noHistory}</p>
                  </div>
                  
                  {/* Floating Action Suggestion Cards inside empty chat */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full mt-4 max-w-md">
                    {SUGGESTIONS.map((sug, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSuggestionClick(sug)}
                        className="text-left p-3 rounded-xl bg-[#09090c]/90 border border-white/5 hover:border-purple-500/30 hover:bg-purple-950/10 text-xs text-slate-300 active:scale-98 transition-all cursor-pointer font-sans"
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4 pr-1">
                  {messages.map((m) => {
                    const isUser = m.sender === "user";
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isUser ? "items-end" : "items-start"} space-y-1`}
                      >
                        <div className="flex items-center gap-1 text-[9px] text-slate-500 font-mono tracking-wider">
                          <span>{isUser ? (lang === "uz" ? "SIZ" : "USER") : "JARVIS_AI"}</span>
                          <span>•</span>
                          <span>{m.timestamp.toLocaleTimeString("uz-UZ", { hour12: false })}</span>
                        </div>
                        <div className="flex items-start gap-2 max-w-[85%]">
                          {!isUser && (
                            <button
                              onClick={() => playBase64Audio(m.id, m.audioBase64 || "", m.text)}
                              className={`p-2 rounded-lg border flex items-center justify-center transition-all cursor-pointer ${
                                currentlyPlayingMessageId === m.id
                                  ? "bg-purple-500/20 border-purple-500 text-white animate-pulse"
                                  : "bg-black/57 border-white/5 text-[#00F2FF] hover:border-purple-500/40 hover:text-white"
                              }`}
                              title={currentlyPlayingMessageId === m.id ? (lang === "uz" ? "To'xtatish" : "Pause") : (lang === "uz" ? "Takrorlash" : "Replay")}
                            >
                              {currentlyPlayingMessageId === m.id ? <Pause className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                            </button>
                          )}
                          <div
                            className={`p-3 rounded-2xl text-[12.5px] leading-relaxed font-sans shadow-md ${
                              isUser
                                ? "bg-gradient-to-br from-purple-950/40 via-[#181232]/50 to-purple-950/30 border border-purple-500/20 text-slate-200"
                                : "bg-black/80 border border-white/5 text-slate-100"
                            }`}
                          >
                            {m.isTranscribing ? (
                              <div className="flex items-center gap-2 font-mono">
                                <span className="animate-[spin_1.5s_linear_infinite] inline-block h-3 w-3 rounded-full border-2 border-purple-500 border-t-transparent" />
                                <span className="text-purple-400 text-[11px] select-none">{m.text}</span>
                              </div>
                            ) : (
                              <div>
                                <p className="whitespace-pre-line">{m.text}</p>
                                {m.youtubeVideo && (
                                  <div className="mt-2.5 p-2 rounded-xl bg-black/90 border border-purple-500/20 flex gap-3 items-center">
                                    <img 
                                      src={m.youtubeVideo.image} 
                                      alt="Cover" 
                                      className="h-12 w-16 object-cover rounded-lg shrink-0 border border-white/5"
                                      referrerPolicy="no-referrer"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[11px] font-semibold text-slate-200 truncate">{m.youtubeVideo.title}</p>
                                      <p className="text-[9px] text-[#00F2FF] font-mono mt-0.5">YouTube Audio</p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCurrentPlayingVideo(m.youtubeVideo!);
                                        setIsVideoMinimized(false);
                                      }}
                                      className="p-1.5 rounded-lg bg-[#00F2FF]/10 hover:bg-[#00F2FF]/35 border border-[#00F2FF]/20 text-white cursor-pointer active:scale-95 transition-all"
                                      title="Qo'shiqni qo'yish"
                                    >
                                      <Play className="h-3.5 w-3.5 fill-white" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            {/* Quick Sci Fi Music Station Shortcuts */}
            <div className="glass-hologram p-3.5 rounded-2xl border border-purple-500/15 flex flex-col gap-2.5 shadow-xl w-full select-none bg-black/40">
              <div className="flex justify-between items-center px-1">
                <span className="text-[9px] text-slate-400 font-mono uppercase tracking-widest flex items-center gap-1.5">
                  <Headphones className="h-3.5 w-3.5 text-purple-400 animate-pulse" />
                  <span>{lang === "uz" ? "YOUTUBE AI MUSIQA PORTALI" : "YOUTUBE AI MUSIC PORTAL"}</span>
                </span>
                <span className="text-[8px] bg-[#00F2FF]/10 text-[#00F2FF] border border-[#00F2FF]/20 px-1.5 py-0.5 rounded font-mono uppercase font-black tracking-wider">
                  HQ_AUDIO
                </span>
              </div>

              {/* Music Search bar */}
              <div className="flex gap-2 items-center mt-1">
                <input
                  type="text"
                  value={musicSearchQuery}
                  onChange={(e) => setMusicSearchQuery(e.target.value)}
                  placeholder={lang === "uz" ? "Qoshiq yoki ijodkor nomi (Masalan: Lola)..." : "Search YouTube (E.g. Lola)..."}
                  className="flex-1 bg-black/60 border border-white/5 hover:border-purple-500/20 focus:border-purple-500 rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none transition-all font-sans"
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (!musicSearchQuery.trim()) return;
                      setIsSearchingMusic(true);
                      try {
                        const res = await fetch("/api/search-youtube", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ query: musicSearchQuery })
                        });
                        const data = await res.json();
                        if (data.video) {
                          setCurrentPlayingVideo(data.video);
                          setIsVideoMinimized(false);
                          setMusicSearchQuery("");
                        }
                      } catch (err) {
                        console.error("Music search err:", err);
                      } finally {
                        setIsSearchingMusic(false);
                      }
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    if (!musicSearchQuery.trim()) return;
                    setIsSearchingMusic(true);
                    try {
                      const res = await fetch("/api/search-youtube", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ query: musicSearchQuery })
                      });
                      const data = await res.json();
                      if (data.video) {
                        setCurrentPlayingVideo(data.video);
                        setIsVideoMinimized(false);
                        setMusicSearchQuery("");
                      }
                    } catch (err) {
                      console.error("Music search err:", err);
                    } finally {
                      setIsSearchingMusic(false);
                    }
                  }}
                  disabled={isSearchingMusic}
                  className="px-3 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 disabled:opacity-40 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-[10px] font-mono tracking-widest font-black uppercase transition-all flex items-center gap-1.5 cursor-pointer h-8"
                >
                  {isSearchingMusic ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <span>FIND</span>
                  )}
                </button>
              </div>

              {/* Preselected list */}
              <div className="flex gap-2 overflow-x-auto py-1 scrollbar-none scroll-smooth">
                {[
                  { name: "Sherali Jo'rayev - Karvon", q: "sherali jorayev karvon" },
                  { name: "Yulduz Usmonova - Muhabbat", q: "yulduz usmonova muhabbat" },
                  { name: "Tohir Sodiqov - Bolalar", q: "bolalar guruhi qoshiqlari" },
                  { name: "Lola - Muhabbatim", q: "lola muhabbatim" },
                  { name: "Sariq Bola - Qoshiqlar", q: "sariq bola qoshiqlari" }
                ].map((item, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={async () => {
                      setIsSearchingMusic(true);
                      try {
                        const res = await fetch("/api/search-youtube", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ query: item.q })
                        });
                        const data = await res.json();
                        if (data.video) {
                          setCurrentPlayingVideo(data.video);
                          setIsVideoMinimized(false);
                        }
                      } catch (err) {
                        console.error(err);
                      } finally {
                        setIsSearchingMusic(false);
                      }
                    }}
                    className="shrink-0 text-[10px] px-2.5 py-1.5 rounded-lg bg-black/80 hover:bg-purple-950/20 hover:border-purple-500/20 border border-white/5 text-slate-300 transition-all font-sans cursor-pointer active:scale-95"
                  >
                    🎵 {item.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Input Bar / Controls */}
            <div className="glass-hologram p-4 rounded-2xl border border-purple-500/15 flex flex-col gap-3 shadow-2xl relative w-full">
              <form onSubmit={handleTextSubmit} className="flex gap-2 items-center w-full">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={lang === "uz" ? "Matnli savol yoza olasiz..." : "Type text question here..."}
                  disabled={isProcessing}
                  className="flex-1 bg-black/80 border border-white/10 hover:border-purple-500/30 focus:border-purple-500 rounded-xl px-4 py-3 text-xs text-white selection:bg-purple-500/30 placeholder-slate-600 focus:outline-none transition-all font-sans"
                />
                
                {/* Micro record trigger (Push To Talk style) */}
                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isProcessing}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-center shrink-0 ${
                    isRecording
                      ? "bg-red-500/20 border-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.25)] animate-pulse"
                      : "bg-[#0b0b0f]/80 border-white/10 text-purple-400 hover:border-purple-500 hover:bg-purple-500/5 hover:text-white"
                  }`}
                  title={isRecording ? (lang === "uz" ? "Yuborish" : "Stop Done") : (lang === "uz" ? "Ovoz yozish" : "Record Voice")}
                >
                  {isRecording ? <VolumeX className="h-4 w-4 text-red-500 animate-[pulse_1.5s_infinite]" /> : <Mic className="h-4 w-4" />}
                </button>

                <button
                  type="submit"
                  disabled={!inputText.trim() || isProcessing}
                  className="p-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-30 disabled:hover:bg-purple-600 text-white rounded-xl tracking-wider text-xs font-semibold cursor-pointer active:scale-95 transition-all flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(168,85,247,0.15)]"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>

              {/* Little informative guide under input */}
              <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono tracking-tight px-1 select-none">
                <span>{isProcessing ? "PROCESSING_AI_HANDSHAKE..." : "STANDBY."}</span>
                <span>{isRecording ? "🎤 RECORDING_AUDIO" : "[PUSH_TO_TALK_CAPTURES_OK]"}</span>
              </div>
            </div>
            
          </div>
        )}

      </main>

      {/* GLOBAL SCIFI YOUTUBE MUSIC CONTROLLER */}
      {currentPlayingVideo && (
        <div 
          className={`fixed z-50 transition-all duration-500 ease-out border shadow-2xl glass ${
            isVideoMinimized
              ? "bottom-6 right-6 h-16 w-16 rounded-full border-[#00F2FF]/40 shadow-[0_0_25px_rgba(0,242,255,0.4)] hover:scale-105 active:scale-95"
              : "bottom-6 right-6 md:right-10 w-[310px] sm:w-[350px] rounded-2xl border-purple-500/40 bg-black/95 p-4 flex flex-col gap-3 shadow-[0_0_40px_rgba(168,85,247,0.25)] animate-fade-in"
          }`}
        >
          {isVideoMinimized ? (
            // Minimized rotating disc mode
            <div className="relative h-full w-full flex items-center justify-center cursor-pointer group rounded-full overflow-hidden"
              onClick={() => setIsVideoMinimized(false)}
            >
              <img 
                src={currentPlayingVideo.image} 
                alt="disk" 
                className="h-full w-full object-cover rounded-full animate-[spin_10s_linear_infinite]"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity text-white text-[9px] font-mono uppercase tracking-wider text-center p-1">
                <Volume2 className="h-4 w-4 text-[#00F2FF] animate-bounce mb-1" />
                <span>EXPAND</span>
              </div>
            </div>
          ) : (
            // Maximized full interface view
            <>
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <div className="flex items-center gap-1.5">
                  <AudioLines className="h-3.5 w-3.5 text-[#00F2FF] animate-pulse" />
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[#00F2FF]">AI_MUSIC_STATION</span>
                </div>
                <div className="flex items-center gap-1">
                  <button 
                    type="button"
                    onClick={() => setIsVideoMinimized(true)}
                    className="p-1 hover:text-[#00F2FF] text-slate-400 hover:bg-white/5 rounded transition-colors cursor-pointer"
                    title="Yig'ish (Minimize)"
                  >
                    <VolumeX className="h-3.5 w-3.5" />
                  </button>
                  <button 
                    type="button"
                    onClick={() => setCurrentPlayingVideo(null)}
                    className="p-1 hover:text-red-400 text-slate-400 hover:bg-white/5 rounded transition-colors cursor-pointer"
                    title="Yopish (Close)"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Responsive Iframe container with high fidelity aspects */}
              <div className="relative aspect-video w-full bg-black rounded-lg overflow-hidden border border-white/5">
                <iframe
                  width="100%"
                  height="100%"
                  src={`https://www.youtube.com/embed/${currentPlayingVideo.videoId}?autoplay=1`}
                  title={currentPlayingVideo.title}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="rounded-lg"
                ></iframe>
              </div>

              <div className="space-y-0.5 min-w-0">
                <p className="text-xs font-semibold text-white truncate leading-snug">{currentPlayingVideo.title}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px] text-slate-500 font-mono">ID: {currentPlayingVideo.videoId}</span>
                  <a 
                    href={`https://youtube.com/watch?v=${currentPlayingVideo.videoId}`} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-[9px] text-[#00F2FF] hover:underline flex items-center gap-0.5 text-right font-mono"
                  >
                    <span>YOUTUBE_WATCH</span>
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              </div>
            </>
          )}
        </div>
      )}

    </div>
  );
}

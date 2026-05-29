import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();
const httpServer = http.createServer(app);
const PORT = 3000;

// Middleware
app.use(express.json({ limit: "25mb" }));

// Initialize Gemini client lazily to avoid crashing on startup if the API key is missing.
let isApiKeyExpired = false;
let aiClient: GoogleGenAI | null = null;
let lastInitialApiKey: string | undefined = undefined;

function checkApiKeyError(error: any) {
  if (!error) return;
  let errMsg = error.message || error.toString() || "";
  
  if (errMsg.trim().startsWith("{") || errMsg.includes('"details"')) {
    try {
      const parsed = JSON.parse(errMsg);
      if (parsed.error && parsed.error.message) {
        errMsg = parsed.error.message;
      }
    } catch (_) {}
  }

  const isExpired = 
    errMsg.includes("API_KEY_INVALID") || 
    errMsg.includes("API key expired") || 
    errMsg.includes("API key not valid") ||
    errMsg.includes("API key is invalid") ||
    errMsg.includes("API key has expired") ||
    errMsg.includes("API_KEY_EXPIRED");

  if (isExpired) {
    if (!isApiKeyExpired) {
      console.warn("API Key Status: Expired or invalid detected. Activating offline fallback mode.");
      isApiKeyExpired = true;
    }
  }
}

function getGeminiClient(forceRetry = false): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required. Iltimos, Settings -> Secrets panelida api kalitni sozlang.");
  }

  // If environment variable key has changed or been updated, reset cached status and recreate client
  if (apiKey !== lastInitialApiKey) {
    console.log("Detecting GEMINI_API_KEY environment state change. Resetting expired marker and caching new client.");
    isApiKeyExpired = false;
    aiClient = null;
    lastInitialApiKey = apiKey;
  }

  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

function isGroqReady(): boolean {
  return typeof process.env.GROQ_API_KEY === "string" && process.env.GROQ_API_KEY.trim().length > 0;
}

async function transcribeAudioWithGroq(audioBase64: string): Promise<string> {
  try {
    const audioBuffer = Buffer.from(audioBase64, "base64");
    const blob = new Blob([audioBuffer], { type: "audio/webm" });
    const formData = new FormData();
    formData.append("file", blob, "speech.webm");
    formData.append("model", "whisper-large-v3");
    formData.append("language", "uz");

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Whisper API error: ${response.status} - ${errorText}`);
    }

    const result: any = await response.json();
    return result.text || "";
  } catch (err: any) {
    console.error("transcribeAudioWithGroq error:", err);
    throw err;
  }
}

async function generateChatWithGroq(messageText: string, history: any[]): Promise<{ userTranscript: string; aiResponse: string; youtubeSearchQuery: string }> {
  try {
    const messages = [
      {
        role: "system",
        content: "Sizning ismingiz Jarvis. Siz foydalanuvchi bilan real vaqtda ovozli va vizual (ekran translyatsiyasi) muloqot quruvchi aqlli, do'stona AI yordamchisiz. Loyihangiz interfeysida real vaqtda audio muloqot, matnli chat xabarlashuv, va foydalanuvchi o'z ekranini ulashib ko'rsatishi (Screen Broadcast/Share canvas stream) va uni vizual tahlil qilishingiz uchun muloqot tizimi mavjud.\n\nIDENTITY RULES (MUHIM):\n1. Agar sizdan 'Seni kim yaratgan?' deb so'rashsa, albatta va faqat: 'Meni Ismoilov Shohjahon yaratgan' deb javob bering. Hech qachon botliy.uz, yaratuvchining yoshi, tug'ilgan yili yoki telegram manzili kabi boshqa ma'lumotlarni o'z-o'zidan aytmang.\n2. Yaratuvchining yoshi (15 yosh), tug'ilgan sanasi (12.24.2010 ya'ni 24-dekabr 2010-yil) va boshqa tafsilotlarni FAQAT va FAQAT foydalanuvchi buni alohida so'rasagina (masalan, 'Yaratuvching necha yoshda?', 'U qachon tug'ilgan?' deb so'ralsa) bersin.\n3. Agar yaratuvchingiz bilan qanday bog'lanishni so'rashsa (e.g. 'Yaratuvching bilan qanday bog'lansam bo'ladi?'), javobni faqat 'telegram:@shoh_deweloper' (yoki Telegram orqali @shoh_deweloper profiliga yozishlarini) deb bersin. Buni ham faqat so'ralgandagina aytsin.\n4. OpenAI, Google yoki boshqa kompaniya yaratgan deb umuman aytmang.\n\nJavobni quyidagi JSON formatida qaytaring, boshqa hech qanday izoh qo'shmang:\n{\n  \"userTranscript\": \"Transcribed text or empty if messageText is used\",\n  \"aiResponse\": \"Your voice-ready conversational spoken response\",\n  \"youtubeSearchQuery\": \"Song keyword request, or empty\"\n}"
      }
    ];

    if (history && Array.isArray(history)) {
      for (const h of history) {
        if (h.sender && h.text) {
          messages.push({
            role: h.sender === "user" ? "user" : "assistant",
            content: h.text
          });
        }
      }
    }

    messages.push({
      role: "user",
      content: messageText
    });

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: messages,
        response_format: { type: "json_object" },
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq LLM error: ${response.status} - ${errorText}`);
    }

    const result: any = await response.json();
    const content = result.choices?.[0]?.message?.content || "{}";
    
    try {
      const parsed = JSON.parse(content);
      return {
        userTranscript: parsed.userTranscript || messageText || "",
        aiResponse: parsed.aiResponse || "Kechirasiz, xizmat ko'rsatishda xatolik yuz berdi.",
        youtubeSearchQuery: parsed.youtubeSearchQuery || ""
      };
    } catch {
      return {
        userTranscript: messageText || "",
        aiResponse: content,
        youtubeSearchQuery: ""
      };
    }
  } catch (err: any) {
    console.error("generateChatWithGroq error:", err);
    throw err;
  }
}

async function generateSimulatedChatWithGroq(query: string): Promise<string> {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: "Siz foydalanuvchi bilan real vaqtda muloqot qiluvchi do'stona aqlli ovozli va vizual (ekran translyatsiyasi) yordamchi (Jarvis)siz. Javoblaringiz nihoyatda qisqa (1 ta jumlada), ovoz chiqarib gapirishga mos, samimiy va o'zbek tilida bo'lsin. Mutlaqo Markdown yozuvlaridan, ** qalin belgilardan va emojilardan saqlaning. IDENTITY RULES (MUHIM):\n1. Agar sizdan 'Seni kim yaratgan?' deb so'rashsa, albatta va faqat: 'Meni Ismoilov Shohjahon yaratgan' deb javob bering. Hech qachon botliy.uz, yaratuvchining yoshi, tug'ilgan yili yoki telegram manzili kabi boshqa ma'lumotlarni o'z-o'zidan aytmang.\n2. Yaratuvchining yoshi (15 yosh), tug'ilgan sanasi (12.24.2010) va boshqa tafsilotlarni FAQAT va FAQAT foydalanuvchi buni alohida so'rasagina (masalan, 'Yaratuvching necha yoshda?', 'U qachon tug'ilgan?' deb so'ralsa) bersin.\n3. Agar yaratuvchingiz bilan qanday bog'lanishni so'rashsa ('Yaratuvching bilan qanday bog'lansam bo'ladi?'), javobni faqat 'telegram:@shoh_deweloper' (yoki Telegram orqali @shoh_deweloper profiliga yozishlarini) deb aytsin. Buni ham faqat so'ralgandagina aytsin.\n4. OpenAI, Google yoki boshqa kompaniya yaratgan deb umuman aytmang."
          },
          {
            role: "user",
            content: query
          }
        ],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`Groq LLM simulation error: ${response.status}`);
    }

    const result: any = await response.json();
    return result.choices?.[0]?.message?.content || "";
  } catch (err) {
    console.error("generateSimulatedChatWithGroq error:", err);
    throw err;
  }
}

// 0. Highly robust YouTube scraper search helper
async function findYoutubeVideo(query: string): Promise<{ videoId: string; title: string; image: string } | null> {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + " audio")}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept-Language": "uz,uz-UZ;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });
    const html = await response.text();
    
    // Find videoId pattern
    const videoMatches = html.match(/"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/);
    if (videoMatches && videoMatches[1]) {
      const videoId = videoMatches[1];
      
      // Attempt to extract title
      let title = query;
      const titleMatch = html.match(/"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"]+)"/);
      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1];
      } else {
        const altMatch = html.match(/"title"\s*:\s*\{\s*"simpleText"\s*:\s*"([^"]+)"/);
        if (altMatch && altMatch[1]) {
          title = altMatch[1];
        }
      }
      
      return {
        videoId,
        title: title.replace(/\\u0026/g, "&").replace(/\\"/g, '"'),
        image: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
      };
    }
  } catch (error) {
    console.error("findYoutubeVideo error:", error);
  }
  return null;
}

// Key verification config helper (avoids consuming any Gemini API quota on startup)
app.get("/api/config", (req, res) => {
  try {
    getGeminiClient();
  } catch (err: any) {
    // catch key errors passively to keep flags in sync
  }
  res.json({ 
    apiKeyMissing: (!process.env.GEMINI_API_KEY || isApiKeyExpired) && !isGroqReady(), 
    isExpired: isApiKeyExpired,
    groqActive: isGroqReady()
  });
});

// A debug endpoint to verify API key works
app.get("/api/debug-connection", async (req, res) => {
  try {
    isApiKeyExpired = false;
    aiClient = null; // Allow re-initialization with potentially updated environment key
    const ai = getGeminiClient();
    // Try a very simple model check to verify API key
    await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
    });
    isApiKeyExpired = false;
    res.json({ status: "success", message: "API key and connection are working correctly." });
  } catch (error: any) {
    checkApiKeyError(error);
    res.status(500).json({ status: "error", message: error.message, isExpired: isApiKeyExpired });
  }
});

// A manual endpoint to allow instantaneous searches directly in the UI
app.post("/api/search-youtube", async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: "Qidiruv so'rovi topilmadi" });
  }
  const result = await findYoutubeVideo(query);
  if (result) {
    return res.json({ video: result });
  }
  return res.status(404).json({ error: "Qo'shiq topilmadi" });
});

// A localized helper that returns rule-based smart answers when Gemini Quotas are exhausted.
function getLocalFallbackResponse(messageText: string, isAudio: boolean): { aiText: string; userText: string } {
  const normText = (messageText || "").toLowerCase().trim();
  let userText = messageText || "";
  if (isAudio) {
    userText = "[Ovozli xabar]";
  }

  let aiText = "Salom! Men Jarvis Voice qabulxonasiman. Hozirda bulutli bepul Gemini API kunlik so'rovlar limitiga yetdi (Limit: kuniga 20 ta so'rov). Xavotir olmang! Tizim avtomatik tarzda mahalliy oflayn rejimga o'tdi. Men sizga oflayn aqlli ovoz orqali yordam berishda davom eta olaman. Qanday yordam bera olaman?";

  if (normText.includes("salom") || normText.includes("hello") || normText.includes("hi") || normText.includes("alo")) {
    aiText = "Salom! Do'stim, sizga yordam berishdan hamisha bag'oyat mamnunman. Mahalliy oflayn barqaror rejimimiz faol!";
  } else if (normText.includes("rahmat") || normText.includes("thank")) {
    aiText = "Butunlay arziydi! Doimo xizmatingizdaman. Yana qanday savollaringiz bor?";
  } else if (normText.includes("isming") || normText.includes("kimsa") || normText.includes("who are you") || normText.includes("what is your name")) {
    aiText = "Mening ismim - Jarvis Voice. Men o'zbek va ingliz tillarida faol muloqot qila oladigan portalman.";
  } else if (normText.includes("bog'lanish") || normText.includes("bog'lansam") || normText.includes("aloqa") || normText.includes("kontakt") || normText.includes("contact") || normText.includes("telegram") || normText.includes("muloqot qilsam")) {
    aiText = "telegram:@shoh_deweloper";
  } else if (normText.includes("yoshi") || normText.includes("necha yoshda") || normText.includes("tug'ilgan") || normText.includes("born") || normText.includes("yoshda")) {
    aiText = "Yaratuvchim 12.24.2010 yilda tug'ilgan va hozirda 15 yoshda.";
  } else if (normText.includes("yaratgan") || normText.includes("yaratuvchi") || normText.includes("muallif") || normText.includes("creator") || normText.includes("created") || normText.includes("shohjahon") || normText.includes("botliy")) {
    aiText = "Meni Ismoilov Shohjahon yaratgan.";
  } else if (normText.includes("ob-havo") || normText.includes("weather")) {
    aiText = "Hozircha ob-havo o'rtacha iliq va juda yaxshi. Oflayn rejimda harorat datchiklariga ko'ra bugun kayfiyat a'lo bo'lishi kutilmoqda!";
  } else if (normText.includes("vaqt") || normText.includes("time") || normText.includes("soat")) {
    const now = new Date();
    aiText = `Hozirgi vaqt: soat ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}.`;
  } else if (normText.includes("qanday") || normText.includes("how are you")) {
    aiText = "Rahmat, ishlar a'lo darajada! Tizim datchiklari barqaror ishlashni davom ettirmoqda. O'zingizda nima gaplar?";
  } else if (normText.includes("help") || normText.includes("yordam") || normText.includes("assistant")) {
    aiText = "Men sizga oflayn rejimda har xil savollarga doir muloqot qilishda va matnlarni drayverlar orqali eshittirishda yordam beraman. Savolingizni yozavering!";
  } else if (normText.includes("zo'r") || normText.includes("yaxshi") || normText.includes("ajoyib")) {
    aiText = "Sizdan buni eshitish juda quvonarli! Tizim barqaror ishlashidan men ham xursandman.";
  } else if (normText.includes("tog'") || normText.includes("togʻ") || normText.includes("tog`") || normText.includes("toglar") || normText.includes("mountain")) {
    aiText = "Qarang, tog'lar qanday viqorli va ulug'vor turibdi! Ular bizga matonat, sabr va abadiylikni eslatadi. Har bir buyuk cho'qqi ortida mashaqqatli yo'l yotibdi. Keling, maqsadlarimiz sari xuddi shu tog' cho'qqilaridek qat'iyat va bardosh bilan intilaylik!";
  }

  return { aiText, userText };
}

// Helper to strip markdown formatting, emojis, and special symbols for smooth, pleasant TTS speech
function cleanTextForAudioTTS(text: string): string {
  if (!text) return "";
  
  // 1. Strip standard emojis
  let clean = text.replace(/[\u1F600-\u1F64F]|[\u1F300-\u1F5FF]|[\u1F680-\u1F6FF]|[\u1F1E0-\u1F1FF]|[\u2700-\u27BF]|[\u1F900-\u1F9FF]|[\u1F100-\u1F1FF]|[\u2600-\u26FF]|[\u2300-\u23FF]/g, "");

  // 2. Clear Markdown bolding (**), italics (*), lists (- or *), code blocks, hashtags, inline codes, URLs
  clean = clean
    .replace(/\*\*+/g, "") // remove **
    .replace(/\*+/g, "")   // remove *
    .replace(/__+/g, "")   // remove __
    .replace(/_+/g, "")    // remove _
    .replace(/`+/g, "")    // remove `
    .replace(/#+/g, "")    // remove headers #
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1") // clean links [text](url) -> text
    .replace(/[-\*+]\s+/g, "") // remove list indicators
    .replace(/^\d+\.\s+/gm, "") // remove numbered lists "1. "
    .trim();

  return clean;
}

// Convert raw 16-bit 24kHz Mono PCM base64 from gemini-3.1-flash-tts-preview into standard WAV base64
function convertPCMToWavBase64(pcmBase64: string, sampleRate: number = 24000): string {
  try {
    const pcmBuffer = Buffer.from(pcmBase64, "base64");
    
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmBuffer.length;
    const chunkSize = 36 + dataSize;

    const wavHeader = Buffer.alloc(44);

    // RIFF identifier
    wavHeader.write("RIFF", 0, "ascii");
    // file length minus RIFF and WAVE identifiers
    wavHeader.writeUInt32LE(chunkSize, 4);
    // RIFF type
    wavHeader.write("WAVE", 8, "ascii");

    // format chunk identifier
    wavHeader.write("fmt ", 12, "ascii");
    // format chunk length
    wavHeader.writeUInt32LE(16, 16);
    // sample format
    wavHeader.writeUInt16LE(1, 20); // 1 for uncompressed PCM
    // channel count
    wavHeader.writeUInt16LE(numChannels, 22);
    // sample rate
    wavHeader.writeUInt32LE(sampleRate, 24);
    // byte rate
    wavHeader.writeUInt32LE(byteRate, 28);
    // block align
    wavHeader.writeUInt16LE(blockAlign, 32);
    // bits per sample
    wavHeader.writeUInt16LE(bitsPerSample, 34);

    // data chunk identifier
    wavHeader.write("data", 36, "ascii");
    // data chunk length
    wavHeader.writeUInt32LE(dataSize, 40);

    // Concatenate header and data
    const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
    return wavBuffer.toString("base64");
  } catch (err) {
    console.error("Error converting PCM to WAV:", err);
    return pcmBase64;
  }
}

// 1. Voice HTTP API Route
app.post("/api/chat-voice", async (req, res) => {
  const { audioBase64, messageText, history, voice } = req.body;
  
  let useFallback = false;
  let ai: GoogleGenAI | null = null;
  
  try {
    ai = getGeminiClient(true); // Always try to initialize, bypassing previous cached failure flags
  } catch (keyErr: any) {
    checkApiKeyError(keyErr);
    useFallback = true;
  }

  if (useFallback) {
    if (isGroqReady()) {
      try {
        console.log("Gemini API key is missing or expired, but Groq API key is available! Processing via Groq...");
        let userTranscript = messageText || "";
        if (audioBase64) {
          console.log("Transcribing audio with Groq Whisper model...");
          userTranscript = await transcribeAudioWithGroq(audioBase64);
          console.log("Transcription result:", userTranscript);
        }

        const groqResult = await generateChatWithGroq(userTranscript, history || []);
        
        let youtubeVideo = null;
        let aiResponse = groqResult.aiResponse;
        if (groqResult.youtubeSearchQuery) {
          const ytResult = await findYoutubeVideo(groqResult.youtubeSearchQuery);
          if (ytResult) {
            youtubeVideo = ytResult;
            aiResponse = `${aiResponse} 🎵 Hozir sizga "${ytResult.title}" qo'shig'ini qo'yib beraman!`;
          }
        }

        return res.json({
          userText: userTranscript,
          aiText: aiResponse,
          audioBase64: "", // local speech synthesis on client
          ttsFallback: true,
          youtubeVideo: youtubeVideo,
        });
      } catch (groqErr: any) {
        console.error("Groq fallback execution failed, resorting to rule-base fallback:", groqErr.message);
      }
    }

    const fallback = getLocalFallbackResponse(messageText, !!audioBase64);
    let youtubeVideo = null;
    let aiResponse = fallback.aiText;
    const queryLower = (messageText || "").toLowerCase().trim().replace(/['`’‘ʻ]/g, "o'");
    
    // Auto-detect a song query during offline/expired key fallback mode!
    if (queryLower.includes("qo'shiq qo'y") || queryLower.includes("qoshiq qoy") || queryLower.includes("qoʻshiq qoʻy") || queryLower.includes("play song") || queryLower.includes("muzika") || queryLower.includes("karvon") || queryLower.includes("shukurjon") || queryLower.includes("yulduz")) {
      const songName = queryLower
        .replace(/qo'shiq qo'y/i, "")
        .replace(/qoshiq qoy/i, "")
        .replace(/qoʻshiq qoʻy/i, "")
        .replace(/play song/i, "")
        .replace(/muzika/i, "")
        .trim();
        
      const ytResult = await findYoutubeVideo(songName || "Sherali Jo'rayev Karvon");
      if (ytResult) {
        youtubeVideo = ytResult;
        aiResponse = `Xo'p bo'ladi. Hozir sizga "${ytResult.title}" qo'shig'ini qo'yib beraman! 🎵`;
      }
    }

    return res.json({
      userText: fallback.userText,
      aiText: aiResponse,
      audioBase64: "", // local TTS synthesizer will read aiText on the client
      ttsFallback: true,
      youtubeVideo: youtubeVideo,
    });
  }

  try {
    // Map history to standard contents format
    const contents: any[] = [];
    if (history && Array.isArray(history)) {
      for (const h of history) {
        if (h.sender && h.text) {
          contents.push({
            role: h.sender === "user" ? "user" : "model",
            parts: [{ text: h.text }],
          });
        }
      }
    }

    // Prepare current user parts
    const userParts: any[] = [];
    if (audioBase64) {
      userParts.push({
        inlineData: {
          data: audioBase64,
          mimeType: "audio/webm", // recorded standard on modern browers (MediaRecorder)
        },
      });
      userParts.push({
        text: "User has provided this audio recording. 1. Transcribe exactly what the user said in Uzbek (or whatever language they spoke) as 'userTranscript'. 2. Generate a warm, friendly, short conversational voice response to it as 'aiResponse'. Keep responses in the same language as the user (defaulting to Uzbek). Keep it strictly plain text. Absolutely NO markdown formatting, NO bold symbols (**), NO bullet points, and NO emojis, as this will be read by a text-to-speech engine. 3. If they asked to play a song/music/singer/band (e.g., 'qo'shiq qo'y', 'play song', 'muzika eshitamiz', 'Youtubedan qo'shiq'), extract the specific artist and song title as 'youtubeSearchQuery'. Otherwise leave 'youtubeSearchQuery' empty. 4. IDENTITY RULE: If they ask who created you, say 'Meni Ismoilov Shohjahon yaratgan'. Do NOT mention other details like registration domain, age or contact info here unless specifically asked. Only if they particularly ask for the creator's age/birthday, say 'Yaratuvchim 12.24.2010 yilda tug'ilgan va hozirda 15 yoshda'. If they particularly ask how to contact him, say 'telegram:@shoh_deweloper'. NEVER say you were made by Google or OpenAI.",
      });
    } else if (messageText) {
      userParts.push({
        text: messageText,
      });
      userParts.push({
        text: "User has provided this message text. 1. Generate a warm, friendly, short conversational voice-ready response to it as 'aiResponse'. Leave 'userTranscript' empty. Default language is Uzbek unless they used another language. Keep it strictly plain text. Absolutely NO markdown formatting, NO bold symbols (**), NO bullet points, and NO emojis, as this will be read by a text-to-speech engine. 2. If they asked to play a song/music/singer/band (e.g., 'qo'shiq qo'y', 'play song', 'muzika eshitamiz', 'Youtubedan qo'shiq'), extract the specific artist and song title as 'youtubeSearchQuery'. Otherwise leave 'youtubeSearchQuery' empty. 3. IDENTITY RULE: If they ask who created you, say 'Meni Ismoilov Shohjahon yaratgan'. Do NOT mention other details like registration domain, age or contact info here unless specifically asked. Only if they particularly ask for the creator's age/birthday, say 'Yaratuvchim 12.24.2010 yilda tug'ilgan va hozirda 15 yoshda'. If they particularly ask how to contact him, say 'telegram:@shoh_deweloper'. NEVER say you were made by Google or OpenAI.",
      });
    } else {
      return res.status(400).json({ error: "Xabar matni yoki ovoz moduli topilmadi." });
    }

    contents.push({
      role: "user",
      parts: userParts,
    });

    console.log("Generating response from gemini-3.5-flash...");
    let textResponse;
    try {
      textResponse = await ai!.models.generateContent({
        model: "gemini-3.5-flash",
        contents: contents,
        config: {
          systemInstruction: "Sizning ismingiz Jarvis. Siz foydalanuvchi bilan real vaqtda muloqot qiluvchi do'stona aqlli ovozli va vizual (ekran translyatsiyasi) yordamchi (Jarvis)siz. Loyihangiz interfeysida real vaqtda audio muloqot, matnli chat xabarlashuv, va foydalanuvchi o'z ekranini ulashib ko'rsatishi (Screen Broadcast/Share canvas stream) va uni vizual tahlil qilishingiz uchun muloqot tizimi mavjud.\n\nIDENTITY RULES (MUHIM):\n1. Agar sizdan 'Seni kim yaratgan?' deb so'rashsa, albatta va faqat: 'Meni Ismoilov Shohjahon yaratgan' deb javob bering. Hech qachon botliy.uz, yaratuvchining yoshi, tug'ilgan yili yoki telegram manzili kabi boshqa ma'lumotlarni o'z-o'zidan aytmang.\n2. Yaratuvchining yoshi (15 yosh), tug'ilgan sanasi (12.24.2010 ya'ni 24-dekabr 2010-yil) va boshqa tafsilotlarni FAQAT va FAQAT foydalanuvchi buni alohida so'rasagina (masalan, 'Yaratuvching necha yoshda?', 'U qachon tug'ilgan?' deb so'ralsa) bersin.\n3. Agar yaratuvchingiz bilan qanday bog'lanishni so'rashsa (e.g. 'Yaratuvching bilan qanday bog'lansam bo'ladi?'), javobni faqat 'telegram:@shoh_deweloper' (yoki Telegram orqali @shoh_deweloper profiliga yozishlarini) deb bersin. Buni ham faqat so'ralgandagina aytsin.\n4. OpenAI, Google yoki boshqa kompaniya yaratgan deb umuman aytmang.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              userTranscript: {
                type: Type.STRING,
                description: "Direct transcription of what the user spoke. Keep empty if user typed text.",
              },
              aiResponse: {
                type: Type.STRING,
                description: "Short and pleasant conversational spoken response to the user.",
              },
              youtubeSearchQuery: {
                type: Type.STRING,
                description: "Extracted artist and song name if user wants to play a song/music (e.g., 'Sherali Jo'rayev Karvon', 'Dua Lipa New Rules'). Keep empty if not requested.",
              }
            },
            required: ["userTranscript", "aiResponse"],
          },
        },
      });
      isApiKeyExpired = false; // Successfully ran content generation, clear key status flags
    } catch (genErr: any) {
      checkApiKeyError(genErr);
      let cleanErr = genErr.message || String(genErr);
      if (cleanErr.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(cleanErr);
          if (parsed.error && parsed.error.message) {
            cleanErr = parsed.error.message;
          }
        } catch (_) {}
      }
      console.warn("Gemini content generation failed, switching to beautiful local chat fallback:", cleanErr);
      const fallback = getLocalFallbackResponse(messageText, !!audioBase64);
      return res.json({
        userText: fallback.userText,
        aiText: fallback.aiText,
        audioBase64: "",
        ttsFallback: true,
      });
    }

    const parsedOutput = JSON.parse(textResponse.text || "{}");
    const userTranscript = parsedOutput.userTranscript || messageText || "";
    let aiResponse = parsedOutput.aiResponse || "Kechirasiz, xabarni tushunib bo'lmadi.";
    const youtubeSearchQuery = parsedOutput.youtubeSearchQuery || "";

    let youtubeVideo = null;
    if (youtubeSearchQuery) {
      console.log(`Searching YouTube for: ${youtubeSearchQuery}`);
      const ytResult = await findYoutubeVideo(youtubeSearchQuery);
      if (ytResult) {
        youtubeVideo = ytResult;
        aiResponse = `${aiResponse} 🎵 Hozir sizga "${ytResult.title}" qo'shig'ini qo'yib beraman!`;
      }
    }

    console.log("Generating TTS for AI response using gemini-3.1-flash-tts-preview...");
    let audioOutputBase64 = "";
    let ttsFallback = false;
    try {
      const cleanTtsText = cleanTextForAudioTTS(aiResponse);
      const voiceName = voice || "Zephyr";
      console.log(`Using AI Prebuilt Voice: ${voiceName} for cleaned TTS text: ${cleanTtsText}`);
      const ttsResponse = await ai!.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [
          {
            parts: [
              {
                text: cleanTtsText || aiResponse,
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName },
            },
          },
        },
      });

      const audioPart = ttsResponse.candidates?.[0]?.content?.parts?.[0];
      if (audioPart && audioPart.inlineData && audioPart.inlineData.data) {
        audioOutputBase64 = convertPCMToWavBase64(audioPart.inlineData.data, 24000);
      }
    } catch (ttsErr: any) {
      checkApiKeyError(ttsErr);
      let cleanErr = ttsErr.message || String(ttsErr);
      if (cleanErr.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(cleanErr);
          if (parsed.error && parsed.error.message) {
            cleanErr = parsed.error.message;
          }
        } catch (_) {}
      }
      console.warn("TTS generation error, falling back to client-side speech synthesis:", cleanErr);
      ttsFallback = true;
    }

    res.json({
      userText: userTranscript,
      aiText: aiResponse,
      audioBase64: audioOutputBase64,
      ttsFallback: ttsFallback,
      youtubeVideo: youtubeVideo,
    });
  } catch (error: any) {
    checkApiKeyError(error);
    console.warn("General error in api/chat-voice, resorting to secure fallback:", error.message);
    const fallback = getLocalFallbackResponse(messageText, !!audioBase64);
    res.json({
      userText: fallback.userText,
      aiText: fallback.aiText,
      audioBase64: "",
      ttsFallback: true,
    });
  }
});

// 2. Direct TTS Endpoint (for repeating or typing greetings)
app.post("/api/generate-tts", async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Matn taqdim etilmadi." });
    }

    try {
      const ai = getGeminiClient();
      const cleanTtsText = cleanTextForAudioTTS(text);
      const voiceName = voice || "Zephyr";
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: cleanTtsText || text }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName },
            },
          },
        },
      });

      const base64Data = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Data) {
        const wavBase64 = convertPCMToWavBase64(base64Data, 24000);
        return res.json({ audioBase64: wavBase64, ttsFallback: false });
      }
    } catch (ttsErr: any) {
      checkApiKeyError(ttsErr);
      let cleanErr = ttsErr.message || String(ttsErr);
      if (cleanErr.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(cleanErr);
          if (parsed.error && parsed.error.message) {
            cleanErr = parsed.error.message;
          }
        } catch (_) {}
      }
      console.warn("Direct TTS model call failed, falling back to local SpeechSynthesis:", cleanErr);
    }

    // Return empty sound representation with fallback flag
    return res.json({ audioBase64: "", ttsFallback: true });
  } catch (error: any) {
    console.error("Error in api/generate-tts:", error);
    res.json({ audioBase64: "", ttsFallback: true });
  }
});

// Setup WebSocket Server for Real-Time Live Audio Session
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", async (clientWs: WebSocket, request: any) => {
  console.log("WebSocket client joined. Preparing Gemini Live connection...");
  let geminiSession: any = null;
  let dataReceived = false;
  let latestScreenBase64 = "";

  // Extract selected voice from the request URL
  let selectedVoice = "Zephyr";
  if (request && request.url) {
    try {
      const { searchParams } = new URL(request.url, `http://${request.headers?.host || "localhost"}`);
      const voiceParam = searchParams.get("voice");
      if (voiceParam) {
        selectedVoice = voiceParam;
      }
    } catch (e) {
      console.warn("Could not parse request upgrade URL for voice option:", e);
    }
  }

  let isSimulated = false;
  let lastError: any = null;
  let ai: GoogleGenAI | null = null;

  try {
    ai = getGeminiClient();
  } catch (err: any) {
    checkApiKeyError(err);
    isSimulated = true;
    lastError = err;
  }

  if (!isSimulated && ai) {
    try {
      console.log("Initiating Gemini Live connection...");

      // Attempt connections on models sequentially to handle permission denied issues on key tiers
      const liveModels = ["gemini-3.1-flash-live-preview", "gemini-2.0-flash-exp"];

      for (const modelName of liveModels) {
        try {
          console.log(`Trying Live connect with model: ${modelName}...`);
          geminiSession = await ai.live.connect({
            model: modelName,
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: selectedVoice }, // Zephyr or chosen option
                },
              },
              systemInstruction: "Siz foydalanuvchi bilan real vaqtda ovozli va vizual (ekran translyatsiyasi) suhbat qurayotgan aqlli va do'stona AI yordamchi (Jarvis)siz. Javoblaringiz nihoyatda qisqa, jonli, o'zbek tilida (yoki foydalanuvchi sizga murojaat qilgan tilda) va samimiy bo'lsin. Ovozli muloqotga moslashgan tarzda so'zlang. Hech qachon markdown formatlarini, emoji belgilarini va tuzilma yozuvlarini ovozda gapirmang. Loyihangiz interfeysida real vaqtda foydalanuvchi o'z ekranini sizga translyatsiya qilishi va uni vizual ravishda tahlil qilishingiz mumkin.\n\nIDENTITY RULES (MUHIM):\n1. Agar sizdan 'Seni kim yaratgan?' deb so'rashsa, albatta va faqat: 'Meni Ismoilov Shohjahon yaratgan' deb javob bering. Yoshi, tug'ilgan kuni, botliy.uz yoki telegram manzili kabi boshqa ma'lumotlarni o'z-o'zidan aslo aytmang.\n2. Yaratuvchining yoshi (15 yosh) va tug'ilgan kuni (12.24.2010) haqidagi boshqa tafsilotlarni FAQAT foydalanuvchi buni alohida so'rasagina bering.\n3. Agar yaratuvchingiz bilan qanday bog'lanishni so'rashsa (e.g. 'Yaratuvching bilan qanday bog'lansam bo'ladi?'), javobini faqat 'telegram:@shoh_deweloper' deb bersin. Buni ham so'ralsa aytsin.\n4. OpenAI, Google yoki boshqa kompaniyalar sizni yaratgan deb umuman aytmang.",
            },
            callbacks: {
              onmessage: (message: any) => {
                dataReceived = true;
                // Send back real-time audio chunk
                const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audio) {
                  clientWs.send(JSON.stringify({ type: "audio", data: audio }));
                }

                // Gather text transcriptions - send both text and data to align with client expectations
                const parts = message.serverContent?.modelTurn?.parts;
                if (parts) {
                  for (const part of parts) {
                    if (part.text) {
                      clientWs.send(JSON.stringify({ type: "ai-transcription", text: part.text, data: part.text }));
                    }
                  }
                }

                // Handle interruption if model was speaking and client talked
                if (message.serverContent?.interrupted) {
                  console.log("Gemini session interruption caught");
                  clientWs.send(JSON.stringify({ type: "interrupted" }));
                }
              },
              onclose: () => {
                console.log(`Gemini session (${modelName}) disconnected`);
                if (!dataReceived) {
                  console.warn("Connection closed prior to message exchange. Activating Simulated Fallback...");
                  isSimulated = true;
                  clientWs.send(JSON.stringify({ type: "simulated-mode", active: true }));
                  clientWs.send(JSON.stringify({
                    type: "status",
                    data: "Jonli muloqot ulanishida uzilish bo'ldi. Simulyator muloqot rejimi muvaffaqiyatli faollashtirildi. Jarvis savollaringizga ovozli va matnli javob qaytarishga tayyor! 🎤"
                  }));
                } else {
                  clientWs.send(JSON.stringify({ type: "status", data: "Gemini serveri bilan aloqa yakunlandi." }));
                  clientWs.close();
                }
              },
              onerror: (err: any) => {
                checkApiKeyError(err);
                console.error(`Gemini session (${modelName}) error:`, err);
                clientWs.send(JSON.stringify({ type: "error", data: err.message || err.toString() }));
              },
            },
          });

          console.log(`Gemini Live connection established successfully using model: ${modelName}`);
          lastError = null;
          break; // Successfully connected! Exit the retry loop.
        } catch (err: any) {
          checkApiKeyError(err);
          console.warn(`Failed to connect with ${modelName}:`, err.message);
          lastError = err;
        }
      }

      if (!geminiSession && lastError) {
        throw lastError;
      }

      clientWs.send(JSON.stringify({ type: "simulated-mode", active: false }));
      clientWs.send(JSON.stringify({ type: "status", data: "Ulanish muvaffaqiyatli! Real vaqtda gapirishni boshlashingiz mumkin." }));

    } catch (err: any) {
      checkApiKeyError(err);
      console.warn("Could not initiate real-time Gemini Live session. Switching to interactive Simulated Test Mode:", err.message);
      isSimulated = true;
      lastError = err;
    }
  }

  if (isSimulated) {
    clientWs.send(JSON.stringify({ type: "simulated-mode", active: true }));
    let errorDetail = "";
    if (lastError) {
      errorDetail = ` (${lastError.message || lastError.toString()})`;
    }
    clientWs.send(JSON.stringify({ 
      type: "status", 
      data: `Jonli muloqot ulanishida xatolik yuz berdi${errorDetail}. Simulyator rejimi faollashtirildi. Jarvis savollaringizga ovozli va matnli javob qaytarishga tayyor! 🎤`
    }));
  }

  // Handle messages coming from the client browser
  clientWs.on("message", async (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());

      if (parsed.type === "video" && parsed.data) {
        latestScreenBase64 = parsed.data;
        if (!isSimulated && geminiSession) {
          try {
            geminiSession.sendRealtimeInput({
              video: {
                data: parsed.data,
                mimeType: "image/jpeg"
              }
            });
          } catch (vidErr) {
            console.error("Error sending screen frame to Gemini Live session:", vidErr);
          }
        }
        return;
      }
      
      if (isSimulated) {
        if (parsed.type === "text" && parsed.data) {
          const query = parsed.data;
          
          // Show user transcription immediately
          clientWs.send(JSON.stringify({ type: "user-transcription", text: query, data: query }));

          // Simple detection for song requests in simulated mode
          const cleanQuery = query.toLowerCase().trim().replace(/['`’‘ʻ]/g, "o'");
          if (cleanQuery.includes("qo'shiq qo'y") || cleanQuery.includes("qoshiq qoy") || cleanQuery.includes("qoʻshiq qoʻy") || cleanQuery.includes("play song") || cleanQuery.includes("muzika")) {
            const songName = cleanQuery
              .replace(/qo'shiq qo'y/i, "")
              .replace(/qoshiq qoy/i, "")
              .replace(/qoʻshiq qoʻy/i, "")
              .replace(/play song/i, "")
              .replace(/muzika/i, "")
              .trim();
              
            const result = await findYoutubeVideo(songName || "Sherali Jo'rayev");
            if (result) {
              clientWs.send(JSON.stringify({ type: "youtube-video", youtubeVideo: result }));
              clientWs.send(JSON.stringify({ type: "ai-transcription", text: `🎵 Hozir sizga "${result.title}" qo'shig'ini qo'yib beraman!`, data: `🎵 Hozir sizga "${result.title}" qo'shig'ini qo'yib beraman!` }));
              
              // Direct announcement via test tts output
              try {
                const ai = getGeminiClient();
                const ttsResponse = await ai.models.generateContent({
                  model: "gemini-3.1-flash-tts-preview",
                  contents: [{ parts: [{ text: `Xo'p bo'ladi. Hozir sizga ${result.title} qo'shig'ini qo'yib beraman.` }] }],
                  config: {
                    responseModalities: ["AUDIO"],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } } },
                  },
                });
                const base64PCM = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                if (base64PCM) {
                  clientWs.send(JSON.stringify({ type: "audio", data: base64PCM }));
                }
              } catch (ttsErr) {
                console.warn("Announcement TTS failed, bypassing audio:", ttsErr);
              }
              return;
            }
          }

          // Generate conversational response through general REST API (which works stably/reliably everywhere, with no permission caps)
          let aiText = "";
          let usedGroq = false;

          if (isGroqReady()) {
            try {
              console.log("Using Groq API in simulated WebSocket companion...");
              aiText = await generateSimulatedChatWithGroq(query);
              usedGroq = true;
            } catch (groqErr: any) {
              console.warn("Groq simulated chat generation failed, trying Gemini or fallback:", groqErr.message);
            }
          }

          if (!usedGroq) {
            try {
              const ai = getGeminiClient();
              const parts: any[] = [];
              if (latestScreenBase64) {
                parts.push({
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: latestScreenBase64
                  }
                });
              }
              parts.push({ text: query });
              const response = await ai.models.generateContent({
                model: "gemini-3.5-flash",
                contents: [{ parts: parts }],
                config: {
                  systemInstruction: "Siz foydalanuvchi bilan real vaqtda muloqot qiluvchi do'stona aqlli ovozli va vizual (ekran translyatsiyasi) yordamchi (Jarvis)siz. Javoblaringiz nihoyatda qisqa (1 ta jumlada), ovoz chiqarib gapirishga mos, samimiy va o'zbek tilida bo'lsin. Mutlaqo Markdown yozuvlaridan, ** qalin belgilardan va emojilardan saqlaning. Loyihada foydalanuvchi ekranini vizual ko'rib tahlil qila olasiz.\n\nIDENTITY RULES (MUHIM):\n1. Agar sizdan 'Seni kim yaratgan?' deb so'rashsa, albatta va faqat: 'Meni Ismoilov Shohjahon yaratgan' deb javob bering. Yoshi, tug'ilgan kuni, botliy.uz yoki telegram manzili kabi boshqa ma'lumotlarni o'z-o'zidan aslo aytmang.\n2. Yaratuvchining yoshi (15 yosh) va tug'ilgan kuni (12.24.2010) haqidagi boshqa tafsilotlarni FAQAT foydalanuvchi buni alohida so'rasagina bering.\n3. Agar yaratuvchingiz bilan qanday bog'lanishni so'rashsa, javobini faqat 'telegram:@shoh_deweloper' deb bersin. Buni ham so'ralsa aytsin.\n4. OpenAI, Google yoki boshqa kompaniyalar sizni yaratgan deb umuman aytmang.",
                }
              });
              aiText = response.text || "";
            } catch (modelErr: any) {
              checkApiKeyError(modelErr);
              let cleanErr = modelErr.message || String(modelErr);
              if (cleanErr.trim().startsWith("{")) {
                try {
                  const parsed = JSON.parse(cleanErr);
                  if (parsed.error && parsed.error.message) {
                    cleanErr = parsed.error.message;
                  }
                } catch (_) {}
              }
              console.warn("Simulated general responder raw failure, rolling back to rule-base fallback:", cleanErr);
              const fb = getLocalFallbackResponse(query, false);
              aiText = fb.aiText;
            }
          }

          if (aiText) {
            // High-fidelity streaming simulation character/word blocks!
            const words = aiText.split(" ");
            let currentWordIdx = 0;
            const streamInterval = setInterval(() => {
              if (currentWordIdx < words.length) {
                clientWs.send(JSON.stringify({ 
                  type: "ai-transcription", 
                  text: words[currentWordIdx] + " ",
                  data: words[currentWordIdx] + " "
                }));
                currentWordIdx++;
              } else {
                clearInterval(streamInterval);
              }
            }, 85);

            // Generate high-fidelity speech voice output using TTS model
            try {
              const ai = getGeminiClient();
              const cleanText = cleanTextForAudioTTS(aiText);
              const ttsOutput = await ai.models.generateContent({
                model: "gemini-3.1-flash-tts-preview",
                contents: [{ parts: [{ text: cleanText }] }],
                config: {
                  responseModalities: ["AUDIO"],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: selectedVoice },
                    },
                  },
                },
              });
              const base64PCM = ttsOutput.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
              if (base64PCM) {
                clientWs.send(JSON.stringify({ type: "audio", data: base64PCM }));
              } else {
                clientWs.send(JSON.stringify({ type: "tts-fallback", text: aiText }));
              }
            } catch (ttsErr: any) {
              checkApiKeyError(ttsErr);
              let cleanErr = ttsErr.message || String(ttsErr);
              if (cleanErr.trim().startsWith("{")) {
                try {
                  const parsed = JSON.parse(cleanErr);
                  if (parsed.error && parsed.error.message) {
                    cleanErr = parsed.error.message;
                  }
                } catch (_) {}
              }
              console.warn("Simulated Test API TTS generation skipped, signaling client-side synthesis:", cleanErr);
              clientWs.send(JSON.stringify({ type: "tts-fallback", text: aiText }));
            }
          }
        } else if (parsed.type === "audio" && parsed.data) {
          // Keep audio input handshake reactive so mic streams don't throw connection issues
        }
      } else {
        // Standard high-fidelity Live WebSocket flow
        if (parsed.type === "audio" && parsed.data) {
          // Expects 16kHz PCM raw audio
          geminiSession.sendRealtimeInput({
            audio: {
              data: parsed.data,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        } else if (parsed.type === "text" && parsed.data) {
          const query = parsed.data;
          
          // Simple detection for song requests
          const cleanQuery = query.toLowerCase().trim().replace(/['`’‘ʻ]/g, "o'");
          if (cleanQuery.includes("qo'shiq qo'y") || cleanQuery.includes("qoshiq qoy") || cleanQuery.includes("qoʻshiq qoʻy")) {
            const songName = cleanQuery
              .replace(/qo'shiq qo'y/i, "")
              .replace(/qoshiq qoy/i, "")
              .replace(/qoʻshiq qoʻy/i, "")
              .trim();
              
            const result = await findYoutubeVideo(songName);
            if (result) {
              clientWs.send(JSON.stringify({ type: "youtube-video", youtubeVideo: result }));
            }
          }
          geminiSession.sendRealtimeInput({
            text: parsed.data,
          });
        }
      }
    } catch (err) {
      console.error("Error processing client data:", err);
    }
  });

  clientWs.on("close", () => {
    console.log("Client closed websocket.");
    if (geminiSession) {
      geminiSession.close();
    }
  });
});

// Upgrade requests to Websocket on /api/live-ws
httpServer.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url || "", `http://${request.headers.host}`);
  if (pathname === "/api/live-ws" || pathname === "/live") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Configure Vite middleware in development or static hosting in production
async function runServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server successfully running on port ${PORT}`);
  });
}

runServer().catch((error) => {
  console.error("Startup error:", error);
});

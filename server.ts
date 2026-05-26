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
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required. Iltimos, Settings -> Secrets panelida api kalitni sozlang.");
    }
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
  res.json({ apiKeyMissing: !process.env.GEMINI_API_KEY });
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
  }

  return { aiText, userText };
}

// 1. Voice HTTP API Route
app.post("/api/chat-voice", async (req, res) => {
  const { audioBase64, messageText, history } = req.body;
  
  // Verify API Client presence first
  let ai: GoogleGenAI;
  try {
    ai = getGeminiClient();
  } catch (keyErr: any) {
    console.warn("Gemini client initialization failed (API Key missing), returning standalone response:", keyErr.message);
    const fallback = getLocalFallbackResponse(messageText, !!audioBase64);
    return res.json({
      userText: fallback.userText,
      aiText: fallback.aiText,
      audioBase64: "", // local TTS synthesizer will read aiText on the client
      ttsFallback: true,
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
        text: "User has provided this audio recording. 1. Transcribe exactly what the user said in Uzbek (or whatever language they spoke) as 'userTranscript'. 2. Generate a warm, friendly, short conversational voice response to it as 'aiResponse'. Keep responses in the same language as the user (defaulting to Uzbek). 3. If they asked to play a song/music/singer/band (e.g., 'qo'shiq qo'y', 'play song', 'muzika eshitamiz', 'Youtubedan qo'shiq'), extract the specific artist and song title as 'youtubeSearchQuery'. Otherwise leave 'youtubeSearchQuery' empty.",
      });
    } else if (messageText) {
      userParts.push({
        text: messageText,
      });
      userParts.push({
        text: "User has provided this message text. 1. Generate a warm, friendly, short conversational voice-ready response to it as 'aiResponse'. Leave 'userTranscript' empty. Default language is Uzbek unless they used another language. 2. If they asked to play a song/music/singer/band (e.g., 'qo'shiq qo'y', 'play song', 'muzika eshitamiz', 'Youtubedan qo'shiq'), extract the specific artist and song title as 'youtubeSearchQuery'. Otherwise leave 'youtubeSearchQuery' empty.",
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
      textResponse = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: contents,
        config: {
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
    } catch (genErr: any) {
      console.warn("Gemini content generation failed (probably quota exceeded/429), switching to beautiful local chat fallback:", genErr.message);
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
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [
          {
            parts: [
              {
                text: aiResponse,
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Kore" }, // warm, clear speaker
            },
          },
        },
      });

      const audioPart = ttsResponse.candidates?.[0]?.content?.parts?.[0];
      if (audioPart && audioPart.inlineData && audioPart.inlineData.data) {
        audioOutputBase64 = audioPart.inlineData.data;
      }
    } catch (ttsErr: any) {
      console.warn("TTS generation error (quota exceeded or network issue), falling back to client-side speech synthesis:", ttsErr.message);
      // Fail gracefully and set fallback flag.
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
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Matn taqdim etilmadi." });
    }

    try {
      const ai = getGeminiClient();
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Kore" },
            },
          },
        },
      });

      const base64Data = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Data) {
        return res.json({ audioBase64: base64Data, ttsFallback: false });
      }
    } catch (ttsErr: any) {
      console.warn("Direct TTS model call failed, falling back to local SpeechSynthesis:", ttsErr.message);
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

wss.on("connection", async (clientWs: WebSocket) => {
  console.log("WebSocket client joined. Preparing Gemini Live connection...");
  let geminiSession: any = null;

  try {
    const ai = getGeminiClient();
    geminiSession = await ai.live.connect({
      model: "gemini-3.1-flash-live-preview",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Zephyr" }, // Zephyr is high fidelity voice
          },
        },
        systemInstruction: "Siz foydalanuvchi bilan real vaqtda ovozli suhbat qurayotgan aqlli va do'stona AI yordamchisiz. Javoblaringiz nihoyatda qisqa, jonli, o'zbek tilida (yoki foydalanuvchi sizga murojaat qilgan tilda) va samimiy bo'lsin. Ovozli muloqotga moslashgan tarzda so'zlang. Hech qachon markdown formatlarini ovozda gapirmang.",
      },
      callbacks: {
        onmessage: (message: any) => {
          // Send back real-time audio chunk
          const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (audio) {
            clientWs.send(JSON.stringify({ type: "audio", data: audio }));
          }

          // Gather text transcriptions
          const parts = message.serverContent?.modelTurn?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.text) {
                clientWs.send(JSON.stringify({ type: "ai-transcription", data: part.text }));
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
          console.log("Gemini session disconnected");
          clientWs.send(JSON.stringify({ type: "status", data: "Gemini serveri bilan aloqa yakunlandi." }));
          clientWs.close();
        },
        onerror: (err: any) => {
          console.error("Gemini session error:", err);
          clientWs.send(JSON.stringify({ type: "error", data: err.message || err.toString() }));
        },
      },
    });

    clientWs.send(JSON.stringify({ type: "status", data: "Ulanish muvaffaqiyatli! Real vaqtda gapirishni boshlashingiz mumkin." }));

    // Handle messages coming from the client browser
    clientWs.on("message", (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        if (parsed.type === "audio" && parsed.data) {
          // Expects 16kHz PCM raw audio
          geminiSession.sendRealtimeInput({
            audio: {
              data: parsed.data,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        } else if (parsed.type === "text" && parsed.data) {
          geminiSession.sendRealtimeInput({
            text: parsed.data,
          });
        } else if (parsed.type === "interrupt") {
          // If the user spoke, we send an interrupt signal
          // geminiSession handles this internally when new audio streams in, but client signal helps clear queues
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

  } catch (err: any) {
    console.error("Failed to establish Gemini Live connection:", err);
    clientWs.send(JSON.stringify({ type: "error", data: "Gemini Live tizimiga ulanib bo'lmadi: " + err.message }));
    clientWs.close();
  }
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

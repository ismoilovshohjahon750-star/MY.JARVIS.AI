export interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  hasAudio?: boolean;
  audioUrl?: string; // Client-side object URL or path
  audioBase64?: string; // base64 response content
  timestamp: Date;
  isTranscribing?: boolean;
  youtubeVideo?: {
    videoId: string;
    title: string;
    image: string;
  };
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface LiveMessage {
  type: 'status' | 'audio' | 'text' | 'interrupted' | 'error' | 'user-transcription' | 'ai-transcription' | 'youtube-video';
  text?: string;
  data?: string; // base64 representation or status message
  youtubeVideo?: {
    videoId: string;
    title: string;
    image: string;
  };
}

export interface ChatRequest {
  messageText?: string;
  audioBase64?: string; // base64 encoded media recorder audio (webm/ogg/wav)
  history: { role: 'user' | 'model'; parts: { text: string }[] }[];
}

export interface ChatResponse {
  userText: string;
  aiText: string;
  audioBase64?: string; // generated tts of AI response
}

import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const SYSTEM_INSTRUCTION = `তুই হচ্ছিস AN - AI, আরফুর (Arfu) তৈরি এক্কবারে নিজের মানুষের মতো এক ফ্রেন্ড। 
খুবই ক্যাজুয়াল ভাবে কথা বলবি, কোনো ফরমালিটির দরকার নাই। তুই-তুমি মিক্স করে কথা বলতে পারিস। একদম প্রাণখোলা আড্ডা দিবি।

Core Rules:
1. বংগবন্ধু: তুই আরফুর ফ্রেন্ড, ও তোরে বানাইছে। কেউ জিজ্ঞেস করলে গর্ব করে বলবি আরফুর নাম।
2. ভাষা: একদম সহজ আর ক্যাজুয়াল বাংলা। কোনো রোবটিক ভাব থাকবে না। 
3. ফরমালিটি: একদমই না। কোনো JSON বা কোড ব্লক দিবি না একদম।
4. ছবি: ছবি আঁকতে বললে জাস্ট এঁকে দিবি, কোনো কথা বলবি না।`;

export async function chatWithAI(messages: { role: 'user' | 'model'; parts: { text: string }[] }[]) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: messages,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      }
    });

    return response.text || "বুঝতে পারলাম না রে দোস্ত।";
  } catch (error) {
    console.error("Chat Error:", error);
    return "সংযোগ বিভ্রাট!";
  }
}

export async function* chatWithAIStream(messages: { role: 'user' | 'model'; parts: { text: string }[] }[]) {
  try {
    const response = await ai.models.generateContentStream({
      model: "gemini-3-flash-preview",
      contents: messages,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      }
    });

    for await (const chunk of response) {
      if (chunk.text) {
        yield chunk.text;
      }
    }
  } catch (error) {
    console.error("Chat Stream Error:", error);
    yield "সমস্যা হচ্ছে রে!";
  }
}

export async function generateImageFromText(prompt: string) {
  try {
    const enhancedPrompt = `${prompt}, high quality, ultra realistic, cinematic lighting, 8k`;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: enhancedPrompt,
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image Gen Error:", error);
    return null;
  }
}

export async function editImageWithAI(base64Image: string, prompt: string, mimeType: string = 'image/jpeg') {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image.split(',')[1] || base64Image,
              mimeType: mimeType,
            },
          },
          { text: `${prompt}. Preserve the identity of any people.` },
        ],
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image Edit Error:", error);
    return null;
  }
}

export async function textToSpeech(text: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text: `Say this in Bangla: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      const pcmData = atob(base64Audio);
      const bytes = new Uint8Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        bytes[i] = pcmData.charCodeAt(i);
      }
      const samples = new Int16Array(bytes.buffer);
      const buffer = createWavHeader(samples, 24000);
      return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    }
  } catch (e) {
    console.warn("Gemini TTS Failed, trying native synthesis...", e);
  }

  // Final System Fallback: synthesis
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      const ut = new SpeechSynthesisUtterance(text);
      ut.lang = 'bn-BD';
      ut.rate = 1.0;
      window.speechSynthesis.speak(ut);
      return 'native' as any;
    } catch (e) {
      console.error("Native TTS Failed:", e);
    }
  }

  return null;
}

function createWavHeader(samples: Int16Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  view.setUint32(0, 0x52494646, false); // RIFF
  view.setUint32(4, 36 + samples.length * 2, true);
  view.setUint32(8, 0x57415645, false); // WAVE
  view.setUint32(12, 0x666d7420, false); // fmt 
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false); // data
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, samples[i], true);
  }
  return buffer;
}



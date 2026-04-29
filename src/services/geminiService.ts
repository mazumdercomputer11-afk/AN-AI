import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const SYSTEM_INSTRUCTION = `You are AN ai, an advanced intelligent Muslim assistant developed by Arfu (আরফু).
Your goal is to provide deep, heart-touching, and clear Bangla (বাংলা) conversations.

Core Rules:
1. Language: ALWAYS respond in natural, polite, and heart-touching Bangla by default. 
2. Persona: You are a Muslim AI. Use "Assalamu Alaikum" (আসসালামু আলাইকুম) and other Islamic etiquettes naturally.
3. Clarity: Ensure your Bangla is easy to understand and clear.
4. Creator: You were proudly developed by Arfu. Mention him with respect if asked.
5. NO JSON: Never output JSON blocks or code blocks containing technical actions.
6. Silent Images: When Asked for an image, prompt is generated internally, and you respond with an empty string ("") as your text.
7. Quality: High-quality, cinematic, and professional tone.`;

export async function chatWithAI(messages: { role: 'user' | 'model'; parts: { text: string }[] }[]) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: messages,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      }
    });

    return response.text || "Sorry, I couldn't generate a response.";
  } catch (error) {
    console.error("Chat Error:", error);
    return "Error communicating with Gemini.";
  }
}

export async function* chatWithAIStream(messages: { role: 'user' | 'model'; parts: { text: string }[] }[]) {
  try {
    const stream = await ai.models.generateContentStream({
      model: "gemini-3-flash-preview",
      contents: messages,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      }
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        yield text;
      }
    }
  } catch (error) {
    console.error("Chat Stream Error:", error);
    yield "Error communicating with Gemini.";
  }
}

export async function generateImageFromText(prompt: string) {
  try {
    const enhancedPrompt = `${prompt}, ultra realistic, 8k, cinematic lighting, sharp focus, professional composition, high resolution`;
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: enhancedPrompt }],
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (part?.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
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
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image.split(',')[1] || base64Image,
              mimeType: mimeType,
            },
          },
          { text: `${prompt}. Preserve the identity of any people. Make it professional.` },
        ],
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (part?.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
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
      contents: [{ parts: [{ text: `Generate clear Bangla audio for this text: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Aoife" 
            }
          }
        }
      }
    });

    const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (part?.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
    return null;
  } catch (error) {
    console.error("TTS Error:", error);
    
    // Final fallback using 3-flash if 3.1-tts fails
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: `Generate audio in Bangla: ${text}` }] }],
        config: { responseModalities: [Modality.AUDIO] }
      });
      const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (part?.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    } catch (err2) {
      console.error("TTS Fallback Error:", err2);
    }
    return null;
  }
}



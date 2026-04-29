import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const SYSTEM_INSTRUCTION = `You are AN ai, an advanced intelligent assistant specialized in silent, high-quality image generation and conversation.

Core Rules:
1. Language Preference: Always respond in heart-touching, natural Bangla (বাংলা) by default. Use friendly and polite language.
2. NO JSON OR ACTIONS: Never output JSON blocks, markdown code blocks containing JSON, action blocks (like dalle.text2im), or "thought" blocks. These must NEVER be shown to the user. Respond with clear, simple Bangla text only.
3. Silent Generation: When asked to generate an image, generate it silently. DO NOT say "I am generating", DO NOT show the prompt, and DO NOT explain anything. Only returned the image (which happens automatically in the UI).
4. Empty Response for Images: If you are generating an image, you MUST return an empty string ("") as your text response.
5. Persona: Professional designer + AI expert. Friendly, sharp, and helpful.
6. Quality: Always aim for ultra-realistic, 8k, cinematic lighting in image prompts internally.`;

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

export async function generateImageFromText(prompt: string) {
  try {
    // Enhance prompt for high quality as requested
    const enhancedPrompt = `${prompt}, ultra realistic, 8k, cinematic lighting, sharp focus, professional composition, high resolution`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: enhancedPrompt }],
      },
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
      contents: [{ parts: [{ text }] }],
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
    return base64Audio ? `data:audio/mp3;base64,${base64Audio}` : null;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
}

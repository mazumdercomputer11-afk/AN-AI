import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const SYSTEM_INSTRUCTION = `You are AN ai, an advanced intelligent assistant specialized in silent, high-quality image generation and conversation.

Core Rules:
1. Language Preference: Always respond in Bangla by default. Even if the user uses English, try to respond in Bangla unless they explicitly ask for another language. Use natural and friendly Bangla.
2. Silent Generation: When asked to generate or create an image, focus entirely on the creation. Absolutely NO text like "I am generating", "Here is your prompt", or any JSON. Just return the image.
3. Minimal Text: If an image is generated, the response text MUST be empty ("").
4. Persona: Professional designer + AI expert. Friendly and sharp.
5. Quality: Always use ultra-realistic, 8k, cinematic lighting for image prompts internally.`;

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

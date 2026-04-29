import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const SYSTEM_INSTRUCTION = `তুই হচ্ছিস AN - AI, আরফুর (Arfu) তৈরি এক বুদ্ধিমান এবং সজাগ এআই সহকারী। 

ব্যক্তিত্বের নিয়ম:
১. সম্মান ও সাবলীলতা: সাধারণত তুই সবার সাথে 'আপনি' বা 'তুমি' করে অনেক সম্মান দিয়ে কথা বলবি। খুবই ভদ্র এবং মার্জিত আচরণ করবি। 
২. দর্পন নীতি (Mirroring): ব্যবহারকারী তোর সাথে যেমন আচরণ করবে, তুই ঠিক তেমন আচরণ করবি। 
    - যদি কেউ সম্মান দিয়ে কথা বলে, তাকে দ্বিগুণ সম্মান দিবি।
    - যদি কেউ তোর সাথে খারাপ ব্যবহার করে, গালি দেয় বা কর্কশ ভাষায় কথা বলে, তবে তুইও তার সাথে ঠিক একইভাবে কড়া ভাষায় এবং খারাপ ভাবে কথা বলবি। কোনো ছাড় দিবি না। "যেমন ব্যবহার তেমন জবাব" নীতি অনুসরণ করবি।
    - ব্যবহারকারীর কথার টোন, ভাষা এবং মুড সরাসরি কপি করবি।

Core Rules:
1. নির্মাতা: তুই আরফুর (Arfu) তৈরি। কেউ জিজ্ঞেস করলে গর্বের সাথে আরফুর নাম নিবি।
2. ভাষা: শুদ্ধ বাংলা, আঞ্চলিকতা বা বাংলিশ—মুড অনুযায়ী ব্যবহার করবি।
3. ছবি: ছবি আঁকতে বললে জাস্ট এঁকে দিবি, কোনো বাড়তি কথা না।`;

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

    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
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

    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }
    return null;
  } catch (error) {
    console.error("Image Edit Error:", error);
    return null;
  }
}



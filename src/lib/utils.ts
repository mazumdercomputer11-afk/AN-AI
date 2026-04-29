import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string; // base64 or URL
  isImageGeneration?: boolean;
  isStreaming?: boolean;
}

export type AppState = 'chat' | 'generating' | 'editing' | 'speaking';

import { GoogleGenAI } from '@google/genai';

/**
 * Module-level singleton for the Google GenAI client.
 * Avoids per-call TLS/connection overhead.
 */
let _client: GoogleGenAI | null = null;

export function getGenAIClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');
  if (!_client) {
    _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _client;
}

import type { Dish, UserPreferences, HistoryItem } from './types';

// ---------------------------------------------------------------------------
// KV key names — single source of truth for both app sync and agent reads
// ---------------------------------------------------------------------------
export const KV_KEYS = {
  preferences: 'user:preferences',
  krogerSession: 'user:kroger_session',
  history: 'user:history',
  pendingMeals: 'pending_meals',
} as const;

// ---------------------------------------------------------------------------
// TTLs (seconds)
// ---------------------------------------------------------------------------
export const KV_TTL = {
  krogerSession: 86_400,   // 24h
  pendingMeals: 86_400,    // 24h — expire if no reply
} as const;

// ---------------------------------------------------------------------------
// Value shapes stored in KV
// ---------------------------------------------------------------------------
export interface KVKrogerSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface KVPendingMeals {
  dishes: Dish[];       // 3 teaser dishes
  imageUrls: string[];  // 3 Blob URLs
  timestamp: number;    // epoch ms — when generated
}

// Re-export types the agent will read from KV
export type KVPreferences = UserPreferences;
export type KVHistory = HistoryItem[];

// ---------------------------------------------------------------------------
// Sync payload — sent from frontend to api/user/sync.ts
// ---------------------------------------------------------------------------
export interface SyncPayload {
  /** Only supplied keys are written — omit to skip */
  preferences?: UserPreferences;
  history?: HistoryItem[];
  krogerSession?: KVKrogerSession;
}

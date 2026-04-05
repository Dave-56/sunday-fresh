import type { Dish, UserPreferences, HistoryItem } from '../types';

// ---------------------------------------------------------------------------
// KV key names — single source of truth for both app sync and agent reads
// ---------------------------------------------------------------------------
export const KV_KEYS = {
  preferences: 'user:preferences',
  krogerSession: 'user:kroger_session',
  krogerSessionPointer: 'user:kroger_session_id',
  history: 'user:history',
  pendingMeals: 'pending_meals',
  oauthState: 'oauth:state',
  selectionLock: 'selection_lock',
} as const;

// ---------------------------------------------------------------------------
// TTLs (seconds)
// ---------------------------------------------------------------------------
export const KV_TTL = {
  krogerSession: 2_592_000, // 30 days — aligned with refresh token lifetime
  pendingMeals: 86_400,     // 24h — expire if no reply
  oauthState: 600,           // 10 min — OAuth should complete quickly
  selectionLock: 300,        // 5 min — prevents duplicate cart adds from webhook retries
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
  messageIds?: number[]; // Telegram message IDs for cleanup on regenerate
}

export interface KVOAuthState {
  source: 'telegram' | 'web';
  selection: number | null;
  dish: Dish | null;
  createdAt: number;
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

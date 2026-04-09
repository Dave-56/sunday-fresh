import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  selectCandidateWithRerank,
  type SelectionResult,
} from '../../_lib/candidateSelector.js';
import type { ProductCandidate, StructuredIngredientIntent } from '../../_lib/matchScorer.js';
import { classifyIngredientClass } from '../../_lib/ingredientSignals.js';

interface RerankRequestBody {
  ingredient: StructuredIngredientIntent;
  candidates: ProductCandidate[];
}

const DEBUG_RERANK_LOGS = (() => {
  const raw = String(process.env.RERANK_DEBUG_LOGS || '').toLowerCase();
  return raw === '1' || raw === 'true';
})();

function createRequestId(existing?: string | string[]): string {
  if (typeof existing === 'string' && existing.trim()) return existing.trim();
  const rand = Math.random().toString(36).slice(2, 8);
  return `rerank_${Date.now()}_${rand}`;
}

function logRerankDebug(event: string, payload: Record<string, unknown>): void {
  if (!DEBUG_RERANK_LOGS) return;
  const logPayload = {
    scope: 'kroger_rerank_endpoint',
    event,
    ts: new Date().toISOString(),
    ...payload,
  };
  console.log(`[kroger-rerank-endpoint] ${JSON.stringify(logPayload)}`);
}

function isStructuredIngredientIntent(value: unknown): value is StructuredIngredientIntent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.display === 'string' &&
    typeof v.item === 'string' &&
    Array.isArray(v.searchTerms) &&
    v.searchTerms.every((s) => typeof s === 'string') &&
    typeof v.qty === 'number' &&
    (v.qtyMode === 'container' || v.qtyMode === 'unit-count' || v.qtyMode === 'single-pack')
  );
}

function isProductCandidate(value: unknown): value is ProductCandidate {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.upc === 'string' &&
    typeof v.description === 'string' &&
    typeof v.brand === 'string'
  );
}

function isRerankBody(value: unknown): value is RerankRequestBody {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    isStructuredIngredientIntent(v.ingredient) &&
    Array.isArray(v.candidates) &&
    v.candidates.every(isProductCandidate)
  );
}

function parseEnabledEnv(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function parseTimeoutMs(value: string | undefined): number {
  const raw = Number.parseInt(value || '', 10);
  if (!Number.isFinite(raw) || raw <= 0) return 7000;
  return Math.min(Math.max(raw, 1000), 15000);
}

function parseScoreThreshold(value: string | undefined, fallback: number): number {
  const raw = Number.parseInt(value || '', 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(raw, 0), 200);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = createRequestId(req.headers['x-request-id']);

  try {
    const body = req.body;
    if (!isRerankBody(body)) {
      logRerankDebug('request.invalid_body', {
        requestId,
        bodyType: typeof body,
      });
      return res.status(400).json({ error: 'Invalid rerank payload' });
    }

    const llmEnabled = parseEnabledEnv(process.env.ENABLE_LLM_RERANK_WEB);
    const llmTimeoutMs = parseTimeoutMs(process.env.LLM_RERANK_TIMEOUT_MS);
    const llmMinScore = parseScoreThreshold(process.env.LLM_RERANK_MIN_SCORE, 40);
    const llmMaxScore = parseScoreThreshold(process.env.LLM_RERANK_MAX_SCORE, 80);
    logRerankDebug('request.received', {
      requestId,
      llmEnabled,
      llmTimeoutMs,
      llmMinScore,
      llmMaxScore,
      ingredientClass: classifyIngredientClass(body.ingredient),
      ingredient: body.ingredient,
      candidateCount: body.candidates.length,
      candidates: body.candidates,
    });
    const result: SelectionResult = await selectCandidateWithRerank(
      body.ingredient,
      body.candidates,
      {
        enableLlm: llmEnabled,
        llmTimeoutMs,
        llmMinScore,
        llmMaxScore,
        requestId,
      }
    );
    logRerankDebug('request.completed', {
      requestId,
      result,
    });

    return res.json(result);
  } catch (err: any) {
    logRerankDebug('request.failed', {
      requestId,
      error: err?.message || String(err),
    });
    return res.status(500).json({ error: err?.message || 'Rerank failed' });
  }
}

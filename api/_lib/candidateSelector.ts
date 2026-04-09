import { GoogleGenAI, Type } from '@google/genai';
import {
  preFilterCandidates,
  rankCandidatesForSelection,
  shoppingToParsed,
  type ProductCandidate,
  type StructuredIngredientIntent,
  type RankedCandidateWithQuantity,
} from './matchScorer.js';

// Reuse a single GoogleGenAI client to avoid per-call TLS/connection overhead.
let _genaiClient: GoogleGenAI | null = null;
function getGenAIClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');
  if (!_genaiClient) {
    _genaiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _genaiClient;
}
import {
  classifyIngredientClass,
  bucketProductCandidate,
  CANDIDATE_BUCKET_ORDER,
  type IngredientClass,
  type CandidateBucket,
} from './ingredientSignals.js';

export type RerankDecision = 'select' | 'needs_review' | 'no_match';
export type DecisionSource = 'llm' | 'fallback' | 'deterministic';

export interface SelectionMetadata {
  decisionSource: DecisionSource;
  latencyMs: number;
  guardrailOverride?: string;
}

export interface SelectionResult {
  decision: RerankDecision;
  selectedUpc: string | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  metadata: SelectionMetadata;
}

interface LlmRerankResponse {
  decision: RerankDecision;
  selectedUpc?: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

function buildDiversifiedLlmPool(
  ranked: RankedCandidateWithQuantity[],
  limit: number
): RankedCandidateWithQuantity[] {
  if (ranked.length <= limit) return ranked.slice();
  const order: CandidateBucket[] = CANDIDATE_BUCKET_ORDER;
  const byBucket = new Map<CandidateBucket, RankedCandidateWithQuantity[]>();
  for (const bucket of order) byBucket.set(bucket, []);
  for (const candidate of ranked) {
    byBucket.get(bucketProductCandidate(candidate))!.push(candidate);
  }

  const selected: RankedCandidateWithQuantity[] = [];
  const selectedUpcs = new Set<string>();
  while (selected.length < limit) {
    let progressed = false;
    for (const bucket of order) {
      const queue = byBucket.get(bucket)!;
      while (queue.length > 0) {
        const next = queue.shift()!;
        if (selectedUpcs.has(next.upc)) continue;
        selected.push(next);
        selectedUpcs.add(next.upc);
        progressed = true;
        break;
      }
      if (selected.length >= limit) break;
    }
    if (!progressed) break;
  }

  if (selected.length < limit) {
    for (const candidate of ranked) {
      if (selectedUpcs.has(candidate.upc)) continue;
      selected.push(candidate);
      selectedUpcs.add(candidate.upc);
      if (selected.length >= limit) break;
    }
  }

  return selected;
}

function ensurePinnedCandidateInPool(
  pool: RankedCandidateWithQuantity[],
  pinned: RankedCandidateWithQuantity | null
): RankedCandidateWithQuantity[] {
  if (!pinned) return pool;
  if (pool.some((c) => c.upc === pinned.upc)) return pool;
  if (pool.length === 0) return [pinned];
  const next = pool.slice();
  next[next.length - 1] = pinned;
  return next;
}

const DEBUG_RERANK_LOGS = (() => {
  const raw = String(process.env.RERANK_DEBUG_LOGS || '').toLowerCase();
  return raw === '1' || raw === 'true';
})();

function toSerializableError(err: unknown): {
  name?: string;
  message?: string;
  cause?: string;
  stack?: string;
} {
  if (!err || typeof err !== 'object') {
    return { message: String(err) };
  }
  const e = err as {
    name?: unknown;
    message?: unknown;
    cause?: unknown;
    stack?: unknown;
  };
  return {
    name: typeof e.name === 'string' ? e.name : undefined,
    message: typeof e.message === 'string' ? e.message : undefined,
    cause:
      typeof e.cause === 'string'
        ? e.cause
        : typeof (e.cause as any)?.message === 'string'
          ? (e.cause as any).message
          : undefined,
    stack:
      typeof e.stack === 'string'
        ? e.stack.split('\n').slice(0, 6).join('\n')
        : undefined,
  };
}

function logRerankDebug(
  event: string,
  payload: Record<string, unknown>
): void {
  if (!DEBUG_RERANK_LOGS) return;
  const logPayload = {
    scope: 'kroger_rerank',
    event,
    ts: new Date().toISOString(),
    ...payload,
  };
  console.log(`[kroger-rerank] ${JSON.stringify(logPayload)}`);
}

function finalizeDecision(
  candidate: RankedCandidateWithQuantity | null,
  source: DecisionSource,
  startedAt: number,
  reasonOverride?: string,
  confidenceOverride?: SelectionResult['confidence'],
  guardrailOverride?: string
): SelectionResult {
  if (!candidate) {
    return {
      decision: 'no_match',
      selectedUpc: null,
      confidence: confidenceOverride ?? 'low',
      reason: reasonOverride ?? 'No viable candidate found.',
      metadata: {
        decisionSource: source,
        latencyMs: Date.now() - startedAt,
        ...(guardrailOverride ? { guardrailOverride } : {}),
      },
    };
  }

  // Guardrail: weak text match should never auto-select.
  if (candidate.matchType === 'weak') {
    return {
      decision: 'no_match',
      selectedUpc: null,
      confidence: 'low',
      reason: reasonOverride ?? 'Top candidate was too weak to trust.',
      metadata: {
        decisionSource: source,
        latencyMs: Date.now() - startedAt,
        ...(guardrailOverride ? { guardrailOverride } : {}),
      },
    };
  }

  // Guardrail: low quantity confidence requires manual review.
  if (candidate.qtyDecision.confidence === 'low') {
    return {
      decision: 'needs_review',
      selectedUpc: candidate.upc,
      confidence: 'low',
      reason:
        reasonOverride ??
        `Quantity mismatch: ${candidate.qtyDecision.rationale}`,
      metadata: {
        decisionSource: source,
        latencyMs: Date.now() - startedAt,
        guardrailOverride: guardrailOverride ?? 'quantity_low_confidence',
      },
    };
  }

  // Guardrail: substitute matches require review.
  if (candidate.matchType === 'substitute') {
    return {
      decision: 'needs_review',
      selectedUpc: candidate.upc,
      confidence: confidenceOverride ?? 'medium',
      reason:
        reasonOverride ??
        'Closest product is a substitute and needs confirmation.',
      metadata: {
        decisionSource: source,
        latencyMs: Date.now() - startedAt,
        guardrailOverride: guardrailOverride ?? 'substitute_match',
      },
    };
  }

  return {
    decision: 'select',
    selectedUpc: candidate.upc,
    confidence: confidenceOverride ?? 'high',
    reason: reasonOverride ?? 'Best exact/close candidate selected.',
    metadata: {
      decisionSource: source,
      latencyMs: Date.now() - startedAt,
      ...(guardrailOverride ? { guardrailOverride } : {}),
    },
  };
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeLlmDecision(
  llm: LlmRerankResponse | null
): LlmRerankResponse | null {
  if (!llm) return null;
  if (!llm.decision || !llm.confidence || !llm.reason) return null;
  if (!['select', 'needs_review', 'no_match'].includes(llm.decision)) return null;
  if (!['high', 'medium', 'low'].includes(llm.confidence)) return null;
  return llm;
}

async function runLlmRerank(
  intent: StructuredIngredientIntent,
  candidates: ProductCandidate[],
  timeoutMs: number,
  requestId?: string,
  opts?: {
    ingredientClass?: IngredientClass;
    attempt?: number;
  }
): Promise<LlmRerankResponse> {
  const ai = getGenAIClient();
  const candidateBlock = candidates.map((c, idx) => ({
    rank: idx + 1,
    upc: c.upc,
    description: c.description,
    brand: c.brand,
    size: c.size || '',
    soldBy: c.soldBy || '',
    countPerPack: typeof c.countPerPack === 'number' ? c.countPerPack : null,
  }));

  const prompt = [
    'You are selecting the single best grocery product candidate for a recipe ingredient.',
    'Favor exact ingredient form and culinary intent.',
    'Reject beverages/snacks/ready meals unless explicitly requested.',
    'Respect forbidden forms strongly.',
    'If uncertain, return no_match.',
    '',
    `Ingredient intent: ${JSON.stringify(intent)}`,
    `Candidates: ${JSON.stringify(candidateBlock)}`,
    '',
    'Return strict JSON only.',
  ].join('\n');

  const model = process.env.LLM_RERANK_MODEL || 'gemini-3-flash-preview';
  logRerankDebug('llm.request', {
    requestId,
    model,
    timeoutMs,
    ingredientClass: opts?.ingredientClass,
    attempt: opts?.attempt ?? 1,
    ingredient: intent,
    candidates: candidateBlock,
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('llm_timeout')), timeoutMs)
  );

  const response = await Promise.race([
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            decision: {
              type: Type.STRING,
              enum: ['select', 'needs_review', 'no_match'],
            },
            selectedUpc: { type: Type.STRING },
            confidence: {
              type: Type.STRING,
              enum: ['high', 'medium', 'low'],
            },
            reason: { type: Type.STRING },
          },
          required: ['decision', 'confidence', 'reason'],
        },
      },
    }),
    timeoutPromise,
  ]);

  const text = (response as any)?.text;
  logRerankDebug('llm.raw_response', {
    requestId,
    attempt: opts?.attempt ?? 1,
    text: text || '',
  });
  const parsed = normalizeLlmDecision(safeJsonParse<LlmRerankResponse>(text || ''));
  if (!parsed) {
    logRerankDebug('llm.invalid_json', {
      requestId,
      attempt: opts?.attempt ?? 1,
      rawText: text || '',
    });
    throw new Error('invalid_llm_json');
  }
  logRerankDebug('llm.parsed_response', {
    requestId,
    attempt: opts?.attempt ?? 1,
    parsed,
  });
  return parsed;
}

export async function selectCandidateWithRerank(
  intent: StructuredIngredientIntent,
  candidates: ProductCandidate[],
  options?: {
    enableLlm?: boolean;
    llmTimeoutMs?: number;
    llmMinScore?: number;
    llmMaxScore?: number;
    requestId?: string;
  }
): Promise<SelectionResult> {
  const startedAt = Date.now();
  const requestId = options?.requestId;
  const ingredientClass = classifyIngredientClass(intent);
  const filtered = preFilterCandidates(candidates, intent);
  const parsed = shoppingToParsed(intent);
  const ranked = rankCandidatesForSelection(filtered, parsed);
  const deterministicBest = ranked[0] || null;
  const logResult = (
    stage: string,
    result: SelectionResult,
    extra?: Record<string, unknown>
  ): SelectionResult => {
    logRerankDebug('selector.result', {
      requestId,
      stage,
      elapsedMs: Date.now() - startedAt,
      result,
      ...extra,
    });
    return result;
  };
  logRerankDebug('selector.start', {
    requestId,
    enableLlm: Boolean(options?.enableLlm),
    llmTimeoutMs: options?.llmTimeoutMs ?? 7000,
    ingredientClass,
    totalCandidates: candidates.length,
    filteredCandidates: filtered.length,
    rankedPreview: ranked.slice(0, 10).map((r, idx) => ({
      rank: idx + 1,
      upc: r.upc,
      description: r.description,
      brand: r.brand,
      matchType: r.matchType,
      score: r.score,
      qtyConfidence: r.qtyDecision.confidence,
      qtyRationale: r.qtyDecision.rationale,
    })),
  });

  if (!deterministicBest) {
    return logResult('no_candidates', finalizeDecision(
      null,
      'deterministic',
      startedAt,
      'No candidates remained after filtering.',
      'low'
    ));
  }

  if (!options?.enableLlm) {
    return logResult('llm_disabled', finalizeDecision(
      deterministicBest,
      'deterministic',
      startedAt,
      'LLM reranker disabled.',
      deterministicBest.matchType === 'exact' ? 'high' : 'medium'
    ));
  }

  const llmMinScore = Number.isFinite(options?.llmMinScore) ? Number(options!.llmMinScore) : 40;
  const llmMaxScore = Number.isFinite(options?.llmMaxScore) ? Number(options!.llmMaxScore) : 80;
  const inAmbiguousBand = deterministicBest.score >= llmMinScore && deterministicBest.score <= llmMaxScore;
  const needsHumanOrModelReview =
    deterministicBest.matchType === 'substitute' || deterministicBest.qtyDecision.confidence !== 'high';

  if (!inAmbiguousBand && !needsHumanOrModelReview) {
    return logResult('llm_skipped_clear_deterministic', finalizeDecision(
      deterministicBest,
      'deterministic',
      startedAt,
      `Deterministic score ${deterministicBest.score} outside LLM band (${llmMinScore}-${llmMaxScore}).`,
      deterministicBest.matchType === 'exact' ? 'high' : 'medium'
    ), {
      llmMinScore,
      llmMaxScore,
      deterministicScore: deterministicBest.score,
    });
  }

  try {
    // Keep the LLM payload focused on the strongest deterministic candidates.
    // This reduces token/latency pressure while preserving quality.
    const llmPool = buildDiversifiedLlmPool(
      ranked,
      Math.min(10, ranked.length)
    );
    logRerankDebug('selector.llm_pool', {
      requestId,
      ingredientClass,
      poolSize: llmPool.length,
      pool: llmPool.map((c, idx) => ({
        rank: idx + 1,
        upc: c.upc,
        description: c.description,
        brand: c.brand,
        bucket: bucketProductCandidate(c),
        matchType: c.matchType,
        score: c.score,
      })),
    });
    const configuredTimeout = options.llmTimeoutMs ?? 7000;
    const attemptStartedAt = Date.now();
    const attemptPlan = [
      { attempt: 1, poolLimit: 10, budgetRatio: 0.28 },
      { attempt: 2, poolLimit: 6, budgetRatio: 0.43 },
      { attempt: 3, poolLimit: 3, budgetRatio: null as number | null },
    ];
    let llm: LlmRerankResponse | null = null;
    let lastErr: unknown = null;

    for (let i = 0; i < attemptPlan.length; i++) {
      const attemptConfig = attemptPlan[i];
      const elapsed = Date.now() - attemptStartedAt;
      const remainingBudgetMs = configuredTimeout - elapsed;
      if (remainingBudgetMs < 500) break;

      const plannedTimeout = attemptConfig.budgetRatio === null
        ? remainingBudgetMs
        : Math.floor(configuredTimeout * attemptConfig.budgetRatio);
      const timeoutMs = Math.max(500, Math.min(remainingBudgetMs, plannedTimeout));
      const rawPool = buildDiversifiedLlmPool(
        ranked,
        Math.min(attemptConfig.poolLimit, ranked.length)
      );
      const attemptPool = ensurePinnedCandidateInPool(rawPool, deterministicBest);
      const pinnedDeterministic = attemptPool.some((c) => c.upc === deterministicBest.upc);

      logRerankDebug('selector.llm_attempt', {
        requestId,
        ingredientClass,
        attempt: attemptConfig.attempt,
        timeoutMs,
        remainingBudgetMs,
        poolSize: attemptPool.length,
        pinnedDeterministic,
      });

      try {
        llm = await runLlmRerank(
          intent,
          attemptPool,
          timeoutMs,
          requestId,
          { ingredientClass, attempt: attemptConfig.attempt }
        );
        break;
      } catch (err: any) {
        lastErr = err;
        const timedOut = err?.message === 'llm_timeout';
        if (!timedOut) throw err;

        const elapsedAfterErr = Date.now() - attemptStartedAt;
        const remainingAfterErrMs = configuredTimeout - elapsedAfterErr;
        const hasNextAttempt = i < attemptPlan.length - 1 && remainingAfterErrMs >= 500;
        logRerankDebug('llm.retry', {
          requestId,
          ingredientClass,
          reason: 'timeout',
          attempt: attemptConfig.attempt,
          nextAttempt: hasNextAttempt ? attemptPlan[i + 1].attempt : null,
          remainingBudgetMs: remainingAfterErrMs,
          note: 'Promise.race timeout does not cancel in-flight model calls.',
        });
        if (!hasNextAttempt) break;
      }
    }

    if (!llm) {
      if (lastErr) throw lastErr;
      throw new Error('llm_timeout');
    }

    if (llm.decision === 'no_match') {
      return logResult('llm_no_match', {
        decision: 'no_match',
        selectedUpc: null,
        confidence: llm.confidence,
        reason: llm.reason,
        metadata: {
          decisionSource: 'llm',
          latencyMs: Date.now() - startedAt,
        },
      });
    }

    if (!llm.selectedUpc) {
      return logResult('llm_missing_selected_upc', finalizeDecision(
        deterministicBest,
        'fallback',
        startedAt,
        'LLM decision missing UPC; used deterministic fallback.',
        'medium',
        'missing_selected_upc'
      ));
    }

    const chosen = ranked.find((r) => r.upc === llm.selectedUpc) || null;
    if (!chosen) {
      return logResult('llm_selected_upc_not_found', finalizeDecision(
        deterministicBest,
        'fallback',
        startedAt,
        'LLM selected UPC not in candidate set; used deterministic fallback.',
        'medium',
        'selected_upc_not_found'
      ));
    }

    if (llm.decision === 'needs_review') {
      return logResult('llm_needs_review', finalizeDecision(
        chosen,
        'llm',
        startedAt,
        llm.reason,
        llm.confidence
      ));
    }

    return logResult(
      'llm_select',
      finalizeDecision(chosen, 'llm', startedAt, llm.reason, llm.confidence)
    );
  } catch (err: any) {
    const timedOut = err?.message === 'llm_timeout';
    logRerankDebug('llm.error', {
      requestId,
      ingredientClass,
      timedOut,
      error: toSerializableError(err),
    });
    return logResult('llm_error_fallback', finalizeDecision(
      deterministicBest,
      'fallback',
      startedAt,
      timedOut
        ? 'LLM rerank timed out; used deterministic fallback.'
        : 'LLM rerank failed; used deterministic fallback.',
      deterministicBest.matchType === 'exact' ? 'high' : 'medium',
      timedOut ? 'llm_timeout' : 'llm_error'
    ));
  }
}

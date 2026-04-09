import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ShoppingCart, Check, Loader2, LogIn, ChevronRight, X, Package, AlertTriangle } from 'lucide-react';
import {
  isKrogerAuthenticated,
  getLoginUrl,
  searchLocations,
  searchProducts,
  rerankProductSelection,
  addToCart,
  CartItem,
  type ProductRerankIngredientIntent,
  type ProductRerankResponse,
  type KrogerProduct,
} from '../lib/kroger';
import { Dish, ShoppingIngredient, EssentialItem, isStructuredIngredients, type ReconciliationResult } from '../types';
import { getAllItems as collectItems, getSearchTermsFromIntent } from '../lib/ingredients';
import { parseIngredient, shoppingToParsed, rankCandidatesForSelection, preFilterCandidates, type ProductCandidate, type ScoredCandidate } from '../lib/matchScorer';
import { getSearchTerms } from '../lib/ingredients';

interface KrogerCheckoutProps {
  dish: Dish | null;
  essentials: EssentialItem[];
  savedZipCode: string;
  onBack: () => void;
}

type Step = 'auth' | 'mapping' | 'confirm' | 'done';

interface UnmappedItem {
  name: string;
  searchTerm: string;
  attemptedTerms: string[];
  isEssential: boolean;
  mustSourceManually?: boolean;
  reason?: string;
}

interface MatchedCartItem extends CartItem {
  matchSource: 'store' | 'catalog';
  matchType: ScoredCandidate['matchType'];
  recipeQty: number;
  qtyMode: 'container' | 'unit-count' | 'single-pack';
  qtyConfidence: 'high' | 'medium' | 'low';
  qtyRationale: string;
  isEssential: boolean;
  decisionSource?: 'llm' | 'fallback' | 'deterministic';
  decisionReason?: string;
  guardrailOverride?: string;
}

interface MappingRunSummary {
  id: string;
  createdAt: number;
  dishName: string;
  totalItems: number;
  mappedItems: number;
  unmappedItems: number;
  lowQtyConfidence: number;
  specialtyLikely: number;
  decisionSources: {
    deterministic: number;
    llm: number;
    fallback: number;
    unknown: number;
  };
  guardrailOverrides: Record<string, number>;
  topReasons: Array<{ reason: string; count: number }>;
}

const ENABLE_LLM_RERANK_WEB =
  String((import.meta as any).env?.VITE_ENABLE_LLM_RERANK_WEB || '').toLowerCase() === 'true' ||
  String((import.meta as any).env?.VITE_ENABLE_LLM_RERANK_WEB || '') === '1';
const SHOW_RERANK_DEBUG =
  String((import.meta as any).env?.VITE_SHOW_RERANK_DEBUG || '').toLowerCase() === 'true' ||
  String((import.meta as any).env?.VITE_SHOW_RERANK_DEBUG || '') === '1';
const ENABLE_LLM_FOR_ESSENTIALS =
  String((import.meta as any).env?.VITE_ENABLE_LLM_RERANK_ESSENTIALS || '').toLowerCase() === 'true' ||
  String((import.meta as any).env?.VITE_ENABLE_LLM_RERANK_ESSENTIALS || '') === '1';

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number.parseInt(String((import.meta as any).env?.[name] || ''), 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(raw, min), max);
}

const SEARCH_LIMIT_PRIMARY = envInt('VITE_KROGER_SEARCH_LIMIT', 12, 5, 24);
const SEARCH_LIMIT_BROAD = envInt('VITE_KROGER_SEARCH_BROAD_LIMIT', 20, 8, 36);
const RERANK_MIN_SCORE_FOR_LLM = envInt('VITE_RERANK_MIN_SCORE_FOR_LLM', 60, 0, 200);
const MAX_LLM_RERANK_CALLS_PER_RUN = envInt('VITE_LLM_RERANK_MAX_CALLS_PER_RUN', 6, 0, 30);
const LLM_SCORE_MIN = envInt('VITE_LLM_RERANK_MIN_SCORE', 40, 0, 200);
const LLM_SCORE_MAX = envInt('VITE_LLM_RERANK_MAX_SCORE', 80, 0, 200);

function upsertCandidate(list: ProductCandidate[], product: KrogerProduct): void {
  if (!product.upc) return;
  const existing = list.find((c) => c.upc === product.upc);
  const next = toProductCandidate(product);
  if (!existing) {
    list.push(next);
    return;
  }
  existing.size = existing.size || next.size;
  existing.soldBy = existing.soldBy || next.soldBy;
  existing.countPerPack = existing.countPerPack || next.countPerPack;
}

function shouldBroadenBeforeLlm(ranked: ReturnType<typeof rankCandidatesForSelection>): boolean {
  if (ranked.length === 0) return true;
  const top = ranked[0];
  if (top.matchType === 'weak') return true;
  return top.score < RERANK_MIN_SCORE_FOR_LLM;
}

function buildRerankCacheKey(
  intent: ProductRerankIngredientIntent,
  candidates: ProductCandidate[]
): string {
  const upcs = candidates
    .slice(0, 12)
    .map((c) => c.upc)
    .sort()
    .join('|');
  return `${intent.item.toLowerCase()}::${intent.qtyMode}:${intent.qty}::${upcs}`;
}

function getConversationalReason(item: MatchedCartItem): string {
  const qtyOff = item.qtyConfidence === 'low' && item.recipeQty !== item.quantity;
  const isTimeout = item.guardrailOverride === 'llm_timeout';
  const isError = item.guardrailOverride === 'llm_error' || item.guardrailOverride === 'client_rerank_error';
  const isSub = item.guardrailOverride === 'substitute_match';

  if (isTimeout || isError) {
    if (qtyOff) return `Best guess — couldn't verify. Recipe needs ${item.recipeQty}, got ${item.quantity}.`;
    return "Best guess — couldn't verify this pick.";
  }
  if (qtyOff) {
    return `Right product, wrong amount — recipe needs ${item.recipeQty} but cart has ${item.quantity}.`;
  }
  if (isSub) {
    return "Close but not exact — check it's the right variant.";
  }
  if (item.decisionSource === 'llm') {
    return 'AI wasn\'t fully confident in this pick.';
  }
  return 'Quick sanity check needed.';
}

function isSpecialtyIngredientText(value: string): boolean {
  const text = value.toLowerCase();
  const terms = [
    'lemongrass', 'galangal', 'gochujang', 'gochugaru', 'doubanjiang',
    'fish sauce', 'shaoxing', 'mirin', 'nori', 'miso', 'udon', 'soba',
    'thai basil', 'bok choy', 'rice noodle',
  ];
  return terms.some((t) => text.includes(t));
}

function shouldTryLlmForTopCandidate(
  top: ReturnType<typeof rankCandidatesForSelection>[number] | undefined
): boolean {
  if (!top) return false;
  if (top.matchType === 'weak') return false;

  const inAmbiguousBand = top.score >= LLM_SCORE_MIN && top.score <= LLM_SCORE_MAX;
  const needsReviewSignal = top.matchType === 'substitute' || top.qtyDecision.confidence !== 'high';

  return inAmbiguousBand || needsReviewSignal;
}

function buildMappingRunSummary(
  dishName: string,
  totalItems: number,
  mapped: MatchedCartItem[],
  unmapped: UnmappedItem[],
  specialtyLikely: number
): MappingRunSummary {
  const decisionSources = {
    deterministic: 0,
    llm: 0,
    fallback: 0,
    unknown: 0,
  };
  const guardrailOverrides: Record<string, number> = {};
  const reasonCounts: Record<string, number> = {};
  let lowQtyConfidence = 0;

  for (const item of mapped) {
    const source = item.decisionSource || 'unknown';
    if (source === 'deterministic') decisionSources.deterministic += 1;
    else if (source === 'llm') decisionSources.llm += 1;
    else if (source === 'fallback') decisionSources.fallback += 1;
    else decisionSources.unknown += 1;

    if (item.qtyConfidence === 'low') lowQtyConfidence += 1;

    if (item.guardrailOverride) {
      guardrailOverrides[item.guardrailOverride] = (guardrailOverrides[item.guardrailOverride] || 0) + 1;
    }

    if (item.decisionReason) {
      reasonCounts[item.decisionReason] = (reasonCounts[item.decisionReason] || 0) + 1;
    }
  }

  for (const item of unmapped) {
    if (item.reason) {
      reasonCounts[item.reason] = (reasonCounts[item.reason] || 0) + 1;
    }
  }

  const topReasons = Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return {
    id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    dishName,
    totalItems,
    mappedItems: mapped.length,
    unmappedItems: unmapped.length,
    lowQtyConfidence,
    specialtyLikely,
    decisionSources,
    guardrailOverrides,
    topReasons,
  };
}

function persistMappingRun(summary: MappingRunSummary): void {
  try {
    const key = 'kroger_checkout_runs';
    const raw = localStorage.getItem(key);
    const prev = raw ? JSON.parse(raw) : [];
    const next = [summary, ...(Array.isArray(prev) ? prev : [])].slice(0, 5);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Best-effort only.
  }
}

function toProductCandidate(product: KrogerProduct): ProductCandidate {
  const firstItem: any = Array.isArray(product.items) ? product.items[0] : undefined;
  const size =
    (typeof firstItem?.size === 'string' && firstItem.size) ||
    (typeof firstItem?.itemInformation?.size === 'string' && firstItem.itemInformation.size) ||
    undefined;
  const soldBy =
    (typeof firstItem?.soldBy === 'string' && firstItem.soldBy) ||
    (typeof firstItem?.itemInformation?.soldBy === 'string' && firstItem.itemInformation.soldBy) ||
    undefined;
  const rawCount =
    (typeof firstItem?.count === 'number' && firstItem.count) ||
    (typeof firstItem?.itemInformation?.count === 'number' && firstItem.itemInformation.count) ||
    undefined;

  return {
    upc: product.upc || '',
    description: product.description || '',
    brand: product.brand || '',
    size,
    soldBy,
    countPerPack: rawCount,
  };
}

function reconcile(
  matched: MatchedCartItem[],
  unmapped: UnmappedItem[]
): ReconciliationResult {
  const exact = matched.filter(m => m.matchType === 'exact' || m.matchType === 'close');
  const substituted = matched.filter(m => m.matchType === 'substitute');
  const missing = unmapped.map(u => ({
    ingredient: u.name, searchTerm: u.searchTerm, attemptedTerms: u.attemptedTerms,
    krogerProduct: null, krogerBrand: null, upc: null, isEssential: u.isEssential,
  }));

  // Detect duplicate UPCs
  const upcMap = new Map<string, string[]>();
  for (const m of matched) {
    const list = upcMap.get(m.upc) || [];
    list.push(m.name);
    upcMap.set(m.upc, list);
  }
  const duplicates = [...upcMap.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([upc, ingredients]) => ({ upc, ingredients }));

  const total = matched.length + unmapped.length;
  const confidence = total > 0 ? exact.length / total : 0;

  return {
    required: total,
    matched: exact.map(m => ({
      ingredient: m.name, searchTerm: '', attemptedTerms: [],
      krogerProduct: m.description, krogerBrand: m.brand,
      upc: m.upc, isEssential: m.isEssential, matchType: m.matchType,
      recipeQty: m.recipeQty, cartQty: m.quantity, qtyMode: m.qtyMode,
      qtyConfidence: m.qtyConfidence, qtyRationale: m.qtyRationale,
    })),
    substituted: substituted.map(m => ({
      ingredient: m.name, searchTerm: '', attemptedTerms: [],
      krogerProduct: m.description, krogerBrand: m.brand,
      upc: m.upc, isEssential: m.isEssential, matchType: m.matchType,
      recipeQty: m.recipeQty, cartQty: m.quantity, qtyMode: m.qtyMode,
      qtyConfidence: m.qtyConfidence, qtyRationale: m.qtyRationale,
    })),
    missing,
    duplicates,
    confidence,
  };
}

export default function KrogerCheckout({ dish, essentials, savedZipCode, onBack }: KrogerCheckoutProps) {
  const [step, setStep] = useState<Step>(
    !isKrogerAuthenticated() ? 'auth' : 'mapping'
  );
  const [cartItems, setCartItems] = useState<MatchedCartItem[]>([]);
  const [unmappedItems, setUnmappedItems] = useState<UnmappedItem[]>([]);
  const [approvedSubstituteUpcs, setApprovedSubstituteUpcs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mappingProgress, setMappingProgress] = useState({ current: 0, total: 0 });
  const [addingToCart, setAddingToCart] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [runSummary, setRunSummary] = useState<MappingRunSummary | null>(null);
  const [showRunSummary, setShowRunSummary] = useState(false);

  // Auto-start mapping when authenticated
  useEffect(() => {
    if (step === 'mapping' && !loading && cartItems.length === 0) {
      startMapping();
    }
  }, []);

  // Collect all grocery items to map
  const getItems = () => collectItems(dish, essentials);

  const handleLogin = async () => {
    setLoading(true);
    try {
      const url = await getLoginUrl();
      window.location.href = url;
    } catch (err: any) {
      setError('Failed to start Kroger login');
      setLoading(false);
    }
  };

  const startMapping = async () => {
    setLoading(true);
    setError('');

    // Look up nearest store from saved zip
    let locationId: string | undefined;
    if (savedZipCode.length === 5) {
      try {
        const locs = await searchLocations(savedZipCode);
        if (locs.length > 0) {
          locationId = locs[0].locationId;
        }
      } catch {
        // Continue without location — will search catalog
      }
    }

    await mapProducts(locationId);
  };

  const mapProducts = async (locationId?: string) => {
    const items = getItems();
    const specialtyLikely = items.filter((item) => isSpecialtyIngredientText(item)).length;

    // Guard: block if recipe ingredients haven't loaded yet
    if (dish && (!dish.ingredients || dish.ingredients.length === 0)) {
      setError('Recipe ingredients are still loading. Please wait and try again.');
      setLoading(false);
      return;
    }

    setMappingProgress({ current: 0, total: items.length });
    setRunSummary(null);
    setShowRunSummary(false);
    const mapped: MatchedCartItem[] = [];
    const unmapped: UnmappedItem[] = [];
    const recipeIngredients = dish?.ingredients ?? [];
    const recipeItemCount = recipeIngredients.length;
    const hasStructuredRecipe = isStructuredIngredients(recipeIngredients);
    let llmCallsUsed = 0;
    const rerankCache = new Map<string, ProductRerankResponse>();

    for (let i = 0; i < items.length; i++) {
      const isEssential = i >= recipeItemCount;

      // Structured path for recipe ingredients, legacy path for essentials
      let terms: string[];
      let parsed: ReturnType<typeof parseIngredient>;
      let si: ShoppingIngredient | null = null;
      let llmIntent: ProductRerankIngredientIntent | null = null;

      if (!isEssential && hasStructuredRecipe) {
        si = recipeIngredients[i];
        terms = getSearchTermsFromIntent(si);
        parsed = shoppingToParsed(si);
        llmIntent = si;
      } else {
        const essentialIdx = i - recipeItemCount;
        const essentialCategory = isEssential ? essentials[essentialIdx]?.category : undefined;
        terms = getSearchTerms(items[i], essentialCategory);
        parsed = parseIngredient(items[i]);
        llmIntent = {
          display: items[i],
          item: parsed.coreItem || items[i],
          searchTerms: terms.length > 0 ? terms : [parsed.coreItem || items[i]],
          qty: parsed.recipeQty,
          qtyMode: parsed.qtyMode,
        };
      }

      setMappingProgress({ current: i + 1, total: items.length });

      if (terms.length === 0) continue;

      let found = false;

      try {
        // Collect candidates from all search terms.
        const candidates: ProductCandidate[] = [];
        let searchSource: 'store' | 'catalog' = 'store';
        let noMatchReason: string | undefined;

        for (const term of terms) {
          const products = await searchProducts(term, locationId, SEARCH_LIMIT_PRIMARY);
          for (const p of products) {
            upsertCandidate(candidates, p);
          }
          await new Promise(r => setTimeout(r, 200));
        }

        // Broaden retrieval if local-store pool is empty or too weak before LLM rerank.
        let filtered = si ? preFilterCandidates(candidates, si) : candidates;
        let ranked = filtered.length > 0
          ? rankCandidatesForSelection(filtered, parsed)
          : [];

        if (locationId && shouldBroadenBeforeLlm(ranked)) {
          searchSource = 'catalog';
          const broadenTerms = Array.from(new Set([parsed.coreItem, ...terms]))
            .filter(Boolean)
            .slice(0, 3);
          for (const term of broadenTerms) {
            const products = await searchProducts(term, undefined, SEARCH_LIMIT_BROAD);
            for (const p of products) {
              upsertCandidate(candidates, p);
            }
            await new Promise((r) => setTimeout(r, 200));
          }
          filtered = si ? preFilterCandidates(candidates, si) : candidates;
          ranked = filtered.length > 0
            ? rankCandidatesForSelection(filtered, parsed)
            : [];
        }

        if (filtered.length > 0) {
          let best = ranked[0];
          let forceNeedsReview = false;
          let decisionSource: MatchedCartItem['decisionSource'] = 'deterministic';
          let decisionReason: string | undefined;
          let guardrailOverride: string | undefined;

          const topRanked = ranked[0];
          const shouldTryLlm =
            !!llmIntent &&
            ENABLE_LLM_RERANK_WEB &&
            ranked.length > 0 &&
            shouldTryLlmForTopCandidate(topRanked) &&
            (!isEssential || ENABLE_LLM_FOR_ESSENTIALS);

          if (shouldTryLlm) {
            try {
              let rerank: ProductRerankResponse | null = null;
              if (llmCallsUsed >= MAX_LLM_RERANK_CALLS_PER_RUN) {
                decisionSource = 'fallback';
                decisionReason = 'LLM run budget reached for this checkout; deterministic selection used.';
                guardrailOverride = 'llm_budget_cap';
              } else {
                const cacheKey = buildRerankCacheKey(llmIntent!, filtered);
                const cached = rerankCache.get(cacheKey);
                if (cached) {
                  rerank = cached;
                } else {
                  rerank = await rerankProductSelection(llmIntent!, filtered);
                  rerankCache.set(cacheKey, rerank);
                  llmCallsUsed += 1;
                }
              }

              if (rerank) {
                decisionSource = rerank.metadata.decisionSource;
                decisionReason = rerank.reason;
                guardrailOverride = rerank.metadata.guardrailOverride;

                if (rerank.decision === 'no_match') {
                  best = undefined;
                  noMatchReason = rerank.reason;
                } else if (rerank.selectedUpc) {
                  const selected = ranked.find((r) => r.upc === rerank.selectedUpc);
                  if (selected) best = selected;
                }

                if (rerank.decision === 'needs_review') {
                  forceNeedsReview = true;
                }
              }
            } catch (err: any) {
              decisionSource = 'fallback';
              decisionReason = err?.message || 'LLM rerank unavailable; deterministic selection used.';
              guardrailOverride = 'client_rerank_error';
            }
          }

          if (best && best.matchType !== 'weak') {
            const qtyDecision = isEssential
              ? { cartQty: 1, confidence: 'high' as const, rationale: 'essential quantity comes from vault settings' }
              : best.qtyDecision;
            // Quantity-first guard: low-confidence recipe quantities are
            // treated as substitutes so users must explicitly approve them.
            const effectiveMatchType: ScoredCandidate['matchType'] =
              !isEssential && (qtyDecision.confidence === 'low' || forceNeedsReview)
                ? 'substitute'
                : best.matchType;
            const qty = qtyDecision.cartQty;
            mapped.push({
              name: items[i],
              upc: best.upc,
              quantity: qty,
              description: best.description,
              brand: best.brand,
              matchSource: searchSource,
              matchType: effectiveMatchType,
              recipeQty: parsed.recipeQty,
              qtyMode: parsed.qtyMode,
              qtyConfidence: qtyDecision.confidence,
              qtyRationale: qtyDecision.rationale,
              isEssential,
              decisionSource,
              decisionReason,
              guardrailOverride,
            });
            found = true;
          }
        }

        if (!found) {
          unmapped.push({
            name: items[i],
            searchTerm: terms[0],
            attemptedTerms: terms,
            isEssential,
            mustSourceManually: !isEssential,
            reason: noMatchReason,
          });
        }
      } catch {
        unmapped.push({
          name: items[i],
          searchTerm: terms[0],
          attemptedTerms: terms,
          isEssential,
          mustSourceManually: !isEssential,
        });
      }

      // Rate limit between ingredients
      if (i < items.length - 1) await new Promise(r => setTimeout(r, 200));
    }

    setCartItems(mapped);
    setUnmappedItems(unmapped);
    setApprovedSubstituteUpcs([]);
    const summary = buildMappingRunSummary(
      dish?.name || 'Unknown dish',
      items.length,
      mapped,
      unmapped,
      specialtyLikely
    );
    setRunSummary(summary);
    persistMappingRun(summary);
    setLoading(false);
    setStep('confirm');
  };

  const handleRemoveItem = (idx: number) => {
    setCartItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleAddToCart = async () => {
    // Re-check auth right before submitting — session may have been
    // cleared (e.g. browser data wipe) since the component mounted
    if (!isKrogerAuthenticated()) {
      setError('');
      setStep('auth');
      return;
    }

    setAddingToCart(true);
    setError('');
    try {
      const items = cartItems
        .filter(ci => ci.matchType !== 'substitute' || approvedSubstituteUpcs.includes(ci.upc))
        .map(ci => ({ upc: ci.upc, quantity: ci.quantity }));
      if (items.length === 0) {
        setError('No items selected to add. Include at least one match or approved substitute.');
        setAddingToCart(false);
        return;
      }
      await addToCart(items);
      setSubmittedCount(items.length);
      setStep('done');
    } catch (err: any) {
      // Catch expired/invalid session from server-side rejection
      if (err.message?.includes('Not authenticated') || err.message?.includes('401')) {
        setStep('auth');
      } else {
        setError(err.message);
      }
    } finally {
      setAddingToCart(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fdfaf6] text-black font-sans p-6 max-w-md mx-auto">
      <header className="flex justify-between items-center mb-8">
        <button onClick={onBack} className="p-2 -ml-2 hover:bg-black/5 rounded-full transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-[10px] font-bold uppercase tracking-widest opacity-40">QFC</h2>
        <div className="w-10" />
      </header>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* ---- STEP 1: AUTH ---- */}
        {step === 'auth' && (
          <motion.div
            key="auth"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center text-center pt-12"
          >
            <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-6">
              <LogIn size={28} className="text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-3">Sign in to QFC</h2>
            <p className="text-sm opacity-60 leading-relaxed mb-8 max-w-xs">
              One-tap setup. We'll add ingredients straight to your cart.
            </p>
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full py-4 bg-[#0068B5] text-white rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 active:scale-95 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
              Continue with QFC
            </button>
          </motion.div>
        )}

        {/* ---- STEP 2: MAPPING (loading) ---- */}
        {step === 'mapping' && loading && (
          <motion.div
            key="mapping"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center text-center pt-16"
          >
            <Loader2 size={32} className="animate-spin opacity-20 mb-6" />
            <h2 className="text-xl font-bold tracking-tight mb-2">Matching items</h2>
            <p className="text-sm opacity-50 mb-6">
              Finding products near you
            </p>
            <div className="w-full bg-black/5 rounded-full h-2 overflow-hidden">
              <motion.div
                className="h-full bg-black rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${(mappingProgress.current / Math.max(mappingProgress.total, 1)) * 100}%` }}
                transition={{ ease: "easeOut" }}
              />
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-30 mt-3">
              {mappingProgress.current} / {mappingProgress.total} items
            </p>
          </motion.div>
        )}

        {/* ---- STEP 3: CONFIRM CART ---- */}
        {step === 'confirm' && (() => {
          const recon = reconcile(cartItems, unmappedItems);
          const exactItems = cartItems.filter(m => m.matchType === 'exact' || m.matchType === 'close');
          const subItems = cartItems.filter(m => m.matchType === 'substitute');
          const approvedSubstitutes = subItems.filter((i) => approvedSubstituteUpcs.includes(i.upc));
          const selectedForCart = cartItems.filter((i) => i.matchType !== 'substitute' || approvedSubstituteUpcs.includes(i.upc));
          const substitutesRecipe = subItems.filter((i) => !i.isEssential).length;
          const substitutesEssentials = subItems.filter((i) => i.isEssential).length;
          const recipeUnmapped = unmappedItems.filter((i) => !i.isEssential).length;
          const recipeMatched = cartItems.filter((i) => !i.isEssential && i.matchType !== 'substitute').length;
          const recipeTotal = recipeMatched + substitutesRecipe + recipeUnmapped;
          const essentialsTotal = [...cartItems, ...unmappedItems].filter((i) => i.isEssential).length;
          const essentialsMatched = cartItems.filter((i) => i.isEssential && i.matchType !== 'substitute').length;

          return (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <div className="mb-6">
              <h2 className="text-2xl font-bold tracking-tight mb-2">Match review</h2>
              <p className="text-[11px] opacity-40">Review and confirm, then checkout on QFC.</p>
              {SHOW_RERANK_DEBUG && (
                <p className="text-[10px] opacity-50 mt-1">Debug mode: detailed matching traces are visible.</p>
              )}
              {runSummary && (
                <div className="mt-3 rounded-lg border border-black/10 bg-white px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Run Diagnostics</p>
                    <button
                      onClick={() => setShowRunSummary((prev) => !prev)}
                      className="text-[10px] font-bold uppercase tracking-widest opacity-60 hover:opacity-100 transition-opacity"
                    >
                      {showRunSummary ? 'Hide details' : 'Show details'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="rounded-md bg-black/[0.03] px-2 py-1.5">
                      <p className="text-[9px] uppercase tracking-widest opacity-40">LLM picks</p>
                      <p className="text-sm font-semibold">{runSummary.decisionSources.llm}</p>
                    </div>
                    <div className="rounded-md bg-black/[0.03] px-2 py-1.5">
                      <p className="text-[9px] uppercase tracking-widest opacity-40">Fallback picks</p>
                      <p className="text-sm font-semibold">{runSummary.decisionSources.fallback}</p>
                    </div>
                    <div className="rounded-md bg-black/[0.03] px-2 py-1.5">
                      <p className="text-[9px] uppercase tracking-widest opacity-40">Low qty confidence</p>
                      <p className="text-sm font-semibold">{runSummary.lowQtyConfidence}</p>
                    </div>
                    <div className="rounded-md bg-black/[0.03] px-2 py-1.5">
                      <p className="text-[9px] uppercase tracking-widest opacity-40">Unmapped</p>
                      <p className="text-sm font-semibold">{runSummary.unmappedItems}</p>
                    </div>
                  </div>
                  {runSummary.specialtyLikely > 0 && (
                    <p className="text-[10px] text-amber-700/90 mt-2">
                      Likely specialty items: {runSummary.specialtyLikely} may require manual add.
                    </p>
                  )}
                  {showRunSummary && (
                    <div className="mt-2 pt-2 border-t border-black/5 space-y-1">
                      {Object.entries(runSummary.guardrailOverrides).length > 0 && (
                        <p className="text-[10px] opacity-70">
                          Guardrails: {Object.entries(runSummary.guardrailOverrides).map(([key, count]) => `${key} (${count})`).join(', ')}
                        </p>
                      )}
                      {runSummary.topReasons.length > 0 && (
                        <p className="text-[10px] opacity-70">
                          Top reasons: {runSummary.topReasons.map((entry) => `${entry.reason} (${entry.count})`).join(' • ')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className={`grid gap-2 mt-2 ${essentialsTotal > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <div className="rounded-lg border border-black/10 bg-white px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Recipe</p>
                  <p className="text-sm font-semibold">{recipeMatched} / {recipeTotal} matched</p>
                </div>
                {essentialsTotal > 0 && (
                  <div className="rounded-lg border border-black/10 bg-white px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Essentials</p>
                    <p className="text-sm font-semibold">{essentialsMatched} / {essentialsTotal} matched</p>
                  </div>
                )}
              </div>
              {subItems.length > 0 && (
                <p className="text-[11px] text-amber-700/90 mt-2">
                  Substitutes: {subItems.length} ({approvedSubstitutes.length} approved)
                  {substitutesRecipe > 0 ? ` (recipe ${substitutesRecipe})` : ''}
                  {substitutesEssentials > 0 ? ` (essentials ${substitutesEssentials})` : ''}
                </p>
              )}
              {recon.duplicates.length > 0 && (
                <p className="text-[11px] text-amber-700/80 mt-1">
                  {recon.duplicates.length} duplicate product{recon.duplicates.length > 1 ? 's' : ''} detected — review below.
                </p>
              )}
            </div>

            {/* ---- Exact matches ---- */}
            {exactItems.length > 0 && (
              <div className="mb-4">
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-30 mb-2">
                  Matched ({exactItems.length})
                </p>
                <div className="space-y-2">
                  {exactItems.map((item, i) => {
                    const globalIdx = cartItems.indexOf(item);
                    const qtyMismatch = item.qtyConfidence === 'low';
                    return (
                      <div key={`e-${i}`} className="flex items-center gap-3 p-3 bg-white border border-black/5 rounded-xl">
                        <Package size={16} className="opacity-20 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-snug break-words">
                            {item.description}
                            {item.quantity > 1 && <span className="opacity-40"> x{item.quantity}</span>}
                          </p>
                          <p className="text-[10px] opacity-40 leading-snug break-words">{item.brand} — from: {item.name}</p>
                          {item.isEssential && (
                            <p className="text-[10px] opacity-50 mt-0.5">(Essential Vault item)</p>
                          )}
                          {SHOW_RERANK_DEBUG && item.decisionSource && (
                            <p className="text-[10px] opacity-50 mt-0.5">
                              Decision: {item.decisionSource}
                              {item.guardrailOverride ? ` (${item.guardrailOverride})` : ''}
                              {item.decisionReason ? ` — ${item.decisionReason}` : ''}
                            </p>
                          )}
                          {qtyMismatch && (
                            <p className="text-[10px] text-amber-700 mt-0.5">
                              Recipe needs {item.recipeQty}, cart has {item.quantity}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemoveItem(globalIdx)}
                          className="p-1 hover:bg-black/5 rounded-full transition-colors flex-shrink-0"
                        >
                          <X size={14} className="opacity-30" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ---- Substitutes ---- */}
            {subItems.length > 0 && (
              <div className="mb-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 mb-2">
                  Check these ({subItems.length})
                </p>
                <div className="space-y-2">
                  {subItems.map((item, i) => {
                    const globalIdx = cartItems.indexOf(item);
                    const qtyMismatch = item.qtyConfidence === 'low';
                    const isApproved = approvedSubstituteUpcs.includes(item.upc);
                    return (
                      <div key={`s-${i}`} className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                        <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-amber-800/70 leading-snug break-words">
                            Recipe: {item.name}
                          </p>
                          <p className="text-sm font-medium leading-snug break-words mt-0.5">
                            {item.description}
                            {item.quantity > 1 && <span className="opacity-40"> x{item.quantity}</span>}
                          </p>
                          <p className="text-[10px] text-amber-700/90 mt-1">
                            {getConversationalReason(item)}
                          </p>
                          {SHOW_RERANK_DEBUG && item.decisionSource && (
                            <p className="text-[10px] text-amber-700/60 mt-0.5">
                              {item.decisionSource}
                              {item.guardrailOverride ? ` · ${item.guardrailOverride}` : ''}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <button
                            onClick={() =>
                              setApprovedSubstituteUpcs((prev) =>
                                isApproved ? prev.filter((u) => u !== item.upc) : [...prev, item.upc]
                              )
                            }
                            className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-colors ${
                              isApproved
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-200 text-amber-900'
                            }`}
                          >
                            {isApproved ? 'Included' : 'Include'}
                          </button>
                          <button
                            onClick={() => handleRemoveItem(globalIdx)}
                            className="p-1 hover:bg-black/5 rounded-full transition-colors flex-shrink-0"
                            aria-label="Remove substitute"
                          >
                            <X size={14} className="opacity-30" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ---- Not found ---- */}
            {unmappedItems.length > 0 && (
              <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-[10px] font-bold uppercase tracking-widest text-red-700 mb-2">
                  Not at this store ({unmappedItems.length})
                </p>
                <div className="space-y-1">
                  {unmappedItems.filter(u => !u.isEssential).map((item, i) => (
                    <p key={`r-${i}`} className="text-sm text-red-800">
                      {item.name} <span className="text-[10px] font-semibold">(must source manually)</span>
                    </p>
                  ))}
                  {unmappedItems.filter(u => u.isEssential).map((item, i) => (
                    <p key={`ue-${i}`} className="text-sm text-red-800 opacity-70">{item.name} <span className="text-[10px]">(essential)</span></p>
                  ))}
                </div>
              </div>
            )}

            {cartItems.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm opacity-40 mb-4">
                  {unmappedItems.length > 0
                    ? `None of the ${unmappedItems.length} items could be found at this store.`
                    : 'No items to add.'}
                </p>
                <button
                  onClick={onBack}
                  className="px-6 py-3 border border-black/10 rounded-xl text-sm font-bold active:scale-95 transition-all"
                >
                  Go back
                </button>
              </div>
            ) : (
              <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#fdfaf6] border-t border-black/5 max-w-md mx-auto z-50">
                <button
                  onClick={handleAddToCart}
                  disabled={addingToCart}
                  className="w-full py-4 bg-[#0068B5] text-white rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 active:scale-95 transition-all disabled:opacity-50"
                >
                  {addingToCart ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ShoppingCart size={16} />
                  )}
                  Add {selectedForCart.length} to QFC
                </button>
              </div>
            )}
          </motion.div>
          );
        })()}

        {/* ---- STEP 4: DONE ---- */}
        {step === 'done' && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center text-center pt-16"
          >
            <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-6">
              <Check size={28} className="text-green-600" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-3">{submittedCount || cartItems.length} items added</h2>
            <p className="text-sm opacity-60 leading-relaxed mb-8 max-w-xs">
              Finish checkout on QFC whenever you're ready.
            </p>
            <div className="flex flex-col gap-3 w-full">
              <button
                onClick={() => {
                  window.open('https://www.qfc.com/cart', '_blank');
                  onBack();
                }}
                className="w-full py-4 bg-[#0068B5] text-white rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
              >
                Finish on QFC
                <ChevronRight size={16} />
              </button>
              <button
                onClick={onBack}
                className="w-full py-4 border border-black/10 rounded-xl font-bold text-sm tracking-tight active:scale-95 transition-all"
              >
                Done
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="h-24" />
    </div>
  );
}

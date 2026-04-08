import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ShoppingCart, Check, Loader2, LogIn, ChevronRight, X, Package, AlertTriangle } from 'lucide-react';
import {
  isKrogerAuthenticated,
  getLoginUrl,
  searchLocations,
  searchProducts,
  addToCart,
  CartItem,
  type KrogerProduct,
} from '../lib/kroger';
import { Dish, ShoppingIngredient, EssentialItem, isStructuredIngredients, type ReconciliationResult } from '../types';
import { getAllItems as collectItems, getSearchTermsFromIntent } from '../lib/ingredients';
import { parseIngredient, shoppingToParsed, rankCandidates, preFilterCandidates, resolveCartQuantity, type ProductCandidate, type ScoredCandidate } from '../lib/matchScorer';
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
}

interface MatchedCartItem extends CartItem {
  matchSource: 'store' | 'catalog';
  matchType: ScoredCandidate['matchType'];
  recipeQty: number;
  qtyMode: 'container' | 'unit-count' | 'single-pack';
  qtyConfidence: 'high' | 'medium' | 'low';
  qtyRationale: string;
  isEssential: boolean;
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
    upc: product.upc,
    description: product.description,
    brand: product.brand,
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

    // Guard: block if recipe ingredients haven't loaded yet
    if (dish && (!dish.ingredients || dish.ingredients.length === 0)) {
      setError('Recipe ingredients are still loading. Please wait and try again.');
      setLoading(false);
      return;
    }

    setMappingProgress({ current: 0, total: items.length });
    const mapped: MatchedCartItem[] = [];
    const unmapped: UnmappedItem[] = [];
    const recipeIngredients = dish?.ingredients ?? [];
    const recipeItemCount = recipeIngredients.length;
    const hasStructuredRecipe = isStructuredIngredients(recipeIngredients);

    for (let i = 0; i < items.length; i++) {
      const isEssential = i >= recipeItemCount;

      // Structured path for recipe ingredients, legacy path for essentials
      let terms: string[];
      let parsed: ReturnType<typeof parseIngredient>;
      let si: ShoppingIngredient | null = null;

      if (!isEssential && hasStructuredRecipe) {
        si = recipeIngredients[i];
        terms = getSearchTermsFromIntent(si);
        parsed = shoppingToParsed(si);
      } else {
        terms = getSearchTerms(items[i]);
        parsed = parseIngredient(items[i]);
      }

      setMappingProgress({ current: i + 1, total: items.length });

      if (terms.length === 0) continue;

      let found = false;

      try {
        // Collect candidates from all search terms (limit=5 each)
        const candidates: ProductCandidate[] = [];
        let searchSource: 'store' | 'catalog' = 'store';

        for (const term of terms) {
          const products = await searchProducts(term, locationId, 5);
          for (const p of products) {
            if (!p.upc) continue;
            const existing = candidates.find(c => c.upc === p.upc);
            const next = toProductCandidate(p);
            if (!existing) {
              candidates.push(next);
            } else {
              existing.size = existing.size || next.size;
              existing.soldBy = existing.soldBy || next.soldBy;
              existing.countPerPack = existing.countPerPack || next.countPerPack;
            }
          }
          await new Promise(r => setTimeout(r, 200));
        }

        // Fallback: primary term without locationId
        if (candidates.length === 0 && locationId) {
          searchSource = 'catalog';
          const products = await searchProducts(terms[0], undefined, 5);
          for (const p of products) {
            if (!p.upc) continue;
            const existing = candidates.find(c => c.upc === p.upc);
            const next = toProductCandidate(p);
            if (!existing) {
              candidates.push(next);
            } else {
              existing.size = existing.size || next.size;
              existing.soldBy = existing.soldBy || next.soldBy;
              existing.countPerPack = existing.countPerPack || next.countPerPack;
            }
          }
        }

        // Pre-filter forbidden forms for structured ingredients, then score
        const filtered = si ? preFilterCandidates(candidates, si) : candidates;

        if (filtered.length > 0) {
          const ranked = rankCandidates(filtered, parsed);
          const best = ranked[0];

          if (best.matchType !== 'weak') {
            const qtyDecision = isEssential
              ? { cartQty: 1, confidence: 'high' as const, rationale: 'essential quantity comes from vault settings' }
              : resolveCartQuantity(parsed, best);
            const qty = qtyDecision.cartQty;
            mapped.push({
              name: items[i],
              upc: best.upc,
              quantity: qty,
              description: best.description,
              brand: best.brand,
              matchSource: searchSource,
              matchType: best.matchType,
              recipeQty: parsed.recipeQty,
              qtyMode: parsed.qtyMode,
              qtyConfidence: qtyDecision.confidence,
              qtyRationale: qtyDecision.rationale,
              isEssential,
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
          });
        }
      } catch {
        unmapped.push({
          name: items[i],
          searchTerm: terms[0],
          attemptedTerms: terms,
          isEssential,
        });
      }

      // Rate limit between ingredients
      if (i < items.length - 1) await new Promise(r => setTimeout(r, 200));
    }

    setCartItems(mapped);
    setUnmappedItems(unmapped);
    setApprovedSubstituteUpcs([]);
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
          const recipeMatched = cartItems.filter((i) => !i.isEssential).length;
          const recipeTotal = recipeMatched + unmappedItems.filter((i) => !i.isEssential).length;
          const essentialsTotal = [...cartItems, ...unmappedItems].filter((i) => i.isEssential).length;
          const essentialsMatched = cartItems.filter((i) => i.isEssential).length;
          const substitutesRecipe = subItems.filter((i) => !i.isEssential).length;
          const substitutesEssentials = subItems.filter((i) => i.isEssential).length;

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
                          {qtyMismatch && (
                            <p className="text-[10px] text-amber-700 mt-0.5">
                              Qty review: {item.qtyRationale} (Recipe: {item.recipeQty} / Cart: {item.quantity})
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
                  Needs your review ({subItems.length})
                </p>
                <p className="text-[10px] text-amber-800/90 mb-2">
                  These are not auto-added. Include only the ones you want.
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
                          <p className="text-sm font-medium leading-snug break-words">
                            {item.description}
                            {item.quantity > 1 && <span className="opacity-40"> x{item.quantity}</span>}
                          </p>
                          <p className="text-[10px] text-amber-800 leading-snug break-words">
                            {item.brand} — replacing recipe ingredient: {item.name}
                          </p>
                          {item.isEssential && (
                            <p className="text-[10px] text-amber-700/80 mt-0.5">(Essential Vault item)</p>
                          )}
                          {qtyMismatch && (
                            <p className="text-[10px] text-amber-700 mt-0.5">
                              Qty review: {item.qtyRationale} (Recipe: {item.recipeQty} / Cart: {item.quantity})
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
                  Not found ({unmappedItems.length})
                </p>
                <div className="space-y-1">
                  {unmappedItems.filter(u => !u.isEssential).map((item, i) => (
                    <p key={`r-${i}`} className="text-sm text-red-800">{item.name}</p>
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

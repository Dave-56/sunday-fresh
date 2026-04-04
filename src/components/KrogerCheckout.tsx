import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, MapPin, ShoppingCart, Check, Loader2, LogIn, ChevronRight, X, Package } from 'lucide-react';
import {
  isKrogerAuthenticated,
  getLoginUrl,
  searchLocations,
  searchProducts,
  addToCart,
  KrogerLocation,
  CartItem,
} from '../lib/kroger';
import { Dish, EssentialItem } from '../types';
import { cleanSearchTerm, getAllItems as collectItems } from '../lib/ingredients';

interface KrogerCheckoutProps {
  dish: Dish | null;
  essentials: EssentialItem[];
  savedZipCode: string;
  onBack: () => void;
}

type Step = 'auth' | 'location' | 'mapping' | 'confirm' | 'done';

export default function KrogerCheckout({ dish, essentials, savedZipCode, onBack }: KrogerCheckoutProps) {
  const hasZip = savedZipCode.length === 5;
  const [step, setStep] = useState<Step>(
    !isKrogerAuthenticated() ? 'auth' : hasZip ? 'mapping' : 'location'
  );
  const [zipCode, setZipCode] = useState(savedZipCode);
  const [selectedLocation, setSelectedLocation] = useState<KrogerLocation | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchingLocations, setSearchingLocations] = useState(false);
  const [mappingProgress, setMappingProgress] = useState({ current: 0, total: 0 });
  const [addingToCart, setAddingToCart] = useState(false);

  // Auto-start mapping if we have a saved zip and are authenticated
  useEffect(() => {
    if (step === 'mapping' && hasZip && !loading && cartItems.length === 0) {
      handleZipSubmit();
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

  const handleZipSubmit = async () => {
    if (!zipCode || zipCode.length < 5) return;
    setSearchingLocations(true);
    setError('');
    try {
      const locs = await searchLocations(zipCode);
      if (locs.length === 0) {
        setError('No Kroger stores found near that zip code.');
        setSearchingLocations(false);
        return;
      }
      // Auto-pick nearest store silently for product search accuracy
      setSelectedLocation(locs[0]);
      setSearchingLocations(false);
      setStep('mapping');
      await mapProducts(locs[0].locationId);
    } catch (err: any) {
      setError(err.message);
      setSearchingLocations(false);
    }
  };

  const mapProducts = async (locationId: string) => {
    setLoading(true);
    setError('');
    const items = getItems();
    setMappingProgress({ current: 0, total: items.length });
    const mapped: CartItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const term = cleanSearchTerm(items[i]);
      setMappingProgress({ current: i + 1, total: items.length });
      try {
        const products = await searchProducts(term, locationId, 1);
        if (products.length > 0) {
          const p = products[0];
          mapped.push({
            name: items[i],
            upc: p.upc,
            quantity: 1,
            description: p.description,
            brand: p.brand,
          });
        }
      } catch {
        // Skip items that fail to map
      }
      // Small delay to respect rate limits
      if (i < items.length - 1) await new Promise(r => setTimeout(r, 200));
    }

    setCartItems(mapped);
    setLoading(false);
    setStep('confirm');
  };

  const handleRemoveItem = (idx: number) => {
    setCartItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleAddToCart = async () => {
    setAddingToCart(true);
    setError('');
    try {
      const items = cartItems.map(ci => ({ upc: ci.upc, quantity: ci.quantity }));
      await addToCart(items);
      setStep('done');
    } catch (err: any) {
      setError(err.message);
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

        {/* ---- STEP 2: ZIP CODE ---- */}
        {step === 'location' && (
          <motion.div
            key="location"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <div className="mb-8">
              <h2 className="text-2xl font-bold tracking-tight mb-2">Your zip code</h2>
              <p className="text-sm opacity-60">For local product availability.</p>
            </div>

            <div className="relative mb-6">
              <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30" />
              <input
                type="text"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
                onKeyDown={(e) => e.key === 'Enter' && handleZipSubmit()}
                placeholder="e.g. 98101"
                className="w-full pl-11 pr-4 py-4 bg-white border border-black/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
              />
            </div>

            <button
              onClick={handleZipSubmit}
              disabled={zipCode.length < 5 || searchingLocations}
              className="w-full py-4 bg-black text-white rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-30 shadow-lg shadow-black/10"
            >
              {searchingLocations ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Finding products...
                </>
              ) : (
                <>
                  Find items
                  <ChevronRight size={16} />
                </>
              )}
            </button>
          </motion.div>
        )}

        {/* ---- STEP 3: MAPPING (loading) ---- */}
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
              Finding products near {zipCode}
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

        {/* ---- STEP 4: CONFIRM CART ---- */}
        {step === 'confirm' && (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <div className="mb-6">
              <h2 className="text-2xl font-bold tracking-tight mb-2">{cartItems.length} items ready</h2>
              <p className="text-[11px] opacity-40">
                Review and confirm, then checkout on QFC.
              </p>
            </div>

            <div className="space-y-2 mb-8">
              {cartItems.map((item, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-white border border-black/5 rounded-xl">
                  <Package size={16} className="opacity-20 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.description}</p>
                    <p className="text-[10px] opacity-40 truncate">{item.brand} — from: {item.name}</p>
                  </div>
                  <button
                    onClick={() => handleRemoveItem(i)}
                    className="p-1 hover:bg-black/5 rounded-full transition-colors flex-shrink-0"
                  >
                    <X size={14} className="opacity-30" />
                  </button>
                </div>
              ))}
            </div>

            {cartItems.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm opacity-40 mb-4">No items to add.</p>
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
                  Add to QFC
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* ---- STEP 5: DONE ---- */}
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
            <h2 className="text-2xl font-bold tracking-tight mb-3">{cartItems.length} items added</h2>
            <p className="text-sm opacity-60 leading-relaxed mb-8 max-w-xs">
              Finish checkout on QFC whenever you're ready.
            </p>
            <div className="flex flex-col gap-3 w-full">
              <button
                onClick={() => window.open('https://www.qfc.com/cart', '_blank')}
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

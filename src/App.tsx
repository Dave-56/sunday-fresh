import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, RefreshCcw, Check, ArrowLeft, Loader2, History, Settings as SettingsIcon, ShoppingBasket, ShoppingCart } from 'lucide-react';
import { Dish, HistoryItem, UserPreferences } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI, Type } from "@google/genai";
import Onboarding from './components/Onboarding';
import Settings from './components/Settings';
import Vault from './components/Vault';
import KrogerCheckout from './components/KrogerCheckout';
import { usePreferences } from './hooks/usePreferences';
import { buildTeaserPrompt, buildDetailPrompt } from './lib/buildPrompt';
import { setKrogerSession, isKrogerAuthenticated } from './lib/kroger';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const { preferences, savePreferences, isLoaded, syncToKV } = usePreferences();
  const [view, setView] = useState<'home' | 'recipe' | 'history' | 'settings' | 'vault' | 'kroger'>('home');
  const [krogerConnected, setKrogerConnected] = useState(isKrogerAuthenticated());
  const [options, setOptions] = useState<Dish[]>([]);
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [lockedDish, setLockedDish] = useState<Dish | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(true);
  const [recipeSubView, setRecipeSubView] = useState<'ingredients' | 'instructions'>('ingredients');

  const calculateStreak = () => {
    if (history.length === 0) return 0;
    
    let streak = 0;
    const now = new Date();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    
    // Sort history by date descending
    const sortedHistory = [...history].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    let lastDate = new Date();
    
    for (let i = 0; i < sortedHistory.length; i++) {
      const itemDate = new Date(sortedHistory[i].date);
      const diff = lastDate.getTime() - itemDate.getTime();
      
      if (i === 0) {
        // If the first item is older than 10 days, streak is broken
        if (diff > oneWeek * 1.5) break;
        streak++;
      } else {
        // If items are roughly a week apart
        if (diff >= oneWeek * 0.5 && diff <= oneWeek * 1.5) {
          streak++;
        } else if (diff > oneWeek * 1.5) {
          break;
        }
      }
      lastDate = itemDate;
    }
    return streak;
  };

  const getTimelineDots = () => {
    const dots = [];
    const now = new Date();
    const currentDay = now.getDay();
    const lastSunday = new Date(now);
    lastSunday.setDate(now.getDate() - currentDay);

    for (let i = 3; i >= 0; i--) {
      const targetSunday = new Date(lastSunday);
      targetSunday.setDate(lastSunday.getDate() - (i * 7));
      
      const isPrepped = history.some(item => {
        const itemDate = new Date(item.date);
        const diff = Math.abs(itemDate.getTime() - targetSunday.getTime());
        return diff < (3 * 24 * 60 * 60 * 1000); // Within 3 days of that Sunday
      });

      dots.push({
        isCurrent: i === 0,
        isPrepped,
        label: targetSunday.toLocaleDateString('en-US', { day: 'numeric' })
      });
    }
    return dots;
  };

  // Capture Kroger OAuth callback session from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const krogerSession = params.get('kroger_session');
    if (krogerSession) {
      setKrogerSession(krogerSession);
      setKrogerConnected(true);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
      // Go straight to the Kroger checkout flow
      setView('kroger');
    }
  }, []);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const has = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(has);
      }
    };
    checkKey();
  }, []);

  const handleOpenKeySelector = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  useEffect(() => {
    const savedHistory = localStorage.getItem('sunday_history');
    if (savedHistory) {
      const parsedHistory = JSON.parse(savedHistory);
      setHistory(parsedHistory);
      
      // Restore locked dish if it exists for the current week
      const currentWeek = getWeekRange();
      const currentWeekItem = parsedHistory.find((item: any) => item.week === currentWeek);
      if (currentWeekItem) {
        setLockedDish(currentWeekItem.dish);
      }
    }
  }, []);

  useEffect(() => {
    if (isLoaded && preferences.onboardingComplete && options.length === 0) {
      fetchSuggestions();
    }
  }, [isLoaded, preferences.onboardingComplete]);

  const fetchDishImage = async (dish: Dish, index: number) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: {
          parts: [
            { text: `A museum-grade professional editorial food photograph of ${dish.name} (${dish.cuisine}). Top-down aerial view (flat lay) on a perfectly clean, solid minimalist background. Vibrant colors, natural bright lighting, macro textures. Served in a single elegant, modern ceramic bowl or plate.${dish.servedWith?.primary ? ` A small secondary bowl of ${dish.servedWith.primary} is positioned beside the main dish, clearly subordinate.` : ''} STRICT MINIMALISM: No side garnishes, no lime wedges, no scattered herbs, no side piles of ingredients, no napkins, no cutlery. Only the main dish vessel${dish.servedWith?.primary ? ' and its accompaniment' : ''} and its contents. The food is the absolute hero. High-end culinary magazine style. No people.` },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: "1K"
          },
        },
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64 = part.inlineData.data;
          const url = `data:image/png;base64,${base64}`;
          setOptions(prev => {
            const next = [...prev];
            if (next[index]) next[index] = { ...next[index], imageUrl: url };
            return next;
          });
          break;
        }
      }
    } catch (error) {
      console.error(`Failed to fetch image for ${dish.name}:`, error);
    }
  };

  const fetchDishDetails = async (dish: Dish, index: number) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      const prompt = buildDetailPrompt(dish, preferences);
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              ingredients: { type: Type.ARRAY, items: { type: Type.STRING } },
              sections: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    steps: { 
                      type: Type.ARRAY, 
                      items: { 
                        type: Type.OBJECT,
                        properties: {
                          text: { type: Type.STRING },
                          time: { type: Type.STRING },
                        },
                        required: ["text", "time"],
                      } 
                    },
                  },
                  required: ["title", "steps"],
                },
              },
            },
            required: ["ingredients", "sections"],
          },
        },
      });

      const text = response.text;
      if (text) {
        const data = JSON.parse(text);
        setOptions(prev => {
          const next = [...prev];
          if (next[index]) next[index] = { ...next[index], ...data };
          return next;
        });
      }
    } catch (error) {
      console.error(`Failed to fetch details for ${dish.name}:`, error);
    }
  };

  const fetchSuggestions = async () => {
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      const prompt = buildTeaserPrompt(preferences, history.map(h => h.dish.name));

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                cuisine: { type: Type.STRING },
                why: { type: Type.STRING },
                difficulty: { type: Type.STRING, enum: ["Easy", "Intermediate"] },
                prepTime: { type: Type.STRING },
                servings: { type: Type.NUMBER },
                type: { type: Type.STRING, enum: ["Heritage", "Explorer"] },
              },
              required: ["name", "cuisine", "why", "difficulty", "prepTime", "servings", "type"],
            },
          },
        },
      });

      const text = response.text;
      if (text) {
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
          setOptions(data);
          // Start fetching images and details in parallel for each dish
          data.forEach((dish, i) => {
            fetchDishImage(dish, i);
            fetchDishDetails(dish, i);
          });
        }
      }
    } catch (error) {
      console.error('Failed to fetch suggestions:', error);
    } finally {
      setLoading(false);
    }
  };

  const lockInDish = () => {
    if (!selectedDish) return;
    const newItem: HistoryItem = {
      week: getWeekRange(),
      dish: selectedDish,
      date: new Date().toISOString(),
    };
    const newHistory = [newItem, ...history].slice(0, 8);
    setHistory(newHistory);
    localStorage.setItem('sunday_history', JSON.stringify(newHistory));
    syncToKV({ history: newHistory });
    setLockedDish(selectedDish);
    setView('home');
  };

  const getWeekRange = () => {
    const now = new Date();
    const first = now.getDate() - now.getDay() + 1;
    const last = first + 6;
    const firstDay = new Date(now.setDate(first));
    const lastDay = new Date(now.setDate(last));
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${firstDay.toLocaleDateString('en-US', options)} – ${lastDay.toLocaleDateString('en-US', options)}`;
  };

  if (!isLoaded) return null;

  if (!hasApiKey) {
    return (
      <div className="min-h-screen bg-[#fdfaf6] flex flex-col items-center justify-center p-6 text-center">
        <h1 className="text-3xl font-bold tracking-tighter mb-4">sunday.</h1>
        <p className="text-sm opacity-60 max-w-xs mb-8 leading-relaxed">
          To generate authentic, high-quality visuals for your heritage dishes, we need to use a specialized model.
        </p>
        <button
          onClick={handleOpenKeySelector}
          className="px-8 py-4 bg-black text-white rounded-xl font-bold text-sm tracking-tight shadow-lg shadow-black/10 active:scale-95 transition-transform"
        >
          Select API Key to Start
        </button>
        <p className="mt-6 text-[10px] opacity-30 uppercase tracking-widest">
          Requires a paid Google Cloud project key
        </p>
        <a 
          href="https://ai.google.dev/gemini-api/docs/billing" 
          target="_blank" 
          rel="noopener noreferrer"
          className="mt-2 text-[10px] underline opacity-30"
        >
          Learn about billing
        </a>
      </div>
    );
  }

  if (!preferences.onboardingComplete) {
    return <Onboarding onComplete={savePreferences} />;
  }

  if (view === 'settings') {
    return (
      <Settings 
        preferences={preferences} 
        onSave={(newPrefs) => {
          savePreferences(newPrefs);
          setView('home');
          fetchSuggestions();
        }} 
        onBack={() => setView('home')} 
      />
    );
  }

  if (view === 'history') {
    return (
      <div className="min-h-screen bg-[#fdfaf6] text-black font-sans p-6 max-w-md mx-auto">
        <header className="flex justify-between items-center mb-12">
          <button onClick={() => setView('home')} className="p-2 -ml-2 hover:bg-black/5 rounded-full transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-[10px] font-bold uppercase tracking-widest opacity-40">History</h2>
          <div className="w-10" />
        </header>

        <div className="space-y-8">
          {history.length === 0 ? (
            <p className="text-center opacity-30 py-12 text-sm">No history yet.</p>
          ) : (
            history.map((item, i) => (
              <div key={i} className="border-b border-black/5 pb-6">
                <p className="text-[10px] font-bold uppercase tracking-tighter opacity-30 mb-1">{item.week}</p>
                <h3 className="text-lg font-medium tracking-tight">{item.dish.name}</h3>
                <p className="text-xs opacity-50">{item.dish.cuisine}</p>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  if (view === 'vault') {
    return (
      <Vault
        preferences={preferences}
        onSave={savePreferences}
        onBack={() => setView('home')}
      />
    );
  }

  if (view === 'kroger') {
    return (
      <KrogerCheckout
        dish={lockedDish}
        essentials={preferences.essentials || []}
        savedZipCode={preferences.zipCode || ''}
        onBack={() => setView('home')}
      />
    );
  }

  if (view === 'recipe' && (selectedDish || lockedDish)) {
    const dish = lockedDish || selectedDish!;
    return (
      <div className="min-h-screen bg-[#fdfaf6] text-black font-sans p-6 max-w-md mx-auto">
        <header className="flex justify-between items-center mb-8">
          <button 
            onClick={() => {
              if (recipeSubView === 'instructions') {
                setRecipeSubView('ingredients');
              } else {
                setView('home');
              }
            }} 
            className="p-2 -ml-2 hover:bg-black/5 rounded-full transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          {lockedDish && (
            <div className="flex items-center gap-2 px-3 py-1 bg-black text-white rounded-full text-[10px] font-bold uppercase tracking-widest">
              <Check size={12} /> Locked
            </div>
          )}
        </header>

        <div className="mb-12">
          <span className="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-black/5 border border-black/5 rounded-md mb-4">
            {dish.cuisine}
          </span>
          <h1 className="text-4xl font-bold tracking-tight leading-tight mb-4">{dish.name}</h1>
          <p className="text-sm opacity-60 leading-relaxed">{dish.why}</p>
        </div>

        <div className={`grid ${dish.servedWith?.primary ? 'grid-cols-3' : 'grid-cols-2'} gap-4 mb-12`}>
          <div className="bg-white border border-black/5 p-4 rounded-2xl shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1">Time</p>
            <p className="text-sm font-medium">{dish.prepTime}</p>
          </div>
          <div className="bg-white border border-black/5 p-4 rounded-2xl shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1">Portions</p>
            <p className="text-sm font-medium">{dish.servings}</p>
          </div>
          {dish.servedWith?.primary && (
            <div className="bg-white border border-black/5 p-4 rounded-2xl shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1">Serve with</p>
              <p className="text-sm font-medium">{dish.servedWith.primary}</p>
            </div>
          )}
        </div>

        <AnimatePresence mode="wait">
          {recipeSubView === 'ingredients' ? (
            <motion.section 
              key="ingredients"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="mb-12"
            >
              <h3 className="text-[10px] font-bold uppercase tracking-widest mb-6 border-b border-black/5 pb-2 opacity-40">Ingredients</h3>
              {!dish.ingredients ? (
                <div className="flex items-center gap-3 opacity-30 py-4">
                  <Loader2 size={16} className="animate-spin" />
                  <p className="text-xs font-bold uppercase tracking-widest">Writing your grocery list...</p>
                </div>
              ) : (
                <>
                  <ul className="space-y-4 mb-12">
                    {dish.ingredients.map((ing, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm">
                        <span className="opacity-80">{ing}</span>
                      </li>
                    ))}
                  </ul>

                  {(preferences.essentials || []).length > 0 && (
                    <div className="mb-12">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest mb-6 border-b border-black/5 pb-2 opacity-40">Your Autopilot Essentials</h3>
                      <ul className="space-y-4">
                        {(preferences.essentials || []).map((item) => (
                          <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
                            <span className="opacity-80">{item.name}</span>
                            <span className="text-[10px] font-bold uppercase tracking-widest opacity-30">{item.quantity}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button
                    onClick={() => setRecipeSubView('instructions')}
                    className="w-full py-4 bg-black text-white rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 shadow-lg shadow-black/10 active:scale-95 transition-all"
                  >
                    View Instructions
                    <ChevronRight size={16} />
                  </button>
                </>
              )}
            </motion.section>
          ) : (
            <motion.section 
              key="instructions"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="mb-24"
            >
              <h3 className="text-[10px] font-bold uppercase tracking-widest mb-6 border-b border-black/5 pb-2 opacity-40">Instructions</h3>
              {!dish.sections ? (
                <div className="flex items-center gap-3 opacity-30 py-4">
                  <Loader2 size={16} className="animate-spin" />
                  <p className="text-xs font-bold uppercase tracking-widest">Perfecting the technique...</p>
                </div>
              ) : (
                <div className="space-y-12">
                  {dish.sections.map((section, sectionIdx) => (
                    <div key={sectionIdx}>
                      <h4 className="text-xs font-bold uppercase tracking-widest mb-6 opacity-60 flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-black/20" />
                        {section.title}
                      </h4>
                      <div className="space-y-8">
                        {section.steps.map((step, stepIdx) => (
                          <div key={stepIdx} className="flex gap-4">
                            <span className="text-[10px] font-bold opacity-20 mt-0.5">
                              {String(dish.sections!.slice(0, sectionIdx).reduce((acc, s) => acc + s.steps.length, 0) + stepIdx + 1).padStart(2, '0')}
                            </span>
                            <div className="flex-1">
                              <p className="text-sm leading-relaxed opacity-80 mb-1">
                                {typeof step === 'string' ? step : step.text}
                              </p>
                              {typeof step !== 'string' && step.time && (
                                <span className="text-[9px] font-bold uppercase tracking-widest text-orange-600/60 flex items-center gap-1">
                                  <span className="text-[10px]">⏱️</span> {step.time}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  
                  <button
                    onClick={() => setRecipeSubView('ingredients')}
                    className="w-full py-4 border border-black/10 rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 active:scale-95 transition-all"
                  >
                    <ArrowLeft size={16} />
                    Back to Ingredients
                  </button>
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        {recipeSubView === 'ingredients' && (
          <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#fdfaf6] border-t border-black/5 max-w-md mx-auto z-50 flex flex-col gap-3">
            {lockedDish?.name === dish.name && (
              <>
                <button
                  onClick={() => setView('kroger')}
                  className="w-full py-4 bg-[#0068B5] text-white rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
                >
                  <ShoppingCart size={16} />
                  Add to QFC
                </button>
                <button
                  onClick={() => window.open('https://www.instacart.com', '_blank')}
                  className="w-full py-3 border border-black/10 text-black/60 rounded-xl font-bold text-[11px] tracking-tight flex items-center justify-center gap-2 active:scale-95 transition-all"
                >
                  Or use Instacart
                </button>
              </>
            )}
            <button
              disabled={lockedDish?.name === dish.name}
              onClick={lockInDish}
              className={cn(
                "w-full py-4 rounded-xl font-bold text-sm tracking-tight transition-all active:scale-95 shadow-lg shadow-black/10 flex items-center justify-center gap-2",
                lockedDish?.name === dish.name 
                  ? "bg-white border border-black/10 text-black/40" 
                  : "bg-black text-white"
              )}
            >
              {lockedDish?.name === dish.name ? (
                <>
                  <Check size={16} />
                  <span>Locked for this week</span>
                </>
              ) : 'Lock in this dish'}
            </button>
          </div>
        )}
        <div className="h-12" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfaf6] text-black font-sans p-6 max-w-md mx-auto selection:bg-black selection:text-white">
      <header className="flex justify-between items-start mb-12">
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold tracking-tighter mb-1">sunday.</h1>
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-30">{getWeekRange()}</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setView('vault')}
            className="p-2 rounded-full hover:bg-black/5 transition-colors"
            title="Essentials Vault"
          >
            <ShoppingBasket size={20} className="opacity-40" />
          </button>
          <button 
            onClick={() => setView('history')}
            className="p-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <History size={20} className="opacity-40" />
          </button>
          <button 
            onClick={() => setView('settings')}
            className="p-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <SettingsIcon size={20} className="opacity-40" />
          </button>
        </div>
      </header>

      <main>
        {preferences.essentials?.length === 0 && (
          <button 
            onClick={() => setView('vault')}
            className="w-full mb-8 p-4 bg-orange-50 border border-orange-200 rounded-2xl flex items-center justify-between group active:scale-[0.98] transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
                <ShoppingBasket size={16} />
              </div>
              <div className="text-left">
                <p className="text-xs font-bold text-orange-900">Set up your weekly essentials</p>
                <p className="text-[10px] text-orange-700 opacity-60">Save 10 mins on every grocery run</p>
              </div>
            </div>
            <ChevronRight size={16} className="text-orange-400 group-hover:translate-x-1 transition-transform" />
          </button>
        )}

        {lockedDish ? (
          /* RITUAL DASHBOARD (Post-Lock) */
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Ritual Stats Card */}
            <div className="mb-8 p-8 bg-white border border-black/5 rounded-3xl shadow-sm">
              <div className="flex justify-between items-center mb-8">
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Weekly Progress</p>
                <div className="flex gap-1.5">
                  {getTimelineDots().map((dot, i) => (
                    <div key={i} className="flex flex-col items-center gap-1.5">
                      <div className={cn(
                        "w-2.5 h-2.5 rounded-full transition-all duration-500",
                        dot.isPrepped ? "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]" : "bg-black/5",
                        dot.isCurrent && !dot.isPrepped && "ring-2 ring-black/5 ring-offset-2 ring-offset-[#fdfaf6]"
                      )} />
                      <span className="text-[8px] font-bold opacity-20">{dot.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative aspect-[4/5] mb-8 overflow-hidden rounded-2xl bg-black/5">
                {lockedDish.imageUrl ? (
                  <img
                    src={lockedDish.imageUrl}
                    alt={lockedDish.name}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center opacity-20">
                    <Loader2 size={24} className="animate-spin" />
                  </div>
                )}
                <div className="absolute top-4 left-4">
                  <span className="text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-black/80 text-white border border-white/10 backdrop-blur-md">
                    {lockedDish.type}
                  </span>
                </div>
              </div>

              <h3 className="text-2xl font-bold tracking-tight mb-2">{lockedDish.name}</h3>
              <p className="text-sm opacity-50 leading-relaxed mb-8 line-clamp-2">{lockedDish.why}</p>

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    setSelectedDish(lockedDish);
                    setRecipeSubView('ingredients');
                    setView('recipe');
                  }}
                  className="w-full py-4 bg-black text-white rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 shadow-lg shadow-black/10 active:scale-95 transition-all"
                >
                  View recipe
                  <ChevronRight size={16} />
                </button>
                <button
                  onClick={() => setView('kroger')}
                  className="w-full py-4 bg-[#0068B5] text-white rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
                >
                  <ShoppingCart size={16} />
                  Add to QFC
                </button>
                <button
                  onClick={() => window.open('https://www.instacart.com', '_blank')}
                  className="w-full py-3 border border-black/10 text-black/60 rounded-xl font-bold text-[11px] tracking-tight flex items-center justify-center gap-2 active:scale-95 transition-all"
                >
                  Or use Instacart
                </button>
              </div>
            </div>

            <div className="text-center">
              <button 
                onClick={() => {
                  setLockedDish(null);
                  // Optionally remove from history if they want to "truly" reset, 
                  // but usually just clearing the lock is enough to go back to selection.
                }}
                className="text-[10px] font-bold uppercase tracking-widest opacity-30 hover:opacity-100 transition-opacity"
              >
                Change this week's plan
              </button>
            </div>
          </div>
        ) : (
          /* SELECTION DASHBOARD (Pre-Lock) */
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="mb-12">
              <h2 className="text-4xl font-bold tracking-tight mb-3">What's cooking?</h2>
              <p className="text-sm opacity-50 leading-relaxed">
                Pick one dish to prep on Sunday. Portions for {preferences.householdSize.toLowerCase()}, all week.
              </p>
            </div>

            <div className="mb-8">
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-6">This week's options</p>
              
              <div className="space-y-4">
                {loading ? (
                  <div className="py-20 flex flex-col items-center justify-center gap-4 opacity-10">
                    <Loader2 size={32} className="animate-spin" />
                    <p className="text-[10px] font-bold uppercase tracking-widest">Generating Menu...</p>
                  </div>
                ) : options.length === 0 ? (
                  <div className="py-12 text-center border border-dashed border-black/10 rounded-2xl">
                    <p className="text-xs opacity-50">Couldn't load suggestions. Check your connection and try again.</p>
                  </div>
                ) : (
                  options.map((dish, i) => (
                    <motion.button
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      onClick={() => {
                        setSelectedDish(dish);
                        setRecipeSubView('ingredients');
                        setView('recipe');
                      }}
                      className={cn(
                        "w-full text-left p-6 rounded-2xl border transition-all duration-300 bg-white shadow-sm",
                        selectedDish?.name === dish.name 
                          ? "border-black ring-1 ring-black" 
                          : "border-black/5 hover:border-black/20"
                      )}
                    >
                      <div className="relative aspect-square mb-4 overflow-hidden rounded-xl bg-black/5">
                        <AnimatePresence mode="wait">
                          {dish.imageUrl ? (
                            <motion.img
                              key="image"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              src={dish.imageUrl}
                              alt={dish.name}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <motion.div
                              key="shimmer"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="w-full h-full flex items-center justify-center"
                            >
                              <div className="flex flex-col items-center gap-2 opacity-20">
                                <Loader2 size={20} className="animate-spin" />
                                <span className="text-[8px] font-bold uppercase tracking-widest">Developing Visual...</span>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        <div className="absolute top-3 left-3">
                          <span className={cn(
                            "text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded-md backdrop-blur-md border",
                            dish.type === 'Heritage' 
                              ? "bg-black/80 text-white border-white/10" 
                              : "bg-white/80 text-black border-black/10"
                          )}>
                            {dish.type}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-y-3 mb-4">
                        <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-[#fdfaf6] border border-black/5 rounded-md">
                          {dish.cuisine}
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-widest opacity-30">
                          {dish.difficulty} • {dish.prepTime}
                        </span>
                      </div>
                      <h3 className="text-xl font-bold tracking-tight leading-tight mb-3">{dish.name}</h3>
                      <p className="text-xs opacity-50 line-clamp-3 leading-relaxed mb-4">{dish.why}</p>
                      {dish.servedWith?.primary && (
                        <p className="text-[10px] opacity-40 mb-4">Best with: {dish.servedWith.primary}</p>
                      )}
                      <div className="flex items-center text-[10px] font-bold uppercase tracking-widest opacity-40 group-hover:opacity-100 transition-opacity">
                        View Recipe <ChevronRight size={12} className="ml-1" />
                      </div>
                    </motion.button>
                  ))
                )}
              </div>
            </div>

            {/* Fixed bottom area with solid background to prevent interference */}
            <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#fdfaf6] border-t border-black/5 max-w-md mx-auto z-50">
              <div className="flex gap-3">
                <button
                  disabled={!selectedDish || loading}
                  onClick={lockInDish}
                  className="flex-1 py-4 bg-black text-white rounded-xl font-bold text-sm tracking-tight transition-all active:scale-95 shadow-lg shadow-black/10 whitespace-nowrap px-2 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  Lock in this dish
                </button>
                <button
                  onClick={fetchSuggestions}
                  disabled={loading}
                  className="flex-1 py-4 border border-black/10 bg-white rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 hover:bg-gray-50 transition-all active:scale-95 disabled:opacity-50 shadow-sm whitespace-nowrap px-2"
                >
                  <RefreshCcw size={14} className={loading ? "animate-spin" : ""} />
                  <span className="truncate">Suggest different</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      <div className="h-24" />
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, RefreshCcw, Check, ArrowLeft, Loader2, History, Settings as SettingsIcon } from 'lucide-react';
import { Dish, HistoryItem, UserPreferences } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI, Type } from "@google/genai";
import Onboarding from './components/Onboarding';
import Settings from './components/Settings';
import { usePreferences } from './hooks/usePreferences';
import { buildTeaserPrompt, buildDetailPrompt } from './lib/buildPrompt';

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
  const { preferences, savePreferences, isLoaded } = usePreferences();
  const [view, setView] = useState<'home' | 'recipe' | 'history' | 'settings'>('home');
  const [options, setOptions] = useState<Dish[]>([]);
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [lockedDish, setLockedDish] = useState<Dish | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(true);

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
      setHistory(JSON.parse(savedHistory));
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
            { text: `An authentic, high-end food photograph of ${dish.name} (${dish.cuisine}). Traditional presentation, served in culturally appropriate serving ware (e.g., clay pots, wooden bowls, or heritage ceramics). Rich textures, steam rising, natural side-lighting. Avoid generic modern kitchen backgrounds; use warm, atmospheric, and culturally relevant settings. Focus on the soul and heritage of the dish. No people.` },
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
                    steps: { type: Type.ARRAY, items: { type: Type.STRING } },
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
    setLockedDish(selectedDish);
    setView('recipe');
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
      <div className="min-h-screen bg-[#f9f6f1] flex flex-col items-center justify-center p-6 text-center">
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
      <div className="min-h-screen bg-[#f9f6f1] text-black font-sans p-6 max-w-md mx-auto">
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

  if (view === 'recipe' && (selectedDish || lockedDish)) {
    const dish = lockedDish || selectedDish!;
    return (
      <div className="min-h-screen bg-[#f9f6f1] text-black font-sans p-6 max-w-md mx-auto">
        <header className="flex justify-between items-center mb-8">
          <button onClick={() => setView('home')} className="p-2 -ml-2 hover:bg-black/5 rounded-full transition-colors">
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

        <div className="grid grid-cols-2 gap-4 mb-12">
          <div className="bg-white border border-black/5 p-4 rounded-2xl shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1">Time</p>
            <p className="text-sm font-medium">{dish.prepTime}</p>
          </div>
          <div className="bg-white border border-black/5 p-4 rounded-2xl shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1">Portions</p>
            <p className="text-sm font-medium">{dish.servings}</p>
          </div>
        </div>

        <section className="mb-12">
          <h3 className="text-[10px] font-bold uppercase tracking-widest mb-6 border-b border-black/5 pb-2 opacity-40">Ingredients</h3>
          {!dish.ingredients ? (
            <div className="flex items-center gap-3 opacity-30 py-4">
              <Loader2 size={16} className="animate-spin" />
              <p className="text-xs font-bold uppercase tracking-widest">Writing your grocery list...</p>
            </div>
          ) : (
            <ul className="space-y-4">
              {dish.ingredients.map((ing, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-black/10 mt-1.5 shrink-0" />
                  <span className="opacity-80">{ing}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-24">
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
                        <p className="text-sm leading-relaxed opacity-80">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#f9f6f1] border-t border-black/5 max-w-md mx-auto z-50">
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
        <div className="h-12" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f9f6f1] text-black font-sans p-6 max-w-md mx-auto selection:bg-black selection:text-white">
      <header className="flex justify-between items-start mb-16">
        <div>
          <h1 className="text-2xl font-bold tracking-tighter mb-1">sunday.</h1>
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-30">{getWeekRange()}</p>
        </div>
        <div className="flex items-center gap-2">
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
        <div className="mb-12">
          <h2 className="text-4xl font-bold tracking-tight mb-3">What's cooking this week?</h2>
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
                    <div className="absolute top-3 left-3 flex gap-2">
                      <span className={cn(
                        "text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded-md backdrop-blur-md border",
                        dish.type === 'Heritage' 
                          ? "bg-black/80 text-white border-white/10" 
                          : "bg-white/80 text-black border-black/10"
                      )}>
                        {dish.type}
                      </span>
                      {lockedDish?.name === dish.name && (
                        <span className="text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-green-500 text-white border border-green-400">
                          Locked
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-y-3 mb-4">
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-[#f9f6f1] border border-black/5 rounded-md">
                      {dish.cuisine}
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-widest opacity-30">
                      {dish.difficulty} • {dish.prepTime}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold tracking-tight leading-tight mb-3">{dish.name}</h3>
                  <p className="text-xs opacity-50 line-clamp-3 leading-relaxed mb-5">{dish.why}</p>
                  <div className="flex items-center text-[10px] font-bold uppercase tracking-widest opacity-40 group-hover:opacity-100 transition-opacity">
                    View Recipe <ChevronRight size={12} className="ml-1" />
                  </div>
                </motion.button>
              ))
            )}
          </div>
        </div>

        {/* Fixed bottom area with solid background to prevent interference */}
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#f9f6f1] border-t border-black/5 max-w-md mx-auto z-50">
          <div className="flex gap-3">
            <button
              disabled={!selectedDish || loading || lockedDish?.name === selectedDish?.name}
              onClick={lockInDish}
              className={cn(
                "flex-1 py-4 rounded-xl font-bold text-sm tracking-tight transition-all active:scale-95 shadow-lg shadow-black/10 whitespace-nowrap px-2 flex items-center justify-center gap-2",
                lockedDish?.name === selectedDish?.name 
                  ? "bg-white border border-black/10 text-black/40" 
                  : "bg-black text-white"
              )}
            >
              {lockedDish?.name === selectedDish?.name ? (
                <>
                  <Check size={14} />
                  <span>Locked</span>
                </>
              ) : 'Lock in this dish'}
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
      </main>
      <div className="h-24" />
    </div>
  );
}

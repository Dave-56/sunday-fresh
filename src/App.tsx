import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, RefreshCcw, Check, ArrowLeft, Loader2, History } from 'lucide-react';
import { Dish, HistoryItem } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI, Type } from "@google/genai";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const DEFAULT_DISHES: Dish[] = [
    {
      name: "Smokey Nigerian Jollof Rice with Grilled Chicken",
      cuisine: "Nigerian",
      why: "A classic West African staple. Rich, smokey, and perfectly spiced for a week of comforting lunches.",
      difficulty: "Intermediate",
      prepTime: "90 mins",
      servings: 12,
      ingredients: [
        "4 cups Long-grain parboiled rice",
        "6 large Red bell peppers (Tatashe)",
        "3 Scotch bonnet peppers (Atarodo)",
        "2 large Red onions",
        "1kg Chicken thighs (bone-in for flavor)",
        "1 cup Tomato paste",
        "2 cups Vegetable oil",
        "4 Bay leaves",
        "2 tbsp Thyme",
        "2 tbsp Curry powder",
        "6 Knorr/Maggi cubes",
        "Salt to taste"
      ],
      steps: [
        "Wash the rice thoroughly in warm water to remove excess starch. Parboil for 10 minutes, rinse again in cold water, and set aside in a sieve to drain.",
        "Remove seeds from red bell peppers. Blend the bell peppers, scotch bonnets, and 1.5 onions with a little water until smooth.",
        "Pour the blended pepper mix into a pot and boil on medium-high heat until the water evaporates and you're left with a thick concentrate.",
        "In a separate pot, boil the chicken thighs with sliced onions, thyme, curry, and 2 bouillon cubes until tender. Reserve the stock (this is liquid gold).",
        "Grill or air-fry the boiled chicken at 200°C for 15-20 minutes until the skin is crispy and golden brown.",
        "Heat vegetable oil in a large, heavy-bottomed pot. Sauté the remaining half onion until translucent, then add tomato paste. Fry for 5-8 minutes, stirring constantly to remove the sour taste.",
        "Add the boiled-down pepper concentrate to the tomato paste. Fry for another 10 minutes until the oil starts to float to the top.",
        "Season the base with remaining bouillon cubes, bay leaves, and salt. Pour in the reserved chicken stock and bring to a rolling boil.",
        "Add the parboiled rice. The liquid should be just level with the rice. If it's too much, the rice will be soggy; if too little, it won't cook.",
        "Cover the pot tightly with a double layer of aluminum foil, then the lid. This traps the steam, which is what actually cooks the rice.",
        "Cook on very low heat for 30 minutes. Do not open the pot. After 30 mins, check for tenderness. If needed, cook for another 10 mins.",
        "Once cooked, turn off the heat and stir in a little butter or oil for a glossy finish. Let it sit for 10 mins before serving to allow the flavors to settle."
      ]
    },
    {
      name: "Thai Green Curry with Prawns & Bamboo Shoots",
      cuisine: "Asian",
      why: "Vibrant, aromatic, and dairy-free. Uses coconut milk for a rich texture that holds up beautifully when reheated.",
      difficulty: "Easy",
      prepTime: "45 mins",
      servings: 12,
      ingredients: [
        "800g King prawns, peeled and deveined",
        "4 cans (400ml each) Full-fat coconut milk",
        "4 tbsp Green curry paste",
        "2 cans Bamboo shoots, drained",
        "4 large Bell peppers, sliced into strips",
        "2 bunches Thai basil",
        "4 tbsp Fish sauce",
        "2 tbsp Palm sugar",
        "6 Kaffir lime leaves, torn",
        "Jasmine rice for serving (8 cups cooked)"
      ],
      steps: [
        "Open the cans of coconut milk without shaking them. Scoop out the thick 'cream' from the top and put it into a large wok or heavy pot.",
        "Heat the coconut cream over medium heat until it starts to bubble and the oil begins to separate from the solids.",
        "Add the green curry paste to the cream. Use a wooden spoon to break it up and fry it in the oil for 2-3 minutes until it becomes intensely fragrant.",
        "Pour in the remaining coconut milk from the cans. Add the torn kaffir lime leaves and palm sugar. Bring the mixture to a gentle simmer.",
        "Add the sliced bell peppers and drained bamboo shoots. Simmer for 5-7 minutes until the peppers are slightly softened but still have a bit of 'snap'.",
        "Taste the sauce. Add the fish sauce one tablespoon at a time until the balance of salty, sweet, and spicy is perfect.",
        "Gently add the prawns to the simmering sauce. Cook for only 3-4 minutes. As soon as they turn pink and curl into a 'C' shape, they are done.",
        "Turn off the heat immediately. Stir in the fresh Thai basil leaves; the residual heat will wilt them and release their anise-like aroma.",
        "Serve the curry in deep bowls over a generous portion of fluffy jasmine rice. For batch cooking, store the rice and curry in separate compartments."
      ]
    },
    {
      name: "Slow-Cooked Beef Suya Stew with Sweet Potato",
      cuisine: "West African",
      why: "A fusion of traditional Suya spices in a hearty stew format. The sweet potato adds natural creaminess without dairy.",
      difficulty: "Intermediate",
      prepTime: "120 mins",
      servings: 12,
      ingredients: [
        "1.5kg Beef chuck, cubed into 1-inch pieces",
        "4 tbsp Suya spice (Yaji)",
        "4 large Sweet potatoes, peeled and cubed",
        "2 large Onions, finely chopped",
        "4 cloves Garlic, minced",
        "1 tbsp Fresh ginger, grated",
        "2 cans Chopped tomatoes",
        "1L Beef stock",
        "3 tbsp Natural peanut butter",
        "Fresh cilantro and sliced red onions for garnish"
      ],
      steps: [
        "In a large bowl, toss the beef cubes with 2 tablespoons of Suya spice until every piece is thoroughly coated. Let it marinate for 20 mins.",
        "Heat oil in a large heavy pot. Brown the beef in batches, ensuring you don't crowd the pan. Remove the beef and set aside.",
        "In the same pot, add the chopped onions. Scrape the bottom of the pot to release the flavorful browned bits (fond). Cook until onions are soft.",
        "Add the minced garlic and grated ginger. Sauté for 1-2 minutes until you can smell the aromatics.",
        "Stir in the chopped tomatoes and the remaining 2 tablespoons of Suya spice. Cook for 5 minutes until the tomatoes begin to break down.",
        "Return the beef to the pot. Pour in the beef stock and stir in the peanut butter until it's fully incorporated into the liquid.",
        "Bring to a boil, then reduce the heat to the lowest setting. Cover and simmer for 1 hour and 15 minutes, or until the beef is starting to get tender.",
        "Add the cubed sweet potatoes to the pot. Continue to simmer for another 25-30 minutes. The potatoes should be soft, and some will slightly dissolve, thickening the stew.",
        "Check the seasoning. The Suya spice is salty, so you may not need much extra salt. Add a squeeze of lime if it needs brightness.",
        "Garnish with fresh cilantro and very thinly sliced raw red onions for a traditional Suya crunch."
      ]
    }
  ];

  const [view, setView] = useState<'home' | 'recipe' | 'history'>('home');
  const [options, setOptions] = useState<Dish[]>(DEFAULT_DISHES);
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [lockedDish, setLockedDish] = useState<Dish | null>(null);

  useEffect(() => {
    const savedHistory = localStorage.getItem('sunday_history');
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
    // We keep the default dishes initially, but can refresh if needed
  }, []);

  const fetchSuggestions = async () => {
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      const prompt = `You are a world-class culinary expert specializing in West African and Asian fusion. 
Build a weekly meal plan for a couple (12 portions total, for 6 days). 

CRITICAL QUALITY GUIDELINES:
- Dishes must be "Chef-Quality": vibrant flavors, balanced textures, and sophisticated spice profiles.
- West African focus: Use authentic ingredients like Scotch Bonnet, locust beans (iru), crayfish, or Yaji spice.
- Asian focus: Use aromatics like lemongrass, galangal, Thai basil, or miso.
- Descriptions (the "why") should be evocative and mouth-watering.

INSTRUCTION GUIDELINES (MANDATORY):
- Steps must be EXTREMELY DETAILED and granular. Do not combine multiple major actions into one step.
- Provide 8-12 steps per recipe.
- Include specific techniques (e.g., "deglazing", "tempering spices", "reducing the base").
- Mention visual cues (e.g., "until the oil separates", "until the aromatics are fragrant", "until the beef is fork-tender").
- Explain the 'why' behind certain steps (e.g., "to remove the sourness of the tomatoes").

CONSTRAINTS:
- No dairy (lactose intolerant). Use coconut milk, nut milks, or oils for richness.
- No ungrilled fish. Prawns, crab, shrimp, and grilled/smoked fish are excellent.
- Batch-cookable: Must taste even better on day 3. Avoid ingredients that go soggy (like delicate greens).
- 2–3 hour Sunday cook time.

Avoid these recent dishes: ${history.map(h => h.dish.name).join(", ")}.

Return exactly 3 distinct dish options.`;

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
                name: { type: Type.STRING, description: "Elegant, descriptive dish name" },
                cuisine: { type: Type.STRING, description: "Specific region or style" },
                why: { type: Type.STRING, description: "A 1-2 sentence evocative culinary description" },
                difficulty: { type: Type.STRING, enum: ["Easy", "Intermediate"] },
                prepTime: { type: Type.STRING, description: "Total time including prep" },
                servings: { type: Type.NUMBER, description: "Must be 12" },
                ingredients: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Scaled for 12 portions" },
                steps: { type: Type.ARRAY, items: { type: Type.STRING }, description: "EXTREMELY DETAILED, granular, step-by-step professional instructions (8-12 steps)" },
              },
              required: ["name", "cuisine", "why", "difficulty", "prepTime", "servings", "ingredients", "steps"],
            },
          },
        },
      });

      const text = response.text;
      if (text) {
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
          setOptions(data);
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

  if (view === 'history') {
    return (
      <div className="min-h-screen bg-[#fbfaf8] text-black font-sans p-6 max-w-md mx-auto">
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
      <div className="min-h-screen bg-[#fbfaf8] text-black font-sans p-6 max-w-md mx-auto">
        <header className="flex justify-between items-center mb-8">
          <button onClick={() => setView('home')} className="p-2 -ml-2 hover:bg-black/5 rounded-full transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2 px-3 py-1 bg-black text-white rounded-full text-[10px] font-bold uppercase tracking-widest">
            <Check size={12} /> Locked
          </div>
        </header>

        <div className="mb-12">
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-2">{dish.cuisine}</p>
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
            <p className="text-sm font-medium">{dish.servings} (2 people × 6 days)</p>
          </div>
        </div>

        <section className="mb-12">
          <h3 className="text-[10px] font-bold uppercase tracking-widest mb-6 border-b border-black/5 pb-2 opacity-40">Ingredients</h3>
          <ul className="space-y-4">
            {dish.ingredients.map((ing, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <div className="w-1.5 h-1.5 rounded-full bg-black/10 mt-1.5 shrink-0" />
                <span className="opacity-80">{ing}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-24">
          <h3 className="text-[10px] font-bold uppercase tracking-widest mb-6 border-b border-black/5 pb-2 opacity-40">Instructions</h3>
          <div className="space-y-8">
            {dish.steps.map((step, i) => (
              <div key={i} className="flex gap-4">
                <span className="text-[10px] font-bold opacity-20 mt-0.5">{String(i + 1).padStart(2, '0')}</span>
                <p className="text-sm leading-relaxed opacity-80">{step}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fbfaf8] text-black font-sans p-6 max-w-md mx-auto selection:bg-black selection:text-white">
      <header className="flex justify-between items-start mb-16">
        <div>
          <h1 className="text-2xl font-bold tracking-tighter mb-1">sunday.</h1>
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-30">{getWeekRange()}</p>
        </div>
        <button 
          onClick={() => setView('history')}
          className="p-2 rounded-full hover:bg-black/5 transition-colors"
        >
          <History size={20} className="opacity-40" />
        </button>
      </header>

      <main>
        <div className="mb-12">
          <h2 className="text-4xl font-bold tracking-tight mb-3">What's cooking this week?</h2>
          <p className="text-sm opacity-50 leading-relaxed">
            Pick one dish to prep on Sunday. Portions for two, all week.
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
                  onClick={() => setSelectedDish(dish)}
                  className={cn(
                    "w-full text-left p-6 rounded-2xl border transition-all duration-300 bg-white shadow-sm",
                    selectedDish?.name === dish.name 
                      ? "border-black ring-1 ring-black" 
                      : "border-black/5 hover:border-black/20"
                  )}
                >
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 bg-[#fbfaf8] border border-black/5 rounded-md">
                      {dish.cuisine}
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-widest opacity-30">
                      {dish.difficulty} • {dish.prepTime}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold tracking-tight mb-2">{dish.name}</h3>
                  <p className="text-xs opacity-50 line-clamp-2 leading-relaxed mb-4">{dish.why}</p>
                  <div className="flex items-center text-[10px] font-bold uppercase tracking-widest opacity-40">
                    View Recipe <ChevronRight size={12} className="ml-1" />
                  </div>
                </motion.button>
              ))
            )}
          </div>
        </div>

        {/* Fixed bottom area with solid background to prevent interference */}
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#fbfaf8] border-t border-black/5 max-w-md mx-auto z-50">
          <div className="space-y-3">
            <button
              disabled={!selectedDish || loading}
              onClick={lockInDish}
              className="w-full py-4 bg-black text-white rounded-xl font-bold text-sm tracking-tight disabled:opacity-10 disabled:grayscale transition-all active:scale-95 shadow-lg shadow-black/10"
            >
              Lock in this dish
            </button>
            <button
              onClick={fetchSuggestions}
              disabled={loading}
              className="w-full py-4 border border-black/10 bg-white rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 hover:bg-gray-50 transition-all active:scale-95 disabled:opacity-50 shadow-sm"
            >
              <RefreshCcw size={16} className={loading ? "animate-spin" : ""} />
              Suggest different dishes
            </button>
          </div>
        </div>
      </main>
      <div className="h-48" />
    </div>
  );
}

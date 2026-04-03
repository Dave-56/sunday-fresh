import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Plus, Trash2, Check, Minus, Sparkles } from 'lucide-react';
import { EssentialItem, UserPreferences } from '../types';

interface VaultProps {
  preferences: UserPreferences;
  onSave: (newPrefs: UserPreferences) => void;
  onBack: () => void;
}

const VIBES = [
  { id: 'healthy', label: '🥗 Healthy', description: 'Fresh produce & clean snacks' },
  { id: 'balanced', label: '⚖️ Balanced', description: 'A mix of fresh & pantry staples' },
  { id: 'snacks', label: '🍿 Snacks', description: 'Quick bites & hydration' },
] as const;

const CATEGORY_NAMES: Record<string, string> = {
  'Fruits & Veg': '🥬 Fresh',
  'Water': '🥤 Hydration',
  'Snacks': '🍿 Snacks',
  'Breakfast': '🍳 Breakfast',
  'Dairy': '🥛 Dairy',
};

const STARTER_PACKS: Record<typeof VIBES[number]['id'], EssentialItem[]> = {
  healthy: [
    { id: 'h1', name: 'Bananas', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 'h2', name: 'Spinach', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 'h3', name: 'Apples', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 'h4', name: 'Greek Yogurt', quantity: 'weekly', category: 'Dairy' },
    { id: 'h5', name: 'Bottled Water', quantity: 'weekly', category: 'Water' },
  ],
  balanced: [
    { id: 'b1', name: 'Bananas', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 'b2', name: 'Eggs', quantity: 'weekly', category: 'Breakfast' },
    { id: 'b3', name: 'Milk', quantity: 'weekly', category: 'Dairy' },
    { id: 'b4', name: 'Chips', quantity: 'weekly', category: 'Snacks' },
    { id: 'b5', name: 'Bottled Water', quantity: 'weekly', category: 'Water' },
  ],
  snacks: [
    { id: 's1', name: 'Chips', quantity: 'weekly', category: 'Snacks' },
    { id: 's2', name: 'Granola Bars', quantity: 'weekly', category: 'Snacks' },
    { id: 's3', name: 'Bottled Water', quantity: 'weekly', category: 'Water' },
    { id: 's4', name: 'Apples', quantity: 'weekly', category: 'Fruits & Veg' },
  ],
};

export default function Vault({ preferences, onSave, onBack }: VaultProps) {
  const [step, setStep] = useState<1 | 2>(preferences.essentials?.length > 0 ? 2 : 1);
  const [selectedVibe, setSelectedVibe] = useState<typeof VIBES[number]['id'] | null>(null);

  const generateEssentials = (vibeId: typeof VIBES[number]['id']) => {
    const newEssentials = STARTER_PACKS[vibeId].map(item => ({
      ...item,
      id: Math.random().toString(36).substr(2, 9),
    }));

    onSave({
      ...preferences,
      essentials: newEssentials,
    });
    setStep(2);
  };

  const removeItem = (id: string) => {
    onSave({
      ...preferences,
      essentials: (preferences.essentials || []).filter(item => item.id !== id),
    });
  };

  const updateQuantity = (id: string, delta: number) => {
    onSave({
      ...preferences,
      essentials: (preferences.essentials || []).map(item => {
        if (item.id !== id) return item;
        const currentQty = parseInt(item.quantity) || 1;
        const newQty = Math.max(1, currentQty + delta);
        return { ...item, quantity: `${newQty} weekly` };
      }),
    });
  };

  if (step === 1) {
    return (
      <div className="min-h-screen bg-[#fdfaf6] text-black font-sans p-6 max-w-md mx-auto">
        <header className="flex justify-between items-center mb-12">
          <button onClick={onBack} className="p-2 -ml-2 hover:bg-black/5 rounded-full transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-[10px] font-bold uppercase tracking-widest opacity-40">Setup</h2>
          <div className="w-10" />
        </header>

        <div className="mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-4">Pick a vibe</h1>
          <p className="text-sm opacity-50 leading-relaxed">
            What kind of eater are you? We'll auto-generate your weekly baseline.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 mb-12">
          {VIBES.map(vibe => (
            <button
              key={vibe.id}
              onClick={() => {
                setSelectedVibe(vibe.id);
                generateEssentials(vibe.id);
              }}
              className="p-6 rounded-3xl border border-black/5 bg-white text-left transition-all hover:border-black/20 hover:shadow-lg hover:shadow-black/5 active:scale-[0.98] group"
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-xl">{vibe.label}</span>
                <div className="w-6 h-6 rounded-full border border-black/10 flex items-center justify-center group-hover:border-black/30 transition-colors">
                  <div className="w-2 h-2 rounded-full bg-black opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
              <p className="text-xs opacity-40 font-medium">{vibe.description}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const groupedItems = (preferences.essentials || []).reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, EssentialItem[]>);

  return (
    <div className="min-h-screen bg-[#fdfaf6] text-black font-sans p-6 max-w-md mx-auto">
      <header className="flex justify-between items-center mb-12">
        <button onClick={onBack} className="p-2 -ml-2 hover:bg-black/5 rounded-full transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-[10px] font-bold uppercase tracking-widest opacity-40">Your Baseline</h2>
        <button 
          onClick={() => setStep(1)}
          className="text-[10px] font-bold uppercase tracking-widest opacity-40 hover:opacity-100"
        >
          Reset
        </button>
      </header>

      <div className="mb-12">
        <div className="flex items-center gap-2 text-orange-500 mb-2">
          <Sparkles size={16} />
          <span className="text-[10px] font-bold uppercase tracking-widest">Magic Moment</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-4">You're covered.</h1>
        <p className="text-sm opacity-50 leading-relaxed">
          We've built your weekly baseline. We'll use this to pre-fill your cart every Sunday.
        </p>
      </div>

      <div className="space-y-8 mb-32">
        {Object.entries(groupedItems).map(([category, items]) => (
          <div key={category}>
            <h3 className="text-[10px] font-bold uppercase tracking-widest mb-4 opacity-30 border-b border-black/5 pb-2">
              {CATEGORY_NAMES[category] || category}
            </h3>
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {items.map(item => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white border border-black/5 p-4 rounded-2xl flex items-center justify-between group"
                  >
                    <div className="flex-1">
                      <h4 className="text-sm font-medium tracking-tight">{item.name}</h4>
                      <p className="text-[10px] opacity-40 font-bold uppercase tracking-widest">{item.quantity}</p>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="flex items-center bg-black/5 rounded-lg overflow-hidden">
                        <button 
                          onClick={() => updateQuantity(item.id, -1)}
                          className="p-2 hover:bg-black/5 transition-colors"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="text-[10px] font-bold w-4 text-center">
                          {parseInt(item.quantity) || 1}
                        </span>
                        <button 
                          onClick={() => updateQuantity(item.id, 1)}
                          className="p-2 hover:bg-black/5 transition-colors"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="p-2 text-black/10 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#fdfaf6] border-t border-black/5 max-w-md mx-auto z-50">
        <button
          onClick={onBack}
          className="w-full py-4 bg-black text-white rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 shadow-lg shadow-black/10 active:scale-95 transition-all"
        >
          Confirm Weekly Baseline
        </button>
      </div>
    </div>
  );
}

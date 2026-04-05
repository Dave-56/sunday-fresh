import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Plus, Trash2, Check, Minus, Sparkles, X } from 'lucide-react';
import { EssentialItem, UserPreferences } from '../types';

const ALL_CATEGORIES = Object.keys({
  'Fruits & Veg': 1, 'Beverages': 1, 'Snacks': 1, 'Breakfast': 1,
  'Dairy': 1, 'Pantry': 1, 'Bread & Bakery': 1, 'Proteins': 1,
  'Frozen': 1, 'Household': 1,
}) as EssentialItem['category'][];

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
  'Beverages': '🥤 Beverages',
  'Snacks': '🍿 Snacks',
  'Breakfast': '🍳 Breakfast',
  'Dairy': '🥛 Dairy',
  'Pantry': '🫙 Pantry',
  'Bread & Bakery': '🍞 Bread & Bakery',
  'Proteins': '🥩 Proteins',
  'Frozen': '🧊 Frozen',
  'Household': '🧹 Household',
};

const STARTER_PACKS: Record<typeof VIBES[number]['id'], EssentialItem[]> = {
  healthy: [
    { id: 'h1', name: 'Bananas', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 'h2', name: 'Spinach', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 'h3', name: 'Apples', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 'h4', name: 'Avocados', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 'h5', name: 'Berries', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 'h6', name: 'Greek Yogurt', quantity: 'weekly', category: 'Dairy' },
    { id: 'h7', name: 'Almond Milk', quantity: 'weekly', category: 'Beverages' },
    { id: 'h8', name: 'Orange Juice', quantity: 'weekly', category: 'Beverages' },
    { id: 'h9', name: 'Bottled Water', quantity: 'weekly', category: 'Beverages' },
    { id: 'h10', name: 'Eggs', quantity: 'weekly', category: 'Breakfast' },
    { id: 'h11', name: 'Oatmeal', quantity: 'weekly', category: 'Breakfast' },
    { id: 'h12', name: 'Chicken Breast', quantity: 'weekly', category: 'Proteins' },
    { id: 'h13', name: 'Salmon', quantity: 'weekly', category: 'Proteins' },
    { id: 'h14', name: 'Brown Rice', quantity: 'weekly', category: 'Pantry' },
    { id: 'h15', name: 'Olive Oil', quantity: 'weekly', category: 'Pantry' },
    { id: 'h16', name: 'Whole Wheat Bread', quantity: 'weekly', category: 'Bread & Bakery' },
    { id: 'h17', name: 'Trail Mix', quantity: 'weekly', category: 'Snacks' },
    { id: 'h18', name: 'Paper Towels', quantity: 'weekly', category: 'Household' },
  ],
  balanced: [
    { id: 'b1', name: 'Bananas', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 'b2', name: 'Onions', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 'b3', name: 'Tomatoes', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 'b4', name: 'Potatoes', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 'b5', name: 'Eggs', quantity: 'weekly', category: 'Breakfast' },
    { id: 'b6', name: 'Cereal', quantity: 'weekly', category: 'Breakfast' },
    { id: 'b7', name: 'Milk', quantity: 'weekly', category: 'Dairy' },
    { id: 'b8', name: 'Cheese', quantity: 'weekly', category: 'Dairy' },
    { id: 'b9', name: 'Butter', quantity: 'weekly', category: 'Dairy' },
    { id: 'b10', name: 'Juice', quantity: 'weekly', category: 'Beverages' },
    { id: 'b11', name: 'Bottled Water', quantity: 'weekly', category: 'Beverages' },
    { id: 'b12', name: 'Bread', quantity: 'weekly', category: 'Bread & Bakery' },
    { id: 'b13', name: 'Tortillas', quantity: 'weekly', category: 'Bread & Bakery' },
    { id: 'b14', name: 'Chicken Thighs', quantity: 'weekly', category: 'Proteins' },
    { id: 'b15', name: 'Ground Beef', quantity: 'weekly', category: 'Proteins' },
    { id: 'b16', name: 'Rice', quantity: 'weekly', category: 'Pantry' },
    { id: 'b17', name: 'Pasta', quantity: 'weekly', category: 'Pantry' },
    { id: 'b18', name: 'Cooking Oil', quantity: 'weekly', category: 'Pantry' },
    { id: 'b19', name: 'Chips', quantity: 'weekly', category: 'Snacks' },
    { id: 'b20', name: 'Frozen Veggies', quantity: 'weekly', category: 'Frozen' },
    { id: 'b21', name: 'Paper Towels', quantity: 'weekly', category: 'Household' },
    { id: 'b22', name: 'Trash Bags', quantity: 'weekly', category: 'Household' },
  ],
  snacks: [
    { id: 's1', name: 'Chips', quantity: 'weekly', category: 'Snacks' },
    { id: 's2', name: 'Granola Bars', quantity: 'weekly', category: 'Snacks' },
    { id: 's3', name: 'Cookies', quantity: 'weekly', category: 'Snacks' },
    { id: 's4', name: 'Popcorn', quantity: 'weekly', category: 'Snacks' },
    { id: 's5', name: 'Pretzels', quantity: 'weekly', category: 'Snacks' },
    { id: 's6', name: 'Apples', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 's7', name: 'Grapes', quantity: 'weekly', category: 'Fruits & Veg' },
    { id: 's8', name: 'Juice', quantity: 'weekly', category: 'Beverages' },
    { id: 's9', name: 'Soda', quantity: 'weekly', category: 'Beverages' },
    { id: 's10', name: 'Bottled Water', quantity: 'weekly', category: 'Beverages' },
    { id: 's11', name: 'Cake', quantity: 'weekly', category: 'Bread & Bakery' },
    { id: 's12', name: 'Ice Cream', quantity: 'weekly', category: 'Frozen' },
    { id: 's13', name: 'Frozen Pizza', quantity: 'weekly', category: 'Frozen' },
  ],
};

export default function Vault({ preferences, onSave, onBack }: VaultProps) {
  const [step, setStep] = useState<1 | 2>(preferences.essentials?.length > 0 ? 2 : 1);
  const [selectedVibe, setSelectedVibe] = useState<typeof VIBES[number]['id'] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<EssentialItem['category']>('Fruits & Veg');
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showAddForm && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [showAddForm]);

  const addCustomItem = () => {
    const trimmed = newItemName.trim();
    if (!trimmed) return;
    onSave({
      ...preferences,
      essentials: [
        ...(preferences.essentials || []),
        {
          id: Math.random().toString(36).substr(2, 9),
          name: trimmed,
          quantity: 'weekly',
          category: newItemCategory,
        },
      ],
    });
    setNewItemName('');
    setShowAddForm(false);
  };

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

      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/20"
            onClick={() => setShowAddForm(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md bg-[#fdfaf6] rounded-t-3xl p-6 pb-10 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold tracking-tight">Add item</h3>
                <button onClick={() => setShowAddForm(false)} className="p-2 hover:bg-black/5 rounded-full">
                  <X size={18} />
                </button>
              </div>

              <input
                ref={addInputRef}
                type="text"
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustomItem()}
                placeholder="e.g. Plantains, Mango Juice, Cake..."
                className="w-full p-4 rounded-2xl border border-black/10 bg-white text-sm font-medium tracking-tight placeholder:opacity-30 focus:outline-none focus:border-black/30 mb-4"
              />

              <div className="mb-6">
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-30 mb-3">Category</p>
                <div className="flex flex-wrap gap-2">
                  {ALL_CATEGORIES.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setNewItemCategory(cat)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        newItemCategory === cat
                          ? 'bg-black text-white'
                          : 'bg-black/5 text-black/50 hover:bg-black/10'
                      }`}
                    >
                      {CATEGORY_NAMES[cat] || cat}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={addCustomItem}
                disabled={!newItemName.trim()}
                className="w-full py-4 bg-black text-white rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 shadow-lg shadow-black/10 active:scale-95 transition-all disabled:opacity-20 disabled:active:scale-100"
              >
                <Plus size={16} />
                Add to Baseline
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#fdfaf6] border-t border-black/5 max-w-md mx-auto z-50">
        <div className="flex gap-3">
          <button
            onClick={() => setShowAddForm(true)}
            className="py-4 px-5 bg-white border border-black/10 rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 hover:border-black/20 active:scale-95 transition-all"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={onBack}
            className="flex-1 py-4 bg-black text-white rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 shadow-lg shadow-black/10 active:scale-95 transition-all"
          >
            Confirm Weekly Baseline
          </button>
        </div>
      </div>
    </div>
  );
}

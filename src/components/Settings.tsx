import React, { useState } from 'react';
import { ArrowLeft, Check, Save, MapPin } from 'lucide-react';
import { UserPreferences } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SettingsProps {
  preferences: UserPreferences;
  onSave: (prefs: UserPreferences) => void;
  onBack: () => void;
}

export default function Settings({ preferences, onSave, onBack }: SettingsProps) {
  const [prefs, setPrefs] = useState<UserPreferences>(preferences);

  const toggleMulti = (key: 'cuisines' | 'restrictions', value: string) => {
    setPrefs(prev => {
      const current = prev[key] as string[];
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  };

  const setSingle = (key: keyof UserPreferences, value: string) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="min-h-screen bg-[#fdfaf6] text-zinc-900 font-sans p-6 max-w-md mx-auto pb-32">
      <header className="flex justify-between items-center mb-12">
        <button onClick={onBack} className="p-2 -ml-2 hover:bg-zinc-200 rounded-full transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-[10px] font-bold uppercase tracking-widest opacity-40">Settings</h2>
        <div className="w-10" />
      </header>

      <div className="space-y-12">
        <section>
          <h3 className="text-sm font-bold tracking-tight mb-4">Household Size</h3>
          <div className="grid grid-cols-2 gap-3">
            {['Just me', 'Two of us', 'Family (3–4 people)', 'Group (5+)'].map(option => (
              <button
                key={option}
                onClick={() => setSingle('householdSize', option)}
                className={cn(
                  "p-4 rounded-xl border transition-all text-left text-sm font-medium leading-tight",
                  prefs.householdSize === option ? "border-zinc-400 bg-white text-zinc-900 shadow-sm" : "border-zinc-200 bg-white text-zinc-500"
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-bold tracking-tight mb-4">Cuisines</h3>
          <div className="space-y-2">
            {[
              'Nigerian / West African',
              'Asian (Chinese, Japanese, Korean, Thai)',
              'Mediterranean / Middle Eastern',
              'American / Western',
              'Indian / South Asian',
              'Open to anything'
            ].map(option => (
              <button
                key={option}
                onClick={() => toggleMulti('cuisines', option)}
                className={cn(
                  "w-full text-left p-4 rounded-xl border transition-all flex justify-between items-center gap-4",
                  prefs.cuisines.includes(option) ? "border-zinc-400 bg-white text-zinc-900 shadow-sm" : "border-zinc-200 bg-white text-zinc-500"
                )}
              >
                <span className="text-sm font-medium tracking-tight leading-snug">{option}</span>
                {prefs.cuisines.includes(option) && <Check size={16} className="shrink-0" />}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-bold tracking-tight mb-4">Dietary Restrictions</h3>
          <div className="space-y-2">
            {[
              'No dairy / lactose intolerant',
              'No pork',
              'No shellfish',
              'No fish',
              'Halal only',
              'Vegetarian',
              'Vegan',
              'None — we eat everything'
            ].map(option => (
              <button
                key={option}
                onClick={() => toggleMulti('restrictions', option)}
                className={cn(
                  "w-full text-left p-4 rounded-xl border transition-all flex justify-between items-center gap-4",
                  prefs.restrictions.includes(option) ? "border-zinc-400 bg-white text-zinc-900 shadow-sm" : "border-zinc-200 bg-white text-zinc-500"
                )}
              >
                <span className="text-sm font-medium tracking-tight leading-snug">{option}</span>
                {prefs.restrictions.includes(option) && <Check size={16} className="shrink-0" />}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-bold tracking-tight mb-4">Prep Time</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              'Under 1 hour',
              '1–2 hours',
              '2–3 hours',
              '3+ hours, we enjoy it'
            ].map(option => (
              <button
                key={option}
                onClick={() => setSingle('prepTime', option)}
                className={cn(
                  "p-4 rounded-xl border transition-all text-left text-sm font-medium leading-tight",
                  prefs.prepTime === option ? "border-zinc-400 bg-white text-zinc-900 shadow-sm" : "border-zinc-200 bg-white text-zinc-500"
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-bold tracking-tight mb-4">Variety</h3>
          <div className="space-y-2">
            {[
              'Mostly familiar comfort food',
              'Balanced — 70% familiar, 30% new',
              'Push us to try new things'
            ].map(option => (
              <button
                key={option}
                onClick={() => setSingle('variety', option)}
                className={cn(
                  "w-full text-left p-4 rounded-xl border transition-all text-sm font-medium leading-tight",
                  prefs.variety === option ? "border-zinc-400 bg-white text-zinc-900 shadow-sm" : "border-zinc-200 bg-white text-zinc-500"
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-bold tracking-tight mb-2">Zip Code</h3>
          <p className="text-[11px] opacity-40 mb-4">For Kroger product availability.</p>
          <div className="relative">
            <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30" />
            <input
              type="text"
              value={prefs.zipCode || ''}
              onChange={(e) => setPrefs(prev => ({ ...prev, zipCode: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
              placeholder="e.g. 98101"
              className="w-full pl-11 pr-4 py-4 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
            />
          </div>
        </section>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#fdfaf6] border-t border-zinc-200 max-w-md mx-auto z-50">
        <button
          onClick={() => onSave(prefs)}
          className="w-full py-4 bg-white border border-zinc-200 text-zinc-700 rounded-xl font-bold text-sm tracking-tight flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all"
        >
          <Save size={18} />
          Save changes
        </button>
      </div>
    </div>
  );
}

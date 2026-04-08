import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Check, ChevronRight, MapPin } from 'lucide-react';
import { UserPreferences } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface OnboardingProps {
  onComplete: (prefs: UserPreferences) => void;
}

const STEPS = [
  'Welcome',
  'Household',
  'Heritage',
  'Explorer',
  'Restrictions',
  'PrepTime',
  'Variety',
  'ZipCode',
  'Done'
];

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState<UserPreferences>({
    householdSize: '',
    cuisines: [],
    restrictions: [],
    prepTime: '',
    variety: '',
    onboardingComplete: false,
    essentials: [],
    selectedEssentialCategories: [],
    zipCode: '',
  });

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep(s => Math.max(s - 1, 0));

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

  const isStepValid = () => {
    if (step === 0) return true;
    if (step === 1) return !!prefs.householdSize;
    if (step === 2) return prefs.cuisines.length > 0;
    if (step === 3) return prefs.cuisines.length > 1;
    if (step === 4) return prefs.restrictions.length > 0;
    if (step === 5) return !!prefs.prepTime;
    if (step === 6) return !!prefs.variety;
    if (step === 7) return (prefs.zipCode?.length ?? 0) === 5;
    if (step === 8) return true;
    return false;
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <h1 className="text-4xl font-bold tracking-tight mb-4">let's set up your kitchen.</h1>
            <p className="text-sm opacity-50 leading-relaxed mb-12">
              A few quick questions so we only suggest food you'll actually enjoy.
            </p>
            <button
              onClick={next}
              className="w-full py-4 bg-white border border-zinc-200 text-zinc-700 rounded-xl font-bold text-sm tracking-tight shadow-sm active:scale-95 transition-all"
            >
              Get started
            </button>
          </div>
        );

      case 1:
        return (
          <div className="px-6">
            <h2 className="text-2xl font-bold tracking-tight mb-8">How many people are you cooking for?</h2>
            <div className="space-y-3">
              {['Just me', 'Two of us', 'Family (3–4 people)', 'Group (5+)'].map(option => (
                <button
                  key={option}
                  onClick={() => setSingle('householdSize', option)}
                  className={cn(
                    "w-full text-left p-5 rounded-xl border transition-all",
                    prefs.householdSize === option ? "border-zinc-400 bg-white text-zinc-900 shadow-sm" : "border-zinc-200 bg-white text-zinc-500"
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        );

      case 2:
        return (
          <div className="px-6">
            <h2 className="text-2xl font-bold tracking-tight mb-8">What's your heritage cuisine?</h2>
            <p className="text-xs opacity-40 mb-6 uppercase font-bold tracking-widest">Pick one</p>
            <div className="space-y-3">
              {[
                'Nigerian / West African',
                'Asian (Chinese, Japanese, Korean, Thai)',
                'Mediterranean / Middle Eastern',
                'American / Western',
                'Indian / South Asian',
              ].map(option => (
                <button
                  key={option}
                  onClick={() => setPrefs(prev => ({
                    ...prev,
                    cuisines: [option, ...prev.cuisines.slice(1).filter(c => c !== option)]
                  }))}
                  className={cn(
                    "w-full text-left p-5 rounded-xl border transition-all flex justify-between items-center gap-4",
                    prefs.cuisines[0] === option ? "border-zinc-400 bg-white text-zinc-900 shadow-sm" : "border-zinc-200 bg-white text-zinc-500"
                  )}
                >
                  <span className="text-sm font-medium tracking-tight leading-snug">{option}</span>
                  {prefs.cuisines[0] === option && <Check size={16} className="shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        );

      case 3: {
        const heritage = prefs.cuisines[0];
        const explorers = prefs.cuisines.slice(1);
        const explorerOptions = [
          'Nigerian / West African',
          'Asian (Chinese, Japanese, Korean, Thai)',
          'Mediterranean / Middle Eastern',
          'American / Western',
          'Indian / South Asian',
          'Open to anything'
        ].filter(c => c !== heritage);

        return (
          <div className="px-6">
            <h2 className="text-2xl font-bold tracking-tight mb-8">What else do you want to explore?</h2>
            <p className="text-xs opacity-40 mb-6 uppercase font-bold tracking-widest">Pick at least one</p>
            <div className="space-y-3">
              {explorerOptions.map(option => (
                <button
                  key={option}
                  onClick={() => setPrefs(prev => {
                    const current = prev.cuisines.slice(1);
                    if (option === 'Open to anything') {
                      const next = current.includes(option) ? [] : [option];
                      return { ...prev, cuisines: [prev.cuisines[0], ...next] };
                    }
                    const next = current.includes(option)
                      ? current.filter(v => v !== option)
                      : [...current.filter(v => v !== 'Open to anything'), option];
                    return { ...prev, cuisines: [prev.cuisines[0], ...next] };
                  })}
                  className={cn(
                    "w-full text-left p-5 rounded-xl border transition-all flex justify-between items-center gap-4",
                    explorers.includes(option) ? "border-zinc-400 bg-white text-zinc-900 shadow-sm" : "border-zinc-200 bg-white text-zinc-500"
                  )}
                >
                  <span className="text-sm font-medium tracking-tight leading-snug">{option}</span>
                  {explorers.includes(option) && <Check size={16} className="shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        );
      }

      case 4:
        return (
          <div className="px-6">
            <h2 className="text-2xl font-bold tracking-tight mb-8">Any dietary restrictions to always respect?</h2>
            <p className="text-xs opacity-40 mb-6 uppercase font-bold tracking-widest">Pick all that apply</p>
            <div className="space-y-3">
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
                  onClick={() => setPrefs(prev => {
                    const none = 'None \u2014 we eat everything';
                    if (option === none) {
                      return { ...prev, restrictions: prev.restrictions.includes(none) ? [] : [none] };
                    }
                    const next = prev.restrictions.includes(option)
                      ? prev.restrictions.filter(v => v !== option)
                      : [...prev.restrictions.filter(v => v !== none), option];
                    return { ...prev, restrictions: next };
                  })}
                  className={cn(
                    "w-full text-left p-5 rounded-xl border transition-all flex justify-between items-center gap-4",
                    prefs.restrictions.includes(option) ? "border-zinc-400 bg-white text-zinc-900 shadow-sm" : "border-zinc-200 bg-white text-zinc-500"
                  )}
                >
                  <span className="text-sm font-medium tracking-tight leading-snug">{option}</span>
                  {prefs.restrictions.includes(option) && <Check size={16} className="shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        );

      case 5:
        return (
          <div className="px-6">
            <h2 className="text-2xl font-bold tracking-tight mb-8">How long can you cook on prep day?</h2>
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
                    "p-5 rounded-xl border transition-all text-left text-sm font-medium leading-tight",
                    prefs.prepTime === option ? "border-zinc-400 bg-white text-zinc-900 shadow-sm" : "border-zinc-200 bg-white text-zinc-500"
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        );

      case 6:
        return (
          <div className="px-6">
            <h2 className="text-2xl font-bold tracking-tight mb-8">How do you want variety?</h2>
            <div className="space-y-3">
              {[
                'Mostly familiar comfort food',
                'Balanced — 70% familiar, 30% new',
                'Push us to try new things'
              ].map(option => (
                <button
                  key={option}
                  onClick={() => setSingle('variety', option)}
                  className={cn(
                    "w-full text-left p-5 rounded-xl border transition-all",
                    prefs.variety === option ? "border-zinc-400 bg-white text-zinc-900 shadow-sm" : "border-zinc-200 bg-white text-zinc-500"
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        );

      case 7:
        return (
          <div className="px-6">
            <h2 className="text-2xl font-bold tracking-tight mb-3">What's your zip code?</h2>
            <p className="text-sm opacity-50 leading-relaxed mb-8">
              So we can find grocery items at your nearest store.
            </p>
            <div className="relative">
              <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30" />
              <input
                type="text"
                inputMode="numeric"
                value={prefs.zipCode || ''}
                onChange={(e) => setPrefs(prev => ({ ...prev, zipCode: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
                placeholder="e.g. 98101"
                className="w-full pl-11 pr-4 py-4 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
              />
            </div>
          </div>
        );

      case 8:
        return (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <h1 className="text-4xl font-bold tracking-tight mb-4">you're all set.</h1>
            <p className="text-sm opacity-50 leading-relaxed mb-12">
              We'll suggest dishes every week based on your taste profile. You can update these anytime in settings.
            </p>
            <button
              onClick={() => onComplete({ ...prefs, onboardingComplete: true })}
              className="w-full py-4 bg-white border border-zinc-200 text-zinc-700 rounded-xl font-bold text-sm tracking-tight shadow-sm active:scale-95 transition-all"
            >
              See this week's dishes
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-[#fdfaf6] z-[100] flex flex-col max-w-md mx-auto overflow-hidden text-zinc-900">
      {step > 0 && step < STEPS.length - 1 && (
        <div className="px-6 pt-8 pb-4">
          <div className="flex items-center justify-between mb-4">
            <button onClick={back} className="p-2 -ml-2 hover:bg-zinc-200 rounded-full transition-colors">
              <ArrowLeft size={20} />
            </button>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Step {step} of {STEPS.length - 2}</p>
            <div className="w-10" />
          </div>
          <div className="h-1 bg-zinc-200 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(step / (STEPS.length - 2)) * 100}%` }}
              className="h-full bg-zinc-600"
            />
          </div>
        </div>
      )}

      <div className="flex-1 relative overflow-y-auto pb-32">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="h-full pt-12"
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </div>

      {step > 0 && step < STEPS.length - 1 && (
        <div className="p-6 bg-[#fdfaf6] border-t border-zinc-200">
          <button
            disabled={!isStepValid()}
            onClick={next}
            className="w-full py-4 bg-white border border-zinc-200 text-zinc-700 rounded-xl font-bold text-sm tracking-tight shadow-sm disabled:opacity-50 transition-all active:scale-95"
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}

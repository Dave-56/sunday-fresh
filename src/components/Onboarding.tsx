import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Check, ChevronRight } from 'lucide-react';
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
  'Cuisines',
  'Restrictions',
  'Skill',
  'PrepTime',
  'Variety',
  'Done'
];

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState<UserPreferences>({
    householdSize: '',
    cuisines: [],
    restrictions: [],
    skillLevel: '',
    prepTime: '',
    variety: '',
    onboardingComplete: false,
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
    if (step === 3) return prefs.restrictions.length > 0;
    if (step === 4) return !!prefs.skillLevel;
    if (step === 5) return !!prefs.prepTime;
    if (step === 6) return !!prefs.variety;
    if (step === 7) return true;
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
              className="w-full py-4 bg-black text-white rounded-xl font-bold text-sm tracking-tight"
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
                    prefs.householdSize === option ? "border-black bg-black text-white" : "border-black/5 bg-white"
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
            <h2 className="text-2xl font-bold tracking-tight mb-8">What cuisines feel like home?</h2>
            <p className="text-xs opacity-40 mb-6 uppercase font-bold tracking-widest">Pick all that apply</p>
            <div className="space-y-3">
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
                    "w-full text-left p-5 rounded-xl border transition-all flex justify-between items-center gap-4",
                    prefs.cuisines.includes(option) ? "border-black bg-black text-white" : "border-black/5 bg-white"
                  )}
                >
                  <span className="text-sm font-medium tracking-tight leading-snug">{option}</span>
                  {prefs.cuisines.includes(option) && <Check size={16} className="shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        );

      case 3:
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
                  onClick={() => toggleMulti('restrictions', option)}
                  className={cn(
                    "w-full text-left p-5 rounded-xl border transition-all flex justify-between items-center gap-4",
                    prefs.restrictions.includes(option) ? "border-black bg-black text-white" : "border-black/5 bg-white"
                  )}
                >
                  <span className="text-sm font-medium tracking-tight leading-snug">{option}</span>
                  {prefs.restrictions.includes(option) && <Check size={16} className="shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        );

      case 4:
        return (
          <div className="px-6">
            <h2 className="text-2xl font-bold tracking-tight mb-8">What's your cooking skill level?</h2>
            <div className="space-y-3">
              {[
                'Beginner — simple recipes, minimal prep',
                'Intermediate — comfortable in the kitchen',
                'Advanced — bring on the complexity'
              ].map(option => (
                <button
                  key={option}
                  onClick={() => setSingle('skillLevel', option)}
                  className={cn(
                    "w-full text-left p-5 rounded-xl border transition-all",
                    prefs.skillLevel === option ? "border-black bg-black text-white" : "border-black/5 bg-white"
                  )}
                >
                  {option}
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
                    prefs.prepTime === option ? "border-black bg-black text-white" : "border-black/5 bg-white"
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
                    prefs.variety === option ? "border-black bg-black text-white" : "border-black/5 bg-white"
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
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <h1 className="text-4xl font-bold tracking-tight mb-4">you're all set.</h1>
            <p className="text-sm opacity-50 leading-relaxed mb-12">
              We'll suggest dishes every week based on your taste profile. You can update these anytime in settings.
            </p>
            <button
              onClick={() => onComplete({ ...prefs, onboardingComplete: true })}
              className="w-full py-4 bg-black text-white rounded-xl font-bold text-sm tracking-tight"
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
    <div className="fixed inset-0 bg-[#f9f6f1] z-[100] flex flex-col max-w-md mx-auto overflow-hidden">
      {step > 0 && step < STEPS.length - 1 && (
        <div className="px-6 pt-8 pb-4">
          <div className="flex items-center justify-between mb-4">
            <button onClick={back} className="p-2 -ml-2 hover:bg-black/5 rounded-full transition-colors">
              <ArrowLeft size={20} />
            </button>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Step {step} of {STEPS.length - 2}</p>
            <div className="w-10" />
          </div>
          <div className="h-1 bg-black/5 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(step / (STEPS.length - 2)) * 100}%` }}
              className="h-full bg-black"
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
        <div className="p-6 bg-[#f9f6f1] border-t border-black/5">
          <button
            disabled={!isStepValid()}
            onClick={next}
            className="w-full py-4 bg-black text-white rounded-xl font-bold text-sm tracking-tight disabled:opacity-10 transition-all active:scale-95"
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}

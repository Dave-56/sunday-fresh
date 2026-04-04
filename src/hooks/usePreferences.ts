import { useState, useEffect } from 'react';
import { UserPreferences } from '../types';

const STORAGE_KEY = 'sunday_preferences';

const DEFAULT_PREFERENCES: UserPreferences = {
  householdSize: 'two',
  cuisines: ['Nigerian / West African', 'Asian (Chinese, Japanese, Korean, Thai)'],
  restrictions: ['No dairy / lactose intolerant'],
  prepTime: '2-3 hours',
  variety: 'Balanced — 70% familiar, 30% new',
  onboardingComplete: false,
  essentials: [],
  selectedEssentialCategories: [],
  zipCode: '',
};

export function usePreferences() {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setPreferences({
          ...DEFAULT_PREFERENCES,
          ...parsed,
          // Ensure essentials is always an array even if missing in saved data
          essentials: parsed.essentials || [],
          selectedEssentialCategories: parsed.selectedEssentialCategories || [],
        });
      } catch (e) {
        console.error('Failed to parse preferences', e);
      }
    }
    setIsLoaded(true);
  }, []);

  const savePreferences = (newPrefs: UserPreferences) => {
    setPreferences(newPrefs);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newPrefs));
  };

  return { preferences, savePreferences, isLoaded };
}

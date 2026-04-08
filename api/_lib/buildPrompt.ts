import { UserPreferences } from './types.js';

export interface WeeklyServingsTarget {
  min: number;
  max: number;
  target: number;
}

export function getWeeklyServingsTarget(householdSize: string): WeeklyServingsTarget {
  const h = (householdSize || '').toLowerCase();

  if (h.includes('just me')) {
    return { min: 6, max: 7, target: 6 };
  }
  if (h.includes('two')) {
    return { min: 10, max: 12, target: 11 };
  }
  if (h.includes('family') || h.includes('3') || h.includes('4')) {
    return { min: 14, max: 18, target: 16 };
  }
  return { min: 20, max: 24, target: 22 };
}

export function buildTeaserPrompt(preferences: UserPreferences, history: string[]): string {
  const { householdSize, cuisines, restrictions, variety } = preferences;
  const primaryCuisine = cuisines[0] || 'West African';
  const otherCuisines = cuisines.slice(1).join(", ");
  const servingsTarget = getWeeklyServingsTarget(householdSize);

  return `You are a world-class chef with deep, ancestral knowledge of ${primaryCuisine} and a curiosity for ${otherCuisines}.
Build a weekly meal plan for a household of size: ${householdSize}.

MENU ARCHITECTURE (MANDATORY):
- Dish 1 & 2: "Heritage Classics". Strictly authentic, traditional, and deep-heritage dishes from ${primaryCuisine}. No fusion, no "twists".
- Dish 3: "The Explorer". A dish from ${otherCuisines} or a sophisticated fusion that bridges ${primaryCuisine} with another culture.

MEAL-PREP QUALITY GUIDELINES (CRITICAL):
- Dishes MUST be "Meal-Prep Friendly": they must taste even better on Day 3.
- Format: Prioritize stews, braises, curries, hearty grain bowls, and slow-cooked bases.
- Reheatability: No delicate textures (no fried foods, no fresh salads that wilt, no seafood that gets rubbery).
- Batchability: Designed to be cooked in one large pot or tray to yield ${servingsTarget.min}-${servingsTarget.max} portions (target ${servingsTarget.target}) for the week.
- Dishes must be "Chef-Quality": vibrant flavors, balanced textures, and sophisticated spice profiles.
- Strict dietary rules: ${restrictions.join(", ")}.
- Variety preference: ${variety}.

Avoid these recent dishes: ${history.join(", ")}.

Return exactly 3 distinct dish options. For each dish, provide:
- name: Elegant, descriptive dish name
- cuisine: Specific region or style
- why: A 1-2 sentence evocative culinary description focusing on how the flavors develop over time
- difficulty: "Easy" or "Intermediate"
- prepTime: Total time including prep
- servings: Total portions as an integer in the ${servingsTarget.min}-${servingsTarget.max} range (target ${servingsTarget.target})
- type: "Heritage" (for dishes 1 & 2) or "Explorer" (for dish 3)
- servedWith: An object with a "primary" field — what this dish is traditionally served with (e.g., "Steamed jasmine rice", "Fufu or pounded yam", "Warm crusty bread"). Pick the single most authentic pairing. Also include an "alternatives" array with 2-3 other ways to enjoy this dish across the week (e.g., "Over steamed rice", "With boiled yam", "With garri (eba)"). Keep them short and practical for meal prep variety.`;
}

export function buildDetailPrompt(dish: any, preferences: UserPreferences): string {
  const { householdSize } = preferences;
  const servingsTarget = getWeeklyServingsTarget(householdSize);
  const targetServings = typeof dish?.servings === 'number'
    ? Math.round(dish.servings)
    : servingsTarget.target;
  const servedWithNote = dish.servedWith?.primary
    ? `\nThis dish is traditionally served with: ${dish.servedWith.primary}. End the final cooking section with a step like "Serve hot with ${dish.servedWith.primary}." Do NOT add the accompaniment to the ingredients list.`
    : '';

  return `You are a world-class culinary expert. Provide the full recipe details for: "${dish.name}" (${dish.cuisine}).
Household size: ${householdSize}. Target weekly yield: ${targetServings} portions (acceptable range ${servingsTarget.min}-${servingsTarget.max}).${servedWithNote}

INSTRUCTION GUIDELINES (MANDATORY):
- Break instructions into logical sections (e.g., "Prep & Aromatics", "The Base", "Slow Simmer", "Finishing & Storage").
- Each section must have a clear, evocative title.
- Steps within sections must be EXTREMELY DETAILED and granular. Do not combine multiple major actions into one step.
- Each step MUST include a "time" estimate (e.g., "5 mins", "15-20 mins", "Until fork-tender").
- Provide 3-4 sections per recipe, with 3-4 steps per section.
- Include specific techniques (e.g., "deglazing", "tempering spices", "reducing the base").
- Mention visual cues (e.g., "until the oil separates", "until the aromatics are fragrant", "until the beef is fork-tender").
- Explain the 'why' behind certain steps (e.g., "to remove the sourness of the tomatoes").
- The final section MUST focus on "Storage & Reheating" to ensure the dish stays perfect all week.
- Yield discipline: ingredient quantities MUST realistically produce about ${targetServings} portions, not a 2-3 day batch.

Return:
- ingredients: An array of structured ingredient objects, each with:
  - "display": Emoji-prefixed human-readable string (e.g., "🍅 2 Large Tomatoes, diced"). Scale quantities to the target weekly yield.
  - "item": The term you would type into a grocery store search bar to find this ingredient — not a description, not a brand, not a preparation method (e.g., "Tomatoes", "Coconut Milk", "Beef Brisket").
  - "searchTerms": Ordered list of search queries to try in a grocery store, starting with the most specific. Include the item name first, then common alternative names or related products (e.g., ["Scotch Bonnet Peppers", "Habanero Peppers"]).
  - "forbiddenForms": Product forms that would be WRONG for this recipe — forms that change the ingredient fundamentally (e.g., "ground" for whole peppers, "corned" for fresh brisket, "dried" for fresh herbs, "pickled" for raw ginger). Omit if no dangerous forms exist.
  - "qty": Numeric quantity needed (e.g., 2 for "2 cans", 3 for "3 peppers", 1 for "1/2 cup oil").
  - "qtyMode": How quantity maps to grocery cart items. Use "container" if the unit is a package you buy multiples of (cans, jars, bottles, bags, boxes). Use "unit-count" for discrete countable items (peppers, tomatoes, onions). Use "single-pack" for everything else — sub-units (cloves), measurements (cups, tsp), or bulk items where you buy one package regardless of recipe amount (oil, flour, spices).
- sections: The sectioned instructions as an array of objects with "title" and "steps" (each step is an object with "text" and "time").`;
}

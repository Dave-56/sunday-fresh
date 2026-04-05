import { UserPreferences } from './types.js';

export function buildTeaserPrompt(preferences: UserPreferences, history: string[]): string {
  const { householdSize, cuisines, restrictions, variety } = preferences;
  const primaryCuisine = cuisines[0] || 'West African';
  const otherCuisines = cuisines.slice(1).join(", ");

  return `You are a world-class chef with deep, ancestral knowledge of ${primaryCuisine} and a curiosity for ${otherCuisines}.
Build a weekly meal plan for a household of size: ${householdSize}.

MENU ARCHITECTURE (MANDATORY):
- Dish 1 & 2: "Heritage Classics". Strictly authentic, traditional, and deep-heritage dishes from ${primaryCuisine}. No fusion, no "twists".
- Dish 3: "The Explorer". A dish from ${otherCuisines} or a sophisticated fusion that bridges ${primaryCuisine} with another culture.

MEAL-PREP QUALITY GUIDELINES (CRITICAL):
- Dishes MUST be "Meal-Prep Friendly": they must taste even better on Day 3.
- Format: Prioritize stews, braises, curries, hearty grain bowls, and slow-cooked bases.
- Reheatability: No delicate textures (no fried foods, no fresh salads that wilt, no seafood that gets rubbery).
- Batchability: Designed to be cooked in one large pot or tray to yield 4-6 high-quality portions.
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
- servings: Total portions
- type: "Heritage" (for dishes 1 & 2) or "Explorer" (for dish 3)
- servedWith: An object with a "primary" field — what this dish is traditionally served with (e.g., "Steamed jasmine rice", "Fufu or pounded yam", "Warm crusty bread"). Pick the single most authentic pairing.`;
}

export function buildDetailPrompt(dish: any, preferences: UserPreferences): string {
  const { householdSize } = preferences;
  const servedWithNote = dish.servedWith?.primary
    ? `\nThis dish is traditionally served with: ${dish.servedWith.primary}. End the final cooking section with a step like "Serve hot with ${dish.servedWith.primary}." Do NOT add the accompaniment to the ingredients list.`
    : '';

  return `You are a world-class culinary expert. Provide the full recipe details for: "${dish.name}" (${dish.cuisine}).
Household size: ${householdSize}.${servedWithNote}

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

Return:
- ingredients: A list of ingredients scaled for the household size. Each ingredient MUST start with a relevant emoji (e.g., "🍅 2 Large Tomatoes, diced").
- sections: The sectioned instructions as an array of objects with "title" and "steps" (each step is an object with "text" and "time").`;
}

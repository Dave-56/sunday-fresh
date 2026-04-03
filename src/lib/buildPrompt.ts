import { UserPreferences } from '../types';

export function buildTeaserPrompt(preferences: UserPreferences, history: string[]): string {
  const { householdSize, cuisines, restrictions, variety } = preferences;
  const primaryCuisine = cuisines[0] || 'West African';
  const otherCuisines = cuisines.slice(1).join(", ");

  return `You are a world-class chef with deep, ancestral knowledge of ${primaryCuisine} and a curiosity for ${otherCuisines}.
Build a weekly meal plan for a household of size: ${householdSize}.

MENU ARCHITECTURE (MANDATORY):
- Dish 1 & 2: "Heritage Classics". Strictly authentic, traditional, and deep-heritage dishes from ${primaryCuisine}. No fusion, no "twists".
- Dish 3: "The Explorer". A dish from ${otherCuisines} or a sophisticated fusion that bridges ${primaryCuisine} with another culture.

CRITICAL QUALITY GUIDELINES:
- Dishes must be "Chef-Quality": vibrant flavors, balanced textures, and sophisticated spice profiles.
- Strict dietary rules: ${restrictions.join(", ")}.
- Variety preference: ${variety}.

Avoid these recent dishes: ${history.join(", ")}.

Return exactly 3 distinct dish options. For each dish, provide:
- name: Elegant, descriptive dish name
- cuisine: Specific region or style
- why: A 1-2 sentence evocative culinary description
- difficulty: "Easy" or "Intermediate"
- prepTime: Total time including prep
- servings: Total portions
- type: "Heritage" (for dishes 1 & 2) or "Explorer" (for dish 3)`;
}

export function buildDetailPrompt(dish: any, preferences: UserPreferences): string {
  const { householdSize } = preferences;

  return `You are a world-class culinary expert. Provide the full recipe details for: "${dish.name}" (${dish.cuisine}).
Household size: ${householdSize}.

INSTRUCTION GUIDELINES (MANDATORY):
- Break instructions into logical sections (e.g., "Prep & Aromatics", "The Base", "Slow Simmer", "Finishing & Storage").
- Each section must have a clear, evocative title.
- Steps within sections must be EXTREMELY DETAILED and granular. Do not combine multiple major actions into one step.
- Each step MUST include a "time" estimate (e.g., "5 mins", "15-20 mins", "Until fork-tender").
- Provide 3-4 sections per recipe, with 3-4 steps per section.
- Include specific techniques (e.g., "deglazing", "tempering spices", "reducing the base").
- Mention visual cues (e.g., "until the oil separates", "until the aromatics are fragrant", "until the beef is fork-tender").
- Explain the 'why' behind certain steps (e.g., "to remove the sourness of the tomatoes").

Return:
- ingredients: A list of ingredients scaled for the household size. Each ingredient MUST start with a relevant emoji (e.g., "🍅 2 Large Tomatoes, diced").
- sections: The sectioned instructions as an array of objects with "title" and "steps" (each step is an object with "text" and "time").`;
}

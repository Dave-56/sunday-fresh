export interface RecipeSection {
  title: string;
  steps: string[];
}

export interface Dish {
  name: string;
  cuisine: string;
  why: string;
  difficulty: "Easy" | "Intermediate";
  prepTime: string;
  servings: number;
  ingredients?: string[];
  sections?: RecipeSection[];
  imageUrl?: string;
  type: "Heritage" | "Explorer";
}

export interface HistoryItem {
  week: string;
  dish: Dish;
  date: string;
}

export interface UserPreferences {
  householdSize: string;
  cuisines: string[];
  restrictions: string[];
  prepTime: string;
  variety: string;
  onboardingComplete: boolean;
}

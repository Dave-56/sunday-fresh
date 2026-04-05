export interface RecipeStep {
  text: string;
  time?: string;
}

export interface RecipeSection {
  title: string;
  steps: RecipeStep[];
}

export interface Dish {
  name: string;
  cuisine: string;
  why: string;
  difficulty: "Easy" | "Intermediate";
  prepTime: string;
  servings: number;
  servedWith?: {
    primary: string;
    alternatives?: string[];
  };
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

export interface EssentialItem {
  id: string;
  name: string;
  quantity: string;
  category: 'Fruits & Veg' | 'Beverages' | 'Snacks' | 'Breakfast' | 'Dairy' | 'Pantry' | 'Bread & Bakery' | 'Proteins' | 'Frozen' | 'Household';
}

export interface UserPreferences {
  householdSize: string;
  cuisines: string[];
  restrictions: string[];
  prepTime: string;
  variety: string;
  onboardingComplete: boolean;
  essentials: EssentialItem[];
  selectedEssentialCategories: string[];
  zipCode: string;
}

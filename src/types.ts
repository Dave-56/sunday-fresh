export interface Dish {
  name: string;
  cuisine: string;
  why: string;
  difficulty: "Easy" | "Intermediate";
  prepTime: string;
  servings: number;
  ingredients: string[];
  steps: string[];
}

export interface HistoryItem {
  week: string;
  dish: Dish;
  date: string;
}

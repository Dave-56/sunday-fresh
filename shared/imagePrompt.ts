type PromptDish = {
  name: string;
  cuisine: string;
  servedWith?: {
    primary: string;
  };
};

export function buildFoodImagePrompt(dish: PromptDish): string {
  const accompaniment = dish.servedWith?.primary
    ? ` Include one small secondary bowl of ${dish.servedWith.primary}, clearly subordinate to the main dish.`
    : '';

  return `A museum-grade professional editorial food photograph of ${dish.name} (${dish.cuisine}). Top-down aerial view (flat lay) on a perfectly clean, solid minimalist background. Vibrant colors, natural bright lighting, macro textures.${accompaniment} COMPOSITION RULES: Everything must be fully visible within the frame. No cropping. Nothing cut off at the edges. Keep all vessels centered with generous padding from all edges (about 10-15% margin). Use elegant modern ceramic bowls or plates. STRICT MINIMALISM: No side garnishes, no lime wedges, no scattered herbs, no side piles of ingredients, no napkins, no cutlery. Only the food vessels and their contents. The food is the absolute hero. High-end culinary magazine style. No people.`;
}

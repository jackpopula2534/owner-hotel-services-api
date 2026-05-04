/**
 * Template list used by the "Auto Mockup" endpoint.
 *
 * The endpoint picks a random subset of 5–10 entries and inserts them as
 * MenuCategory rows for the requested restaurant. Names cover the common F&B
 * sections shown in StaySync hospitality demos so the dropdown in
 * "Add New Menu Item" can be populated quickly during onboarding.
 */
export interface MenuCategoryMockup {
  name: string;
  description: string;
  icon: string;
  color: string;
}

export const MENU_CATEGORY_MOCKUPS: ReadonlyArray<MenuCategoryMockup> = [
  {
    name: 'Appetizers',
    description: 'Light starters to whet the appetite',
    icon: 'utensils',
    color: '#F59E0B',
  },
  {
    name: 'Soups',
    description: 'Hot and hearty bowls to start the meal',
    icon: 'soup',
    color: '#FB923C',
  },
  {
    name: 'Salads',
    description: 'Fresh greens, grains, and seasonal produce',
    icon: 'leaf',
    color: '#10B981',
  },
  {
    name: 'Main Course',
    description: 'Signature dishes from the kitchen',
    icon: 'chef-hat',
    color: '#DC2626',
  },
  {
    name: 'Pasta',
    description: 'Hand-tossed Italian classics',
    icon: 'wheat',
    color: '#F97316',
  },
  {
    name: 'Pizza',
    description: 'Wood-fired pizzas and flatbreads',
    icon: 'pizza',
    color: '#EF4444',
  },
  {
    name: 'Seafood',
    description: 'Daily catch from local waters',
    icon: 'fish',
    color: '#0EA5E9',
  },
  {
    name: 'Grilled',
    description: 'Charcoal-grilled meats and skewers',
    icon: 'flame',
    color: '#B91C1C',
  },
  {
    name: 'Thai Dishes',
    description: 'Authentic Thai favorites',
    icon: 'leaf',
    color: '#16A34A',
  },
  {
    name: 'Desserts',
    description: 'Sweet treats and seasonal pastries',
    icon: 'cake',
    color: '#EC4899',
  },
  {
    name: 'Beverages',
    description: 'Soft drinks, juices, and refreshments',
    icon: 'cup-soda',
    color: '#8B5CF6',
  },
  {
    name: 'Cocktails',
    description: 'Signature cocktails and mocktails',
    icon: 'martini',
    color: '#A855F7',
  },
  {
    name: 'Wine',
    description: 'Curated red, white, and sparkling wines',
    icon: 'wine',
    color: '#7C2D12',
  },
  {
    name: 'Beer',
    description: 'Local drafts and bottled imports',
    icon: 'beer',
    color: '#CA8A04',
  },
  {
    name: 'Hot Drinks',
    description: 'Espresso, lattes, and teas',
    icon: 'coffee',
    color: '#92400E',
  },
  {
    name: 'Smoothies',
    description: 'Blended fruits and superfood bowls',
    icon: 'blender',
    color: '#DB2777',
  },
  {
    name: 'Kids Menu',
    description: 'Smaller portions for little guests',
    icon: 'baby',
    color: '#F472B6',
  },
  {
    name: 'Breakfast',
    description: 'Morning classics and brunch favorites',
    icon: 'egg',
    color: '#FBBF24',
  },
  {
    name: 'Snacks',
    description: 'Bites and shareable plates',
    icon: 'cookie',
    color: '#C2410C',
  },
  {
    name: "Chef's Specials",
    description: 'Rotating creations from the head chef',
    icon: 'star',
    color: '#9333EA',
  },
];

/**
 * Pick a random subset of `count` mockups using a uniform shuffle.
 * Exposed for unit testing — production code should use {@link sampleMenuCategoryMockups}
 * which clamps the count and seeds the RNG to Math.random.
 */
export function shuffleAndSlice<T>(
  source: ReadonlyArray<T>,
  count: number,
  rng: () => number = Math.random,
): T[] {
  const copy = source.slice();
  // Fisher–Yates shuffle.
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(Math.max(count, 0), copy.length));
}

/**
 * Returns 5–10 randomly selected category mockups (inclusive bounds).
 * If `requestedCount` is provided it is clamped to [5, 10] and to the size of
 * the template list, so callers cannot over- or under-request.
 */
export function sampleMenuCategoryMockups(
  requestedCount?: number,
  rng: () => number = Math.random,
): MenuCategoryMockup[] {
  const min = 5;
  const max = 10;

  const fallback = Math.floor(rng() * (max - min + 1)) + min;
  const raw = requestedCount ?? fallback;
  const clamped = Math.min(Math.max(raw, min), Math.min(max, MENU_CATEGORY_MOCKUPS.length));

  return shuffleAndSlice(MENU_CATEGORY_MOCKUPS, clamped, rng);
}

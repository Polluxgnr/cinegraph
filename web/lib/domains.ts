import type { Action } from "./store";

export interface DomainConfig {
  name: string;
  label: string;
  short: string;
  emoji: string;
  aspect: string; // card image aspect ratio
  seen: string; // "Seen it"
  unseen: string; // "Not seen"
  /** answer labels once seen */
  seenActions: [Action, string][];
  /** answer labels when not seen */
  unseenActions: [Action, string][];
  /** single-step domains (no "have you tried it?" question) */
  singleStep?: boolean;
}

const SEEN_DEFAULT: [Action, string][] = [
  ["loved", "Loved it"],
  ["liked", "Liked it"],
  ["ok", "It was ok"],
  ["disliked", "Not my thing"],
];

export const DOMAINS: DomainConfig[] = [
  {
    name: "films",
    label: "Films & series",
    short: "Films",
    emoji: "🎬",
    aspect: "2/3",
    seen: "Seen it",
    unseen: "Not seen",
    seenActions: [...SEEN_DEFAULT, ["watching", "Watching now"]],
    unseenActions: [
      ["want", "Add to my list"],
      ["maybe", "Could be down"],
      ["unknown", "No idea"],
      ["never", "Never"],
    ],
  },
  {
    name: "youtube",
    label: "Videos & docs",
    short: "Videos",
    emoji: "📺",
    aspect: "16/9",
    seen: "Watched",
    unseen: "Not yet",
    seenActions: SEEN_DEFAULT,
    unseenActions: [
      ["want", "Watch later"],
      ["maybe", "Maybe"],
      ["never", "Not interested"],
    ],
  },
  {
    name: "music",
    label: "Music",
    short: "Music",
    emoji: "🎧",
    aspect: "1/1",
    seen: "I know them",
    unseen: "Don't know",
    seenActions: [
      ["loved", "Love them"],
      ["liked", "Like them"],
      ["ok", "Meh"],
      ["disliked", "Not for me"],
    ],
    unseenActions: [
      ["want", "Discover"],
      ["maybe", "Maybe"],
      ["never", "Not my style"],
    ],
  },
  {
    name: "recipes",
    label: "Recipes",
    short: "Recipes",
    emoji: "🍳",
    aspect: "4/3",
    seen: "Cooked / eaten it",
    unseen: "Never tried",
    seenActions: [
      ["loved", "Delicious"],
      ["liked", "Good"],
      ["ok", "Meh"],
      ["disliked", "Not for me"],
    ],
    unseenActions: [
      ["want", "Want to cook it"],
      ["maybe", "Maybe"],
      ["never", "Never"],
    ],
  },
  {
    name: "places",
    label: "Destinations",
    short: "Travel",
    emoji: "🧭",
    aspect: "4/3",
    seen: "Been there",
    unseen: "Not yet",
    seenActions: [
      ["loved", "Loved it"],
      ["liked", "Liked it"],
      ["ok", "It was ok"],
      ["disliked", "Not for me"],
    ],
    unseenActions: [
      ["want", "Dream trip"],
      ["maybe", "Why not"],
      ["never", "Not interested"],
    ],
  },
  {
    name: "cars",
    label: "Dream garage",
    short: "Garage",
    emoji: "🏎️",
    aspect: "4/3",
    seen: "",
    unseen: "",
    singleStep: true,
    seenActions: [
      ["loved", "In my garage"],
      ["liked", "Love it"],
      ["ok", "Meh"],
      ["disliked", "Not for me"],
    ],
    unseenActions: [],
  },
  {
    name: "brands",
    label: "Style",
    short: "Style",
    emoji: "🧥",
    aspect: "4/3",
    seen: "",
    unseen: "",
    singleStep: true,
    seenActions: [
      ["loved", "My style"],
      ["want", "Want it"],
      ["liked", "I like it"],
      ["disliked", "Not my style"],
    ],
    unseenActions: [],
  },
];

export const DOMAIN = Object.fromEntries(DOMAINS.map((d) => [d.name, d])) as Record<string, DomainConfig>;

export function actionLabel(domain: string, a: Action): string {
  const d = DOMAIN[domain];
  return [...(d?.seenActions ?? []), ...(d?.unseenActions ?? [])].find(([x]) => x === a)?.[1] ?? a;
}

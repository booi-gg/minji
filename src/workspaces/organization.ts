export const DIFFICULTIES = ["easy", "medium", "hard", "super-hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  "super-hard": "Super hard",
};

export const isDifficulty = (value: unknown): value is Difficulty =>
  typeof value === "string" && (DIFFICULTIES as readonly string[]).includes(value);

export const MAX_FOLDER_LENGTH = 60;
export const MAX_TAG_LENGTH = 30;
export const MAX_TAGS = 20;

export const normalizeFolder = (value: string): string => value.trim().slice(0, MAX_FOLDER_LENGTH);

export const normalizeTags = (values: readonly string[]): string[] => {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = value.trim().slice(0, MAX_TAG_LENGTH);
    const key = tag.toLocaleLowerCase();
    if (tag === "" || seen.has(key)) continue;
    tags.push(tag);
    seen.add(key);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
};

export const parseTags = (text: string): string[] => normalizeTags(text.split(","));

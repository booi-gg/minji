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

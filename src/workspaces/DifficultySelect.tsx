import { DIFFICULTIES, DIFFICULTY_LABELS, isDifficulty, type Difficulty } from "./organization.ts";

interface DifficultySelectProps {
  id?: string;
  value: Difficulty | undefined;
  disabled?: boolean;
  onChange: (difficulty: Difficulty | undefined) => void;
}

/** Picks a difficulty, or none. Used by the toolbar, the review screen and Organize. */
export const DifficultySelect = ({ id, value, disabled, onChange }: DifficultySelectProps) => (
  <select
    id={id}
    value={value ?? ""}
    disabled={disabled}
    onChange={(event) =>
      onChange(isDifficulty(event.target.value) ? event.target.value : undefined)
    }
  >
    <option value="">No difficulty</option>
    {DIFFICULTIES.map((difficulty) => (
      <option key={difficulty} value={difficulty}>
        {DIFFICULTY_LABELS[difficulty]}
      </option>
    ))}
  </select>
);

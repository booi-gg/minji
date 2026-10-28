---
name: problem-file
description: Writes an importable minji problem file — Markdown by default, JSON or pasted text when asked. Use when asked to create a problem, an import file, or test data for the Import screen.
---

# Problem file

Writes one file that minji's **Import** screen turns into a problem with starter code and test cases, then proves it with the app's own parsers.

## Steps

1. **Pick the format.** Markdown (`.md`) unless the user names another:
   - "json" → `.json`. Also the only format that holds several problems, notes, or test options.
   - "txt", "text" or "paste" → `.txt`, shaped like a LeetCode page copied as plain text.
2. **Pick the path.** The one the user names; otherwise `examples/import/<kebab-title>.<ext>`.
3. **Write the file** from the matching template below. Every example needs an `Input` and an `Output`; add edge cases (empty, single item, negatives, duplicates) until the problem has 4–6 cases.
4. **Check it**: `vpx .claude/skills/problem-file/check.ts <path>`. Done when it ends with `Clean: imports as shown.`, the function name and params match the starter code, and every case shows ✓. A case the user asked to be broken is the only allowed ✗.
5. **Report** the path, how to import it (Upload file for `.md`/`.json`; Paste text for `.txt`), and the checker's summary lines.

## Values

Inputs and outputs are JSON: strings in double quotes, `true`/`false`/`null`, arrays in brackets. Multiple arguments are `name = value` pairs separated by commas, named exactly as the starter code's parameters.

## Markdown template

````markdown
# Valid Palindrome

**Difficulty:** Easy

Given a string `s`, return `true` if it reads the same forward and backward…

```typescript
function isPalindrome(s: string): boolean {}
```

**Example 1:**

```
Input: s = "racecar"
Output: true
```

**Constraints:**

- `1 <= s.length <= 10^5`
````

- The first `#` heading is the title.
- A `**Difficulty:** Easy` line sets the difficulty: `Easy`, `Medium`, `Hard` or `Super hard`. Include it when the user names a difficulty or the problem's level is well known.
- The first code fence tagged `typescript`/`ts` or `javascript`/`js` is the starter code: its tag sets the language and its signature sets the function name and parameter order.
- `Input:` and `Output:` sit on consecutive lines; a blank line ends a field. Put any explanation after `Output:`.

## Text template

```text
125. Valid Palindrome
Easy
Given a string s, return true if it reads the same forward and backward…

Example 1:

Input: s = "racecar"
Output: true
Explanation: …
Example 2:

Input: s = "abc"
Output: false

Constraints:

1 <= s.length <= 10^5
```

The first line is the title (a leading `125. ` is dropped). A line that is only `Easy`, `Medium`, `Hard` or `Super hard` sets the difficulty. Plain text has no starter code, so Import names the function `solve` and guesses the parameters from the examples. Tell the user to paste the signature into the **Starter code** box to set them.

## JSON template

```json
{
  "format": "minji.workspaces",
  "version": 1,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "workspaces": [
    {
      "title": "Valid Palindrome",
      "statement": "Given a string `s`, return `true` if…",
      "notes": "",
      "difficulty": "easy",
      "language": "typescript",
      "functionName": "isPalindrome",
      "params": ["s"],
      "source": "function isPalindrome(s: string): boolean {\n  \n}\n",
      "starterSource": "function isPalindrome(s: string): boolean {\n  \n}\n",
      "tests": [{ "label": "odd length", "args": ["racecar"], "expected": true }]
    }
  ]
}
```

- `difficulty` is `easy`, `medium`, `hard` or `super-hard`, or left out.
- `args` is the array of all arguments in parameter order: `[[2, 7, 11, 15], 9]` for `(nums, target)`.
- A string in `args` or `expected` is raw editor text, not a value. An answer that is itself a string is written with its quotes escaped: `"expected": "\"abc\""`. A string `args` value is how to make a deliberately broken case: `"args": "[1,"`.
- For in-place problems add `"compare": { "kind": "argument", "index": 0 }` to each test to compare the first argument after the call.
- Several problems go in one `workspaces` array; Import then offers a checklist.

## Rules beyond these templates

The parser's full rules (titles, examples, in-place detection, class method sequences) live in `specs/workspaces-and-import.md` and `specs/test-cases.md`; the JSON format lives in `specs/data-model.md`, "Export format".

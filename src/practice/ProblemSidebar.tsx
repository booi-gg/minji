import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Link } from "react-router";
import { getDatabase } from "../db/database.ts";
import { listWorkspaces } from "../db/workspaces.ts";
import { subscribeToChannel } from "../shared/channel.ts";
import { displayTitle, type Workspace } from "../workspaces/model.ts";
import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty } from "../workspaces/organization.ts";

/** Only what a row shows, so the list never holds sources or statements. */
interface ProblemSummary {
  id: string;
  title: string;
  lastRun: Workspace["lastRun"];
  difficulty: Difficulty | undefined;
  tags: string[];
}

type SortOrder = "recent" | "easiest" | "hardest" | "title";

const SORT_LABELS: Record<SortOrder, string> = {
  recent: "Recent",
  easiest: "Easiest first",
  hardest: "Hardest first",
  title: "Title A–Z",
};

const ALL_TAGS = "";
const VIEW_KEY = "minji:sidebar-view";

/** Fits the narrow sidebar; the full name is in the row's accessible text. */
const DIFFICULTY_SHORT: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Med",
  hard: "Hard",
  "super-hard": "Super",
};

/** Rank for sorting; problems without a difficulty go last either way. */
const difficultyRank = (difficulty: Difficulty | undefined, direction: 1 | -1): number =>
  difficulty === undefined ? Infinity : direction * DIFFICULTIES.indexOf(difficulty);

const sortProblems = (problems: ProblemSummary[], order: SortOrder): ProblemSummary[] => {
  // The stored list is already newest first; toSorted is stable, so ties keep that order.
  if (order === "recent") return problems;
  if (order === "title") return problems.toSorted((a, b) => a.title.localeCompare(b.title));
  const direction = order === "easiest" ? 1 : -1;
  return problems.toSorted(
    (a, b) => difficultyRank(a.difficulty, direction) - difficultyRank(b.difficulty, direction),
  );
};

interface SidebarView {
  sort: SortOrder;
  tag: string;
}

const readView = (): SidebarView => {
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") as Partial<SidebarView>;
    return {
      sort: stored.sort !== undefined && stored.sort in SORT_LABELS ? stored.sort : "recent",
      tag: typeof stored.tag === "string" ? stored.tag : ALL_TAGS,
    };
  } catch {
    return { sort: "recent", tag: ALL_TAGS };
  }
};

const saveView = (view: SidebarView): void => {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // Storage can be unavailable; the choice still applies for this visit.
  }
};

type RunState = "solved" | "attempted" | "none";

const summarize = (workspace: Workspace): ProblemSummary => ({
  id: workspace.id,
  title: displayTitle(workspace),
  lastRun: workspace.lastRun,
  difficulty: workspace.difficulty,
  tags: workspace.tags ?? [],
});

const runState = (lastRun: Workspace["lastRun"]): RunState => {
  if (lastRun === null || lastRun.total === 0) return "none";
  return lastRun.passed === lastRun.total ? "solved" : "attempted";
};

const RUN_LABELS: Record<RunState, string> = {
  solved: "All tests passed",
  attempted: "Some tests failing",
  none: "Not run yet",
};

interface RowProps {
  problem: ProblemSummary;
  active: boolean;
}

const ProblemRow = memo(({ problem, active }: RowProps) => {
  const state = runState(problem.lastRun);
  return (
    <li className="sidebar-row">
      <Link
        to={`/w/${problem.id}`}
        className={`sidebar-link${active ? " sidebar-link-active" : ""}`}
        aria-current={active ? "page" : undefined}
        title={problem.title}
      >
        <span className={`run-dot run-dot-${state}`} aria-hidden="true" />
        <span className="visually-hidden">{RUN_LABELS[state]}: </span>
        <span className="sidebar-title">{problem.title}</span>
        {problem.difficulty === undefined ? null : (
          <span className={`sidebar-difficulty difficulty-${problem.difficulty}`}>
            <span aria-hidden="true">{DIFFICULTY_SHORT[problem.difficulty]}</span>
            <span className="visually-hidden">, {DIFFICULTY_LABELS[problem.difficulty]}</span>
          </span>
        )}
      </Link>
    </li>
  );
});

const useProblems = (): ProblemSummary[] | null => {
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadAll = async (): Promise<void> => {
      const all = await listWorkspaces(await getDatabase());
      if (!cancelled) setProblems(all.map(summarize));
    };
    // A single change only needs that one record, not the whole list.
    const refresh = async (id: string): Promise<void> => {
      const stored = await (await getDatabase()).get("workspaces", id);
      if (cancelled) return;
      setProblems((current) => {
        if (current === null) return current;
        if (stored === undefined || stored.deletedAt !== null) {
          return current.filter((problem) => problem.id !== id);
        }
        // Edits keep their place, so the list doesn't jump while typing; new problems go first.
        const next = summarize(stored);
        const index = current.findIndex((problem) => problem.id === id);
        if (index === -1) return [next, ...current];
        return current.with(index, next);
      });
    };
    void loadAll();
    const unsubscribe = subscribeToChannel((message) => {
      if (message.type === "changed") void refresh(message.id);
      else if (message.type === "sync-complete") void loadAll();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return problems;
};

interface ProblemSidebarProps {
  activeId: string;
}

/** Lists every problem beside the editor. See specs/practice-editor.md, "Sidebar". */
export const ProblemSidebar = ({ activeId }: ProblemSidebarProps) => {
  const problems = useProblems();
  const [query, setQuery] = useState("");
  const [view, setView] = useState(readView);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const listRef = useRef<HTMLUListElement>(null);

  const changeView = (change: Partial<SidebarView>): void => {
    const next = { ...view, ...change };
    setView(next);
    saveView(next);
  };

  const loaded = problems !== null;
  const tags = useMemo(
    () =>
      [...new Set((problems ?? []).flatMap((problem) => problem.tags))].toSorted((a, b) =>
        a.localeCompare(b),
      ),
    [problems],
  );
  // A tag that no problem has any more shows everything rather than an empty list.
  const tag = tags.includes(view.tag) ? view.tag : ALL_TAGS;
  const visible = useMemo(() => {
    if (problems === null) return null;
    const matching = problems.filter(
      (problem) =>
        (tag === ALL_TAGS || problem.tags.includes(tag)) &&
        (deferredQuery === "" || problem.title.toLowerCase().includes(deferredQuery)),
    );
    return sortProblems(matching, view.sort);
  }, [problems, tag, deferredQuery, view.sort]);
  const filtered = query !== "" || tag !== ALL_TAGS;

  useEffect(() => {
    listRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [activeId, loaded]);

  return (
    <nav className="sidebar" aria-label="Problems">
      <div className="sidebar-header">
        <Link className="sidebar-heading" to="/" aria-label="All problems">
          Problems
        </Link>
        <Link
          className="button button-quiet icon-button"
          to="/new"
          aria-label="New problem"
          data-tooltip="New problem"
        >
          <Plus size={16} aria-hidden="true" />
        </Link>
      </div>
      <label className="sidebar-search">
        <Search size={14} aria-hidden="true" />
        <span className="visually-hidden">Search problems</span>
        <input
          type="search"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="sidebar-controls">
        <label className="sidebar-control">
          <span className="visually-hidden">Sort problems</span>
          <select
            value={view.sort}
            onChange={(event) => changeView({ sort: event.target.value as SortOrder })}
          >
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="sidebar-control">
          <span className="visually-hidden">Filter by tag</span>
          <select
            value={tag}
            disabled={tags.length === 0}
            onChange={(event) => changeView({ tag: event.target.value })}
          >
            <option value={ALL_TAGS}>{tags.length === 0 ? "No tags" : "All tags"}</option>
            {tags.map((name) => (
              <option key={name} value={name}>
                #{name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {visible === null ? null : visible.length === 0 ? (
        <p className="hint sidebar-empty">{filtered ? "No matches." : "No problems yet."}</p>
      ) : (
        <ul ref={listRef} className="sidebar-list">
          {visible.map((problem) => (
            <ProblemRow key={problem.id} problem={problem} active={problem.id === activeId} />
          ))}
        </ul>
      )}
    </nav>
  );
};

import { memo, useDeferredValue, useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Link } from "react-router";
import { getDatabase } from "../db/database.ts";
import { listWorkspaces } from "../db/workspaces.ts";
import { subscribeToChannel } from "../shared/channel.ts";
import { displayTitle, type Workspace } from "../workspaces/model.ts";

/** Only what a row shows, so the list never holds sources or statements. */
interface ProblemSummary {
  id: string;
  title: string;
  lastRun: Workspace["lastRun"];
}

type RunState = "solved" | "attempted" | "none";

const summarize = (workspace: Workspace): ProblemSummary => ({
  id: workspace.id,
  title: displayTitle(workspace),
  lastRun: workspace.lastRun,
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
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const listRef = useRef<HTMLUListElement>(null);

  const loaded = problems !== null;
  const visible =
    problems === null || deferredQuery === ""
      ? problems
      : problems.filter((problem) => problem.title.toLowerCase().includes(deferredQuery));

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
      {visible === null ? null : visible.length === 0 ? (
        <p className="hint sidebar-empty">{query === "" ? "No problems yet." : "No matches."}</p>
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

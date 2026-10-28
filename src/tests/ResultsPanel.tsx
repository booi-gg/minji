import type { RunView } from "../practice/useTestRun.ts";
import { formatFrame, userFrames } from "../runner/stack.ts";
import { formatEncoded } from "./compare.ts";
import { splitArguments } from "./arguments.ts";
import { summarize, type TestResult, type TestStatus } from "./results.ts";

const formatDuration = (ms: number): string => (ms < 1 ? "<1 ms" : `${Math.round(ms)} ms`);

const TIMING_NOTE = "Local timing on this device, for comparison between your own runs only.";

const STATUS_LABELS: Record<TestStatus, string> = {
  passed: "Passed",
  failed: "Failed",
  error: "Error",
  timeout: "Timed out",
  "non-serializable": "Can't compare",
  "missing-function": "No function",
  "stack-overflow": "Stack overflow",
  "memory-limit": "Out of memory",
  "output-too-large": "Too large",
  "invalid-test": "Invalid test",
  stopped: "Stopped",
  crashed: "Runner crashed",
};

const statusTone = (status: TestStatus): "pass" | "fail" | "warn" => {
  if (status === "passed") return "pass";
  if (status === "failed" || status === "error") return "fail";
  return "warn";
};

interface DetailProps {
  result: TestResult;
  functionName: string;
  timeoutMs: number;
  onGoToLine: (line: number) => void;
}

const ValueBlock = ({ label, value }: { label: string; value: TestResult["expected"] }) => (
  <div className="value-block">
    <span className="field-label">{label}</span>
    <pre>{value === undefined ? "—" : formatEncoded(value)}</pre>
  </div>
);

const ErrorDetail = ({ result, onGoToLine }: Pick<DetailProps, "result" | "onGoToLine">) => {
  const frames = userFrames(result.error?.stack);
  return (
    <div className="result-detail">
      <p className="result-error">
        {result.error?.name}: {result.error?.message}
      </p>
      {frames.length === 0 ? null : (
        <ul className="frames">
          {frames.map((frame, index) => (
            // Frames have no identity beyond their position in the stack.
            // oxlint-disable-next-line react/no-array-index-key
            <li key={index}>
              {frame.line === undefined ? (
                formatFrame(frame)
              ) : (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onGoToLine(frame.line ?? 1)}
                >
                  {formatFrame(frame)}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const ResultDetail = ({ result, functionName, timeoutMs, onGoToLine }: DetailProps) => {
  switch (result.status) {
    case "passed":
      return (
        <div className="result-detail value-pair">
          <ValueBlock label="Expected output" value={result.expected} />
          <ValueBlock label="Actual output" value={result.actual} />
        </div>
      );
    case "failed":
      return (
        <div className="result-detail">
          <p>
            {result.diffPath === ""
              ? "The values differ."
              : `First difference at ${result.diffPath}`}
          </p>
          <div className="value-pair">
            <ValueBlock label="Expected output" value={result.expected} />
            <ValueBlock label="Actual output" value={result.actual} />
          </div>
        </div>
      );
    case "error":
      return <ErrorDetail result={result} onGoToLine={onGoToLine} />;
    case "timeout":
      return (
        <p className="result-detail">
          Stopped after {timeoutMs / 1000} s. Look for an infinite loop or a slower-than-expected
          algorithm.
        </p>
      );
    case "non-serializable":
      return (
        <p className="result-detail">
          The function returned a {result.nonSerializable?.type ?? "value"}
          {result.nonSerializable?.path ? ` at ${result.nonSerializable.path}` : ""}, which can't be
          compared as JSON. Return arrays, plain objects, strings, numbers, booleans or null.
        </p>
      );
    case "missing-function":
      return (
        <p className="result-detail">
          No function named "{functionName}" was found. Check the entry point in More.
        </p>
      );
    case "stack-overflow":
      return (
        <p className="result-detail">
          Maximum call stack size exceeded. Browsers allow only a few thousand nested calls here, so
          check the base case or switch to an explicit stack.
        </p>
      );
    case "memory-limit":
      return <p className="result-detail">The test ran out of memory.</p>;
    case "output-too-large":
      return <p className="result-detail">The return value is larger than the 8 MB limit.</p>;
    case "invalid-test":
      return <p className="result-detail">{result.error?.message}</p>;
    case "stopped":
      return <p className="result-detail">The run was stopped.</p>;
    case "crashed":
      return <p className="result-detail">The runner stopped responding and was restarted.</p>;
    default:
      return result.status satisfies never;
  }
};

interface ResultsPanelProps {
  view: RunView | null;
  functionName: string;
  timeoutMs: number;
  params: readonly string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onGoToLine: (line: number) => void;
}

const headline = (view: RunView, results: TestResult[]): string => {
  if (view.message !== null) return view.message.text;
  if (view.running) return `Running… ${results.length} of ${view.order.length}`;
  if (view.outcome === "stopped") return `Stopped · ${summarize(view.scope, results)}`;
  return summarize(view.scope, results);
};

/** The Results tab. See specs/test-cases.md, "Statuses" and "Run summary". */
export const ResultsPanel = ({
  view,
  functionName,
  timeoutMs,
  params,
  selectedId,
  onSelect,
  onGoToLine,
}: ResultsPanelProps) => {
  if (view === null) {
    return (
      <p className="hint" role="status">
        No results yet. Use Run all or a test's Run button.
      </p>
    );
  }
  const results = view.order.flatMap(({ id }) => view.results.get(id) ?? []);
  const line = view.message?.line;
  const selected = view.order.find(({ id }) => id === selectedId) ?? view.order[0];
  const selectedResult = selected === undefined ? undefined : view.results.get(selected.id);
  const inputs = selected === undefined ? null : splitArguments(selected.argsText);

  return (
    <div className="results">
      <div className="results-summary">
        <p
          role="status"
          aria-live="polite"
          className={view.message === null ? "summary" : "summary summary-error"}
        >
          {headline(view, results)}
        </p>
        {line === undefined ? null : (
          <button type="button" className="button button-small" onClick={() => onGoToLine(line)}>
            Go to line {line}
          </button>
        )}
      </div>
      <div className="case-picker" role="group" aria-label="Test results">
        {view.order.map(({ id, label }) => {
          const result = view.results.get(id);
          return (
            <button
              key={id}
              type="button"
              className={`case-tab${selected?.id === id ? " case-tab-active" : ""}`}
              aria-current={selected?.id === id ? "true" : undefined}
              onClick={() => onSelect(id)}
            >
              {label}
              {result === undefined ? "" : result.status === "passed" ? " ✓" : " ✕"}
            </button>
          );
        })}
      </div>
      {selected === undefined ? null : (
        <div className="result-row">
          <div className="result-header">
            <span
              className={`status status-${selectedResult === undefined ? "pending" : statusTone(selectedResult.status)}`}
            >
              {selectedResult === undefined
                ? view.running
                  ? "Running…"
                  : "Not run"
                : STATUS_LABELS[selectedResult.status]}
            </span>
            <span className="result-label">{selected.label}</span>
            {selectedResult?.durationMs === null ||
            selectedResult?.durationMs === undefined ? null : (
              <span className="duration" title={TIMING_NOTE}>
                {formatDuration(selectedResult.durationMs)}
              </span>
            )}
          </div>
          <div className="result-inputs">
            {inputs === null ? (
              <div className="value-block">
                <span className="field-label">Input</span>
                <pre>{selected.argsText}</pre>
              </div>
            ) : inputs.length === 0 ? (
              <div className="value-block">
                <span className="field-label">Input</span>
                <pre>No arguments</pre>
              </div>
            ) : (
              inputs.map((input, index) => (
                <div key={index} className="value-block">
                  <span className="field-label">{params[index] ?? `Argument ${index + 1}`} =</span>
                  <pre>{input}</pre>
                </div>
              ))
            )}
          </div>
          {selectedResult === undefined ? null : (
            <ResultDetail
              result={selectedResult}
              functionName={functionName}
              timeoutMs={timeoutMs}
              onGoToLine={onGoToLine}
            />
          )}
        </div>
      )}
    </div>
  );
};

/** The Console tab: output grouped by test. */
export const ConsolePanel = ({ view }: { view: RunView | null }) => {
  const withOutput = (view?.order ?? []).flatMap(({ id, label }) => {
    const result = view?.results.get(id);
    return result === undefined || result.console.length === 0 ? [] : [{ id, label, result }];
  });
  if (withOutput.length === 0) return <p className="hint">No console output.</p>;
  return (
    <div className="console">
      {withOutput.map(({ id, label, result }) => (
        <section key={id} className="console-group" aria-label={`Console output of ${label}`}>
          <h3 className="console-heading">{label}</h3>
          <pre className="console-lines">
            {result.console.map((entry, index) => (
              // Console lines have no identity beyond their order.
              // oxlint-disable-next-line react/no-array-index-key
              <span key={index} className={`console-line console-${entry.level}`}>
                {entry.text}
                {"\n"}
              </span>
            ))}
          </pre>
          {result.consoleTruncated ? <p className="hint">Output truncated at 16 KB.</p> : null}
        </section>
      ))}
    </div>
  );
};

import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { getDatabase } from "../db/database.ts";
import { getBundle } from "../db/workspaces.ts";
import { displayTitle, type TestCase } from "../workspaces/model.ts";

export const practiceLoader = async ({ params }: LoaderFunctionArgs) => {
  const bundle =
    params.id === undefined ? undefined : await getBundle(await getDatabase(), params.id);
  return { bundle: bundle ?? null };
};

const compareText = (test: TestCase): string =>
  test.compare.kind === "return"
    ? "Return value"
    : `Argument ${test.compare.index + 1} after the call`;

const TestTable = ({ tests }: { tests: TestCase[] }) => (
  <table className="test-table">
    <thead>
      <tr>
        <th scope="col">Test</th>
        <th scope="col">Arguments</th>
        <th scope="col">Expected</th>
        <th scope="col">Compare</th>
      </tr>
    </thead>
    <tbody>
      {tests.map((test) => (
        <tr key={test.id}>
          <td>{test.label === "" ? `Test ${test.position + 1}` : test.label}</td>
          <td>
            <code>{test.argsText}</code>
          </td>
          <td>
            <code>{test.expectedText}</code>
          </td>
          <td>{compareText(test)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

/** Read-only view of a workspace. The editor, tests panel and runner arrive in steps 2 and 3. */
export const PracticePage = () => {
  const { bundle } = useLoaderData<typeof practiceLoader>();

  if (bundle === null) {
    return (
      <main className="page">
        <h1>Workspace not found</h1>
        <p className="page-intro">This workspace doesn't exist or was deleted.</p>
        <p>
          <Link to="/">Back to my workspaces</Link>
        </p>
      </main>
    );
  }

  const { workspace, tests } = bundle;
  return (
    <main className="page">
      <div className="page-heading">
        <h1>{displayTitle(workspace)}</h1>
        <Link className="button" to="/">
          All workspaces
        </Link>
      </div>
      <p className="page-intro">
        <span className="badge">
          {workspace.language === "typescript" ? "TypeScript" : "JavaScript"}
        </span>{" "}
        Calls <code>{workspace.functionName}</code>
      </p>

      {workspace.statement === "" ? null : (
        <section className="section" aria-labelledby="statement-heading">
          <h2 id="statement-heading">Statement</h2>
          <div className="prose-block">{workspace.statement}</div>
        </section>
      )}

      {workspace.notes === "" ? null : (
        <section className="section" aria-labelledby="notes-heading">
          <h2 id="notes-heading">Notes</h2>
          <div className="prose-block">{workspace.notes}</div>
        </section>
      )}

      <section className="section" aria-labelledby="code-heading">
        <h2 id="code-heading">Code</h2>
        <pre className="code-block">{workspace.source}</pre>
      </section>

      <section className="section" aria-labelledby="tests-heading">
        <h2 id="tests-heading">Tests</h2>
        {tests.length === 0 ? <p className="hint">No tests yet.</p> : <TestTable tests={tests} />}
      </section>
    </main>
  );
};

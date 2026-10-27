import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { getDatabase } from "../db/database.ts";
import { createScratchWorkspace } from "./actions.ts";

export const NewWorkspacePage = () => {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const startScratch = async (): Promise<void> => {
    setCreating(true);
    try {
      const id = await createScratchWorkspace(await getDatabase());
      await navigate(`/w/${id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="page">
      <div className="page-heading">
        <h1>New workspace</h1>
      </div>
      <div className="choices">
        <button
          type="button"
          className="choice"
          onClick={() => void startScratch()}
          disabled={creating}
        >
          <span className="choice-title">Start from scratch</span>
          <span className="choice-description">
            A blank editor with a <code>solve</code> function. Name it and add tests as you go.
          </span>
        </button>
        <Link className="choice" to="/new/import">
          <span className="choice-title">Import problem</span>
          <span className="choice-description">
            Bring a problem file with its statement, starter code and tests.
          </span>
        </Link>
      </div>
    </main>
  );
};

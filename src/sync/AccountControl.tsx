import { useSync } from "./SyncProvider.tsx";

export const AccountControl = () => {
  const { account, loading, signOut, sync } = useSync();
  if (loading)
    return (
      <span className="hint" role="status">
        Checking account…
      </span>
    );
  if (account === null)
    return (
      <a className="button" href="/api/auth/github/login">
        <img
          className="github-signin-icon"
          src="/GitHub_Invertocat_Black.svg"
          alt=""
          width="20"
          height="20"
        />
      </a>
    );
  return (
    <div className="account-control">
      <details className="account-menu">
        <summary className="button">
          {account.avatarUrl === null ? null : (
            <img src={account.avatarUrl} alt="" width="24" height="24" />
          )}{" "}
          {account.login}
        </summary>
        <div className="account-menu-items">
          <button type="button" className="button button-quiet" onClick={sync}>
            Sync now
          </button>
          <button type="button" className="button button-quiet" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </details>
    </div>
  );
};

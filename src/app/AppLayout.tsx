import { Link, Outlet, isRouteErrorResponse, useRouteError } from "react-router";
import { ToastProvider } from "../shared/toast.tsx";
import { SyncProvider } from "../sync/SyncProvider.tsx";
import { ConnectionStatus } from "../sync/ConnectionStatus.tsx";

const Brand = () => (
  <Link className="brand" to="/" aria-label="minji: all workspaces">
    minji
  </Link>
);

export const AppLayout = () => (
  <ToastProvider>
    <SyncProvider>
      <div className="app">
        <Outlet />
        <footer className="app-footer">
          <ConnectionStatus />
          <Brand />
        </footer>
      </div>
    </SyncProvider>
  </ToastProvider>
);

export const NotFoundPage = () => (
  <main className="page">
    <h1>Page not found</h1>
    <p>
      <Link to="/">Back to my workspaces</Link>
    </p>
  </main>
);

export const ErrorPage = () => {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Unknown error";
  return (
    <div className="app">
      <main className="page">
        <h1>Something went wrong</h1>
        <p className="page-intro">{message}</p>
        <p>
          <Link to="/">Back to my workspaces</Link>
        </p>
      </main>
      <footer className="app-footer">
        <Brand />
      </footer>
    </div>
  );
};

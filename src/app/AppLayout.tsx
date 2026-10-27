import { Link, Outlet, isRouteErrorResponse, useRouteError } from "react-router";
import { ToastProvider } from "../shared/toast.tsx";

// No top bar: the app name is a small link in the bottom-right corner.
const Brand = () => (
  <Link className="brand" to="/" aria-label="minji: all workspaces">
    minji
  </Link>
);

export const AppLayout = () => (
  <ToastProvider>
    <div className="app">
      <Outlet />
      <Brand />
    </div>
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
      <Brand />
    </div>
  );
};

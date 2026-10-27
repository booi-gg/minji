import { Link, Outlet, isRouteErrorResponse, useRouteError } from "react-router";
import { ToastProvider } from "../shared/toast.tsx";

const Header = () => (
  <header className="app-header">
    <div className="app-header-inner">
      <Link className="brand" to="/">
        minji
      </Link>
    </div>
  </header>
);

export const AppLayout = () => (
  <ToastProvider>
    <div className="app">
      <Header />
      <Outlet />
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
      <Header />
      <main className="page">
        <h1>Something went wrong</h1>
        <p className="page-intro">{message}</p>
        <p>
          <Link to="/">Back to my workspaces</Link>
        </p>
      </main>
    </div>
  );
};

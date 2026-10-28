import { createBrowserRouter } from "react-router";
import { ImportPage } from "../import/ImportPage.tsx";
import { HomePage, homeLoader } from "../workspaces/HomePage.tsx";
import { NewWorkspacePage } from "../workspaces/NewWorkspacePage.tsx";
import { AppLayout, ErrorPage, NotFoundPage } from "./AppLayout.tsx";

// Routes from specs/practice-editor.md. The practice route is lazy so the editor and
// runner stay out of the home-screen bundle.
export const router = createBrowserRouter([
  {
    path: "/",
    Component: AppLayout,
    ErrorBoundary: ErrorPage,
    // Loaders read IndexedDB before the first render; nothing to show for that instant.
    HydrateFallback: () => null,
    children: [
      { index: true, Component: HomePage, loader: homeLoader },
      { path: "new", Component: NewWorkspacePage },
      { path: "new/import", Component: ImportPage },
      {
        path: "w/:id",
        lazy: async () => {
          const { PracticePage, practiceLoader } = await import("../practice/PracticePage.tsx");
          return { Component: PracticePage, loader: practiceLoader };
        },
      },
      { path: "*", Component: NotFoundPage },
    ],
  },
]);

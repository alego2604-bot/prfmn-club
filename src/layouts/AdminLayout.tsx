import { Outlet, useMatches } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AdminLayout() {
  const matches = useMatches();
  const title = (matches.at(-1)?.handle as { title?: string } | undefined)?.title ?? "PRFMN Club";

  return (
    <div className="flex h-screen bg-canvas">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto max-w-7xl px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

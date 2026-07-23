import { useEffect, useState } from "react";
import { Outlet, useLocation, useMatches } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MobileNav } from "./MobileNav";

export function AdminLayout() {
  const matches = useMatches();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const title = (matches.at(-1)?.handle as { title?: string } | undefined)?.title ?? "PRFMN Club";

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-canvas">
      <Sidebar />
      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

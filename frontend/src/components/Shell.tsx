import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    "rounded-control px-3 py-2 text-sm font-medium transition-colors",
    isActive ? "text-ink" : "text-ink-muted hover:text-ink",
  ].join(" ");

/** Header, navigation and footer around every route. */
export function Shell() {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const firstRender = useRef(true);

  // After a route change, put the reader at the top of the new page. Not on first load.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="rounded-control bg-accent text-on-accent sr-only z-10 px-4 py-2 font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <div aria-hidden="true" className="bg-horizon h-1" />
      <header className="px-gutter md:px-gutter-wide">
        <div className="max-w-page mx-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-4">
          {/* "/" will be the Climb (ticket #14); until then the wordmark goes to the Summary. */}
          <Link
            to="/summary"
            className="rounded-control text-lg font-semibold tracking-snug press -mx-2 px-2 py-1"
          >
            Ali Saleh
          </Link>
          <nav aria-label="Main" className="-mx-3 flex">
            <NavLink to="/summary" className={navLinkClass}>
              Summary
            </NavLink>
          </nav>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="flex-1">
        <Outlet />
      </main>
      <footer className="border-line text-ink-muted border-t px-gutter md:px-gutter-wide">
        <div className="max-w-page mx-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-6 text-sm">
          <p>Ali Saleh, AI development specialist.</p>
          <a href="#main" className="link">
            Back to top
          </a>
        </div>
      </footer>
    </div>
  );
}

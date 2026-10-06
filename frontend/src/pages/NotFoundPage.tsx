import { Link } from "react-router";

import { unlistedHead } from "../head/model";
import { useHead } from "../head/useHead";

export function NotFoundPage() {
  useHead(unlistedHead("Page not found"));
  return (
    <div className="px-gutter md:px-gutter-wide py-section md:py-section-wide">
      <div className="max-w-page mx-auto">
        <h1 className="text-2xl font-semibold tracking-snug">Page not found</h1>
        <p className="text-ink-muted mt-3 max-w-measure">
          There is no page at this address.
        </p>
        <p className="mt-6">
          <Link to="/summary" className="link">
            Go to the Summary
          </Link>
        </p>
      </div>
    </div>
  );
}

import { ContactSection } from "../components/ContactSection";
import type { Links } from "../api/types";
import { padClass } from "./StageSection";

/**
 * The Summit, ahead and out of reach, then the contact section: the last thing on the
 * page. The Climb never gets to the Summit (CONTEXT.md), so the page stops below it.
 */
export function SummitAhead({ links }: { links: Links }) {
  return (
    <div id="summit" className="bg-light-ground sky-fields">
      <section
        aria-labelledby="summit-heading"
        className={`bg-summit-sky relative overflow-hidden py-section md:py-section-wide ${padClass}`}
      >
        <div className="max-w-page mx-auto grid items-center gap-x-16 gap-y-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="reveal">
              <h2
                id="summit-heading"
                className="text-title font-semibold tracking-tight"
              >
                The Summit is still ahead.
              </h2>
              <p className="max-w-measure mt-5 text-lg">
                The Climb stops at High Camp. Above it, the Summit is catching
                first light.
              </p>
            </div>
          </div>
          <div
            aria-hidden="true"
            className="relative mx-auto h-64 w-full max-w-72 md:h-80 md:max-w-96 lg:col-span-6 lg:col-start-7"
          >
            <div className="bg-summit-glow absolute -inset-x-1/2 -top-1/4 -bottom-8" />
            <div className="bg-summit-face peak absolute inset-0" />
            <div className="bg-light-ridge peak-shade absolute inset-0 opacity-70" />
            <div className="bg-peak-foot peak absolute inset-0" />
          </div>
        </div>
      </section>
      <div className={`${padClass} pb-section md:pb-section-wide`}>
        <ContactSection links={links} className="max-w-page mx-auto" />
      </div>
    </div>
  );
}

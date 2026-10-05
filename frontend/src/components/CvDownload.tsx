import { formatBytes } from "../api/media";
import type { MediaItem } from "../api/types";
import { buttonClass } from "./Button";

/** The CV as a PDF download, saved under the manifest's file name. */
export function CvDownload({ item }: { item: MediaItem }) {
  const file = item.variants.find((variant) => variant.kind === "document");
  if (!file) return null;
  return (
    <div className="mt-8">
      <a
        href={file.url}
        download={item.download_name ?? undefined}
        className={`${buttonClass} inline-block`}
      >
        Download CV
        <span className="text-on-accent ms-2 font-mono text-sm font-normal">
          PDF, {formatBytes(file.size_bytes)}
        </span>
      </a>
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { CHANGELOG_SEEN_COOKIE } from "@/lib/changelog";

/** Remembers that the visitor has read the release notes up to `latest`, which clears the top bar dot. */
export function MarkChangelogSeen({ latest }: { latest: string }) {
  useEffect(() => {
    document.cookie = `${CHANGELOG_SEEN_COOKIE}=${latest}; path=/; max-age=31536000; samesite=lax`;
  }, [latest]);
  return null;
}

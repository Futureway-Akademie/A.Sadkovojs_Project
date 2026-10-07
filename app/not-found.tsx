import { NotFoundPage } from "@/components/pages";
import { SiteShell } from "@/components/site-shell";

// Unmatched URLs render outside the route groups, so the website shell is added here.
export default function NotFound() {
  return (
    <SiteShell>
      <NotFoundPage />
    </SiteShell>
  );
}

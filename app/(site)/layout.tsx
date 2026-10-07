import { SiteShell } from "@/components/site-shell";

// Public website: header, footer and assistant only here, not in the dashboard.
export default function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SiteShell>{children}</SiteShell>;
}

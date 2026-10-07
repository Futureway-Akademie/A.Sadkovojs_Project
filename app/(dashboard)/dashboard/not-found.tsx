import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/dashboard/ui/states";

export default function DashboardNotFound() {
  return (
    <section className="dash-page">
      <PageHeader title="Seite nicht gefunden" />
      <EmptyState title="Diese Seite gibt es im Dashboard nicht." action={<Link href="/dashboard">Zur Startseite</Link>} />
    </section>
  );
}

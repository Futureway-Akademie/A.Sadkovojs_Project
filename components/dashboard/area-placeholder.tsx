import { EmptyState, PageHeader } from "./ui/states";

// Placeholder for areas that are filled in later tasks; makes clear that no data is shown yet.
export function AreaPlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <section className="dash-page">
      <PageHeader title={title} />
      <EmptyState title="Bereich in Vorbereitung">{body}</EmptyState>
    </section>
  );
}

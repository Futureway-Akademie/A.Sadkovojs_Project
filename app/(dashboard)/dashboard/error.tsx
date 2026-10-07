"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/dashboard/ui/states";

// Unexpected errors while rendering a dashboard area; details stay in the server log (digest only)
export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorState
      title="Dieser Bereich konnte nicht geladen werden."
      action={<button className="button button--secondary" type="button" onClick={() => retry()}>Erneut versuchen</button>}
    >
      <p>Bitte erneut versuchen. Bleibt der Fehler bestehen, die Administration informieren{error.digest ? ` (Fehler-ID ${error.digest})` : ""}.</p>
    </ErrorState>
  );
}

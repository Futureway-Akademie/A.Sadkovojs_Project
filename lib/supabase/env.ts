// NEXT_PUBLIC_* must be read with literal property access so Next.js can inline them in the browser bundle.
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Umgebungsvariable ${name} fehlt. Siehe .env.example.`);
  }
  return value;
}

export function getSupabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function getSupabasePublishableKey(): string {
  return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "./session";

export type LoginState = { error: string | null; email: string };

// Sign-in with e-mail and password. There is no sign-up; accounts are created by admins.
export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Bitte E-Mail-Adresse und Passwort eingeben.", email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // Same message for unknown address and wrong password
  if (error) return { error: "Anmeldung fehlgeschlagen. E-Mail-Adresse oder Passwort ist nicht korrekt.", email };

  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  const session = await getSession();
  if (session.status !== "anonymous") {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

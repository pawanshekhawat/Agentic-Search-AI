import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { createClient } from "../lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BACKEND_URL, BUILDER_LINKEDIN_URL } from "@/lib/config";

const supabase = createClient();

async function syncUserToBackend(jwt: string) {
  await fetch(`${BACKEND_URL}/signup`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  });

  await fetch(`${BACKEND_URL}/signin`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  });
}

export default function Auth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function bootstrapAuth() {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!mounted) return;

      if (token) {
        try {
          await syncUserToBackend(token);
          setIsAuthenticated(true);
        } catch {
          setErrorMessage("Authenticated, but failed to sync with backend.");
        }
      }

      setIsLoading(false);
    }

    bootstrapAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const token = session?.access_token;
      if (!token) {
        setIsAuthenticated(false);
        setIsSubmitting(false);
        return;
      }

      try {
        await syncUserToBackend(token);
        setIsAuthenticated(true);
        setErrorMessage(null);
      } catch {
        setErrorMessage("Signed in, but backend sync failed.");
      } finally {
        setIsSubmitting(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function login(provider: "google" | "github") {
    setErrorMessage(null);
    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error) {
      setErrorMessage(error.message);
      setIsSubmitting(false);
    }
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#0b0d12] px-4 py-12 text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.2),transparent_35%)]" />
      <div className="relative mx-auto flex w-full max-w-5xl items-center justify-center">
        <Card className="w-full max-w-md border-white/10 bg-[#12161f]/95 shadow-2xl backdrop-blur">
          <CardHeader className="space-y-3">
            <p className="inline-block w-fit rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-slate-300 uppercase">
              Atreus
            </p>
            <CardTitle className="text-3xl font-black tracking-tight text-white">Sign In</CardTitle>
            <CardDescription className="text-slate-400">
              Continue with your provider to access chat, sources, and conversation history.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {errorMessage && <p className="text-sm text-red-400">{errorMessage}</p>}
            <Button className="h-11 w-full bg-cyan-500 text-base text-black hover:bg-cyan-400" disabled={isSubmitting || isLoading} onClick={() => login("google")}>
              Continue with Google
            </Button>
            <Button className="h-11 w-full border-white/20 bg-transparent text-base text-slate-100 hover:bg-white/10 hover:text-white" variant="outline" disabled={isSubmitting || isLoading} onClick={() => login("github")}>
              Continue with GitHub
            </Button>
            {(isLoading || isSubmitting) && <p className="text-xs text-slate-500">Preparing your session...</p>}
          </CardContent>
        </Card>
      </div>
      <p className="absolute bottom-5 left-1/2 -translate-x-1/2 text-xs text-slate-500">
        Built for practice and experimentation by{" "}
        <a
          href={BUILDER_LINKEDIN_URL}
          target="_blank"
          rel="noreferrer"
          className="text-slate-300 underline underline-offset-2 hover:text-white"
        >
          Pawan Shekhawat
        </a>
      </p>
    </main>
  );
}

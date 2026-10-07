"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void; theme: "light" }) => string;
      remove: (id: string) => void;
      reset: (id: string) => void;
    };
  }
}

export function Turnstile({ onToken, resetSignal }: { onToken: (token: string) => void; resetSignal: number }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(() => typeof window !== "undefined" && Boolean(window.turnstile));
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!siteKey || loaded) return;
    const interval = window.setInterval(() => {
      if (window.turnstile) {
        setLoaded(true);
        setLoadError(false);
        window.clearInterval(interval);
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [loaded, siteKey]);

  useEffect(() => {
    if (!siteKey || !loaded || !container.current || !window.turnstile || widget.current) return;
    try {
      widget.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        callback: (token) => { setLoadError(false); onToken(token); },
        "expired-callback": () => onToken(""),
        "error-callback": () => { setLoadError(true); onToken(""); },
        theme: "light",
      });
    } catch {
      onToken("");
    }
    return () => {
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [loaded, onToken, siteKey]);

  useEffect(() => {
    if (!resetSignal || !widget.current || !window.turnstile) return;
    try {
      window.turnstile.reset(widget.current);
      onToken("");
    } catch {
      onToken("");
    }
  }, [onToken, resetSignal]);

  if (!siteKey) return <p className="turnstile-placeholder">Spam-Schutz wird beim Vercel-Deployment aktiviert.</p>;
  return <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={() => { setLoaded(true); setLoadError(false); }} onReady={() => { setLoaded(true); setLoadError(false); }} onError={() => setLoadError(true)} /><div ref={container} className="turnstile" />{loadError && <p className="turnstile-placeholder" role="alert">Die Sicherheitsprüfung konnte nicht geladen werden. Bitte versuchen Sie es erneut.</p>}</>;
}

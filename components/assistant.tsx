"use client";

import { useState } from "react";
import { Bot, LoaderCircle, Send, X } from "lucide-react";

const WEBHOOK_URL =
  "https://rheinwerk-rag.130-61-221-231.sslip.io/webhook/rheinwerk-assistant";

const suggestions = [
  "Was kostet eine Inspektion?",
  "Gilt der 24/7-Notfallkanal für alle Kunden?",
  "Welche Anlagen betreuen Sie?",
  "Wie werden kritische Fälle behandelt?",
];

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  const ask = async (value: string) => {
    const trimmedQuestion = value.trim();

    if (!trimmedQuestion || loading) return;

    setQuestion("");
    setAnswer("");
    setLoading(true);

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: trimmedQuestion,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: { answer?: string } = await response.json();

      setAnswer(
        data.answer ||
          "Diese Information ist in den bereitgestellten Dokumenten nicht enthalten.",
      );
    } catch {
      setAnswer(
        "Der Assistent ist momentan nicht erreichbar. Bitte versuchen Sie es später erneut.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        className="assistant-launcher"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="RheinWerk Assistent öffnen"
      >
        <Bot size={24} />
      </button>
    );
  }

  return (
    <aside className="assistant-panel" aria-label="RheinWerk Assistent">
      <header>
        <div>
          <Bot size={20} />
          <span>RheinWerk Assistent</span>
        </div>

        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Assistent schließen"
        >
          <X size={20} />
        </button>
      </header>

      <div className="assistant-panel__body" aria-live="polite">
        {!answer && !loading ? (
          <>
            <p>
              Guten Tag. Ich beantworte Fragen zu Leistungen, Anlagen,
              Preisrahmen und Servicezeiten auf Basis der veröffentlichten
              Dokumente.
            </p>

            <div className="assistant-suggestions">
              {suggestions.map((item) => (
                <button
                  type="button"
                  key={item}
                  onClick={() => void ask(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {loading ? (
              <div className="assistant-loading">
                <LoaderCircle
                  className="assistant-spinner"
                  size={20}
                  aria-hidden="true"
                />
                <span>Antwort wird erstellt...</span>
              </div>
            ) : (
              <p>{answer}</p>
            )}

            {!loading && (
              <button
                className="assistant-back"
                type="button"
                onClick={() => {
                  setQuestion("");
                  setAnswer("");
                }}
              >
                Andere Frage stellen
              </button>
            )}
          </>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          aria-label="Frage an den Assistenten"
          placeholder="Frage eingeben"
          disabled={loading}
        />

        <button
          type="submit"
          aria-label={loading ? "Antwort wird erstellt" : "Frage senden"}
          aria-busy={loading}
          disabled={loading || !question.trim()}
        >
          {loading ? (
            <LoaderCircle
              className="assistant-spinner"
              size={20}
              aria-hidden="true"
            />
          ) : (
            <Send size={18} />
          )}
        </button>
      </form>
    </aside>
  );
}

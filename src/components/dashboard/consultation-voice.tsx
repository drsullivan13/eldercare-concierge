import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Listener = {
  lang: string;
  onresult:
    | ((event: {
        results: {
          [index: number]: { [index: number]: { transcript: string } };
        };
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};
type SpeechBrowser = Window & {
  SpeechRecognition?: new () => Listener;
  webkitSpeechRecognition?: new () => Listener;
};

export function ConsultationVoice({
  ready,
  availability,
  book,
}: {
  ready: boolean;
  availability: () => Promise<string>;
  book: () => Promise<string>;
}) {
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const listener = useRef<Listener | null>(null);
  const generation = useRef(0);
  const current = useRef({ ready, availability, book });
  useLayoutEffect(() => {
    current.current = { ready, availability, book };
  }, [ready, availability, book]);
  useEffect(
    () => () => {
      generation.current++;
      listener.current?.abort();
    },
    [],
  );

  function listen() {
    const browser = window as SpeechBrowser;
    const Recognizer =
      browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Recognizer) {
      setMessage(
        "Voice commands are unavailable in this browser. Use the booking controls.",
      );
      return;
    }
    const recognition = new Recognizer();
    const session = ++generation.current;
    listener.current = recognition;
    recognition.lang = "en-US";
    recognition.onend = () => setListening(false);
    recognition.onerror = () =>
      setMessage(
        "Couldn’t hear a command. Try again or use the booking controls.",
      );
    recognition.onresult = async ({ results }) => {
      if (generation.current !== session || !current.current.ready) return;
      const command = results[0]?.[0]?.transcript
        .toLowerCase()
        .replace(/[.!?]$/u, "")
        .trim();
      const action =
        command === "book the consultation"
          ? current.current.book
          : command === "check availability"
            ? current.current.availability
            : undefined;
      if (!action) {
        setMessage("Say “check availability” or “book the consultation”.");
        return;
      }
      recognition.onresult = null;
      let result;
      try {
        result = await action();
      } catch {
        result = "Check the booking status before trying again.";
      }
      if (generation.current !== session) return;
      setMessage(result);
      if (window.speechSynthesis)
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(result));
    };
    try {
      recognition.start();
      setListening(true);
      setMessage("Say “check availability” or “book the consultation”.");
    } catch {
      setMessage("Microphone unavailable. Use the booking controls.");
    }
  }

  return (
    <>
      <button type="button" onClick={listen} disabled={!ready || listening}>
        {listening ? "Listening…" : "Use a voice command"}
      </button>
      {message && <p role="status">{message}</p>}
    </>
  );
}

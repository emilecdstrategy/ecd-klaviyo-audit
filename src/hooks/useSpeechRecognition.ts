import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Thin wrapper around the browser Web Speech API (Chrome/Edge/Safari) for
 * dictating text into an input. `onResult` fires continuously with the full
 * session transcript so far (finalized phrases + the live interim guess), so
 * callers can show live text as the user speaks.
 */
type SpeechErrorKind = 'unsupported' | 'not-allowed' | 'no-speech' | 'audio' | 'error';

type UseSpeechRecognitionOptions = {
  onResult: (sessionTranscript: string) => void;
  onError?: (kind: SpeechErrorKind) => void;
  lang?: string;
};

// The Web Speech API isn't in the standard TS lib DOM types.
type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition({ onResult, onError, lang = 'en-US' }: UseSpeechRecognitionOptions) {
  const supported = getRecognitionCtor() !== null;
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalRef = useRef('');

  // Keep the latest callbacks without re-creating start/stop.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* no-op */
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      onErrorRef.current?.('unsupported');
      return;
    }
    // Don't start a second session on top of a running one.
    if (recognitionRef.current) return;

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    finalRef.current = '';

    rec.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) finalRef.current += text;
        else interim += text;
      }
      onResultRef.current((finalRef.current + interim).replace(/\s+/g, ' ').trimStart());
    };
    rec.onerror = (event: any) => {
      const kind: SpeechErrorKind =
        event?.error === 'not-allowed' || event?.error === 'service-not-allowed'
          ? 'not-allowed'
          : event?.error === 'no-speech'
            ? 'no-speech'
            : event?.error === 'audio-capture'
              ? 'audio'
              : 'error';
      onErrorRef.current?.(kind);
    };
    rec.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (recognitionRef.current) stop();
    else start();
  }, [start, stop]);

  // Stop recognition if the component unmounts mid-session.
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* no-op */
      }
    };
  }, []);

  return { supported, listening, start, stop, toggle };
}

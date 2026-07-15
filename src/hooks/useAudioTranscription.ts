import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Records mic audio (via getUserMedia, which reliably prompts for permission in
 * every browser) and transcribes it server-side with OpenAI Whisper through the
 * `proposal_transcribe` edge function. `onText` fires once with the final
 * transcript when recording stops and transcription completes.
 */
export type TranscriptionStatus = 'idle' | 'recording' | 'transcribing';
type TranscriptionErrorKind = 'unsupported' | 'not-allowed' | 'no-device' | 'empty' | 'failed';

type UseAudioTranscriptionOptions = {
  onText: (text: string) => void;
  onError?: (kind: TranscriptionErrorKind) => void;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function useAudioTranscription({ onText, onError }: UseAudioTranscriptionOptions) {
  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const transcribe = useCallback(async (blob: Blob) => {
    setStatus('transcribing');
    try {
      const audio_base64 = await blobToBase64(blob);
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; text?: string; error?: { message?: string } }>(
        'proposal_transcribe',
        { body: { audio_base64, mime: blob.type || 'audio/webm' } },
      );
      if (error) throw error;
      const text = (data?.ok ? data.text ?? '' : '').trim();
      if (!data?.ok) throw new Error(data?.error?.message || 'transcription_failed');
      if (text) onTextRef.current(text);
      else onErrorRef.current?.('empty');
    } catch {
      onErrorRef.current?.('failed');
    } finally {
      setStatus('idle');
    }
  }, []);

  const start = useCallback(async () => {
    if (!supported) {
      onErrorRef.current?.('unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        releaseStream();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size === 0) {
          setStatus('idle');
          onErrorRef.current?.('empty');
          return;
        }
        void transcribe(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setStatus('recording');
    } catch (e) {
      releaseStream();
      setStatus('idle');
      const name = (e as { name?: string })?.name;
      onErrorRef.current?.(name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : name === 'NotFoundError' ? 'no-device' : 'failed');
    }
  }, [supported, releaseStream, transcribe]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      } catch {
        /* no-op */
      }
      releaseStream();
    };
  }, [releaseStream]);

  return { supported, status, start, stop };
}

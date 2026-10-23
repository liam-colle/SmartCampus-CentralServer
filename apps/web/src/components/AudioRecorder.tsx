import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** A recording longer than this is stopped by itself: a broadcast is a short message, not a lecture. */
const MAX_RECORDING_SECONDS = 120;

/**
 * Records from the microphone with MediaRecorder and hands the finished clip to `onRecorded`.
 * Browsers only allow the microphone on https or localhost.
 */
export function AudioRecorder({ onRecorded, onError }: { onRecorded: (clip: Blob) => void; onError: (message: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(
    () => () => {
      clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  function stop() {
    clearInterval(timer.current);
    recorder.current?.stop();
    setRecording(false);
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return onError("This browser cannot record audio. Import a file instead.");
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const next = new MediaRecorder(stream);
      next.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      next.onstop = () => {
        stream.getTracks().forEach((t) => t.stop()); // release the microphone
        onRecorded(new Blob(chunks, { type: next.mimeType }));
      };
      recorder.current = next;
      next.start();
      setSeconds(0);
      setRecording(true);
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_RECORDING_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      onError("Microphone access was refused. Allow it in the browser, or import a file instead.");
    }
  }

  return recording ? (
    <Button type="button" variant="destructive" onClick={stop}>
      <Square /> Stop ({seconds}s)
    </Button>
  ) : (
    <Button type="button" variant="outline" onClick={() => void start()}>
      <Mic /> Record
    </Button>
  );
}

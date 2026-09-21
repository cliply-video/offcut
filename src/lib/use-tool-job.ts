import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { cancelJob, type ToolProgress } from "./api";

// One join/convert run at a time: hands the backend a fresh job id, follows
// its "tool-progress" events, and cancels by that id.
export function useToolJob(onBusy?: (busy: boolean) => void) {
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  const jobId = useRef<string | null>(null);

  useEffect(() => {
    const un = listen<ToolProgress>("tool-progress", (e) => {
      if (e.payload.jobId === jobId.current) setProgress(e.payload);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    onBusy?.(running);
  }, [running, onBusy]);

  const run = useCallback(async <T>(job: (id: string) => Promise<T>) => {
    const id = crypto.randomUUID();
    jobId.current = id;
    setProgress(null);
    setRunning(true);
    try {
      return await job(id);
    } finally {
      jobId.current = null;
      setRunning(false);
      setCancelling(false);
    }
  }, []);

  const cancel = useCallback(() => {
    if (!jobId.current) return;
    setCancelling(true);
    cancelJob(jobId.current);
  }, []);

  return { running, cancelling, progress, run, cancel };
}

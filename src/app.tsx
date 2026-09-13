import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Shell } from "./components/chrome";
import { Splash } from "./components/splash";
import { UpdateBanner } from "./components/update-banner";
import { type BinariesStatus, binariesStatus } from "./lib/api";
import { Clips } from "./screens/clips";
import { ImportXml } from "./screens/import";
import { Landing } from "./screens/landing";
import { Setup } from "./screens/setup";
import { AddVideo } from "./screens/video";

type StepName = "landing" | "video" | "import" | "clips";

const INDEX: Record<Exclude<StepName, "landing">, 1 | 2 | 3> = {
  video: 1,
  import: 2,
  clips: 3,
};

// ffprobe isn't used yet; gate only on what the flow needs. deno is yt-dlp's
// JS runtime — YouTube extraction fails without it.
const ready = (s: BinariesStatus | null) =>
  !!s && s.ffmpeg && s.ytdlp && s.deno;

export function App() {
  const [status, setStatus] = useState<BinariesStatus | null>(null);
  const [stepName, setStepName] = useState<StepName>("landing");
  // videoId lives above the step so stepper navigation can jump between the
  // three stages without losing the current video.
  const [videoId, setVideoId] = useState<string | null>(null);
  // Furthest stage reached for this video — the top stepper can jump back to a
  // visited stage and forward again to one already completed, but never skip
  // ahead to an unreached one.
  const [reached, setReached] = useState<1 | 2 | 3>(1);
  const [booting, setBooting] = useState(true);

  const refresh = useCallback(async () => {
    setStatus(await binariesStatus());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const inFlow = ready(status);

  const startFresh = useCallback(() => {
    setVideoId(null);
    setReached(1);
    setStepName("video");
  }, []);

  const resume = useCallback((id: string, hasClips: boolean) => {
    setVideoId(id);
    setReached(hasClips ? 3 : 2);
    setStepName(hasClips ? "clips" : "import");
  }, []);

  const goHome = useCallback(() => setStepName("landing"), []);

  // Top-stepper jump — only to a stage already reached (back, or forward to a
  // completed one).
  const navigate = useCallback(
    (target: 1 | 2 | 3) => {
      if (target > reached) return;
      if (target === 1) setStepName("video");
      else if (target === 2 && videoId) setStepName("import");
      else if (target === 3 && videoId) setStepName("clips");
    },
    [reached, videoId],
  );

  const stepIndex =
    inFlow && stepName !== "landing" ? INDEX[stepName] : undefined;

  let screen: ReactNode;
  if (!inFlow) {
    screen = <Setup status={status} onReady={refresh} />;
  } else if (stepName === "video") {
    screen = (
      <AddVideo
        onVideo={(id) => {
          setVideoId(id);
          setReached(2);
          setStepName("import");
        }}
        onBack={goHome}
      />
    );
  } else if (stepName === "import" && videoId) {
    screen = (
      <ImportXml
        videoId={videoId}
        onDone={() => {
          setReached(3);
          setStepName("clips");
        }}
        onBack={() => setStepName("video")}
        onAnother={startFresh}
      />
    );
  } else if (stepName === "clips" && videoId) {
    screen = <Clips videoId={videoId} onBack={goHome} />;
  } else {
    screen = <Landing onStart={startFresh} onResume={resume} />;
  }

  return (
    <>
      <Shell
        step={stepIndex}
        reached={inFlow ? reached : undefined}
        onNavigate={navigate}
      >
        {screen}
      </Shell>
      <UpdateBanner />
      {booting && <Splash onDone={() => setBooting(false)} />}
    </>
  );
}

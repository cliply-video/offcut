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

type Step =
  | { name: "landing" }
  | { name: "video" }
  | { name: "import"; videoId: string }
  | { name: "clips"; videoId: string };

// ffprobe isn't used yet; gate only on what the flow needs. deno is yt-dlp's
// JS runtime — YouTube extraction fails without it.
const ready = (s: BinariesStatus | null) =>
  !!s && s.ffmpeg && s.ytdlp && s.deno;

export function App() {
  const [status, setStatus] = useState<BinariesStatus | null>(null);
  const [step, setStep] = useState<Step>({ name: "landing" });
  const [booting, setBooting] = useState(true);

  const refresh = useCallback(async () => {
    setStatus(await binariesStatus());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const inFlow = ready(status);
  const stepIndex: 1 | 2 | 3 | undefined = !inFlow
    ? undefined
    : step.name === "video"
      ? 1
      : step.name === "import"
        ? 2
        : step.name === "clips"
          ? 3
          : undefined;

  let screen: ReactNode;
  if (!inFlow) {
    screen = <Setup status={status} onReady={refresh} />;
  } else if (step.name === "landing") {
    screen = (
      <Landing
        onStart={() => setStep({ name: "video" })}
        onResume={(videoId, hasClips) =>
          setStep(
            hasClips
              ? { name: "clips", videoId }
              : { name: "import", videoId },
          )
        }
      />
    );
  } else if (step.name === "video") {
    screen = (
      <AddVideo
        onVideo={(videoId) => setStep({ name: "import", videoId })}
        onBack={() => setStep({ name: "landing" })}
      />
    );
  } else if (step.name === "import") {
    screen = (
      <ImportXml
        videoId={step.videoId}
        onDone={() => setStep({ name: "clips", videoId: step.videoId })}
        onHome={() => setStep({ name: "landing" })}
      />
    );
  } else {
    screen = (
      <Clips
        videoId={step.videoId}
        onBack={() => setStep({ name: "landing" })}
      />
    );
  }

  return (
    <>
      <Shell step={stepIndex}>{screen}</Shell>
      <UpdateBanner />
      {booting && <Splash onDone={() => setBooting(false)} />}
    </>
  );
}

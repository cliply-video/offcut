import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Shell } from "./components/chrome";
import { Splash } from "./components/splash";
import { UpdateBanner } from "./components/update-banner";
import { type BinariesStatus, binariesStatus } from "./lib/api";
import { Clips } from "./screens/clips";
import { Home } from "./screens/home";
import { ImportXml } from "./screens/import";
import { Setup } from "./screens/setup";

type Step =
  | { name: "home" }
  | { name: "import"; videoId: string }
  | { name: "clips"; videoId: string };

// ffprobe isn't used yet; gate only on what the flow needs. deno is yt-dlp's
// JS runtime — YouTube extraction fails without it.
const ready = (s: BinariesStatus | null) =>
  !!s && s.ffmpeg && s.ytdlp && s.deno;

export function App() {
  const [status, setStatus] = useState<BinariesStatus | null>(null);
  const [step, setStep] = useState<Step>({ name: "home" });
  const [booting, setBooting] = useState(true);

  const refresh = useCallback(async () => {
    setStatus(await binariesStatus());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  let screen: ReactNode;
  if (!ready(status)) {
    screen = <Setup status={status} onReady={refresh} />;
  } else if (step.name === "home") {
    screen = <Home onVideo={(videoId) => setStep({ name: "import", videoId })} />;
  } else if (step.name === "import") {
    screen = (
      <ImportXml
        videoId={step.videoId}
        onDone={() => setStep({ name: "clips", videoId: step.videoId })}
        onHome={() => setStep({ name: "home" })}
      />
    );
  } else {
    screen = (
      <Clips videoId={step.videoId} onBack={() => setStep({ name: "home" })} />
    );
  }

  return (
    <>
      <Shell>{screen}</Shell>
      <UpdateBanner />
      {booting && <Splash onDone={() => setBooting(false)} />}
    </>
  );
}

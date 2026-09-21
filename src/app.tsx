import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Shell } from "./components/chrome";
import { Splash } from "./components/splash";
import type { ToolName } from "./components/tool-rail";
import { UpdateBanner } from "./components/update-banner";
import { type BinariesStatus, binariesStatus } from "./lib/api";
import { Clips } from "./screens/clips";
import { Convert } from "./screens/convert";
import { Download } from "./screens/download";
import { ImportXml } from "./screens/import";
import { Join } from "./screens/join";
import { Landing } from "./screens/landing";
import { Setup } from "./screens/setup";
import { AddVideo } from "./screens/video";

// The clip cutter is the one tool that is a sequence (video → xml → clips).
type ClipStep = "video" | "import" | "clips";

const INDEX: Record<ClipStep, 1 | 2 | 3> = { video: 1, import: 2, clips: 3 };

// deno is yt-dlp's JS runtime — YouTube extraction fails without it. ffprobe
// plans every join and convert.
const ready = (s: BinariesStatus | null) =>
  !!s && s.ffmpeg && s.ffprobe && s.ytdlp && s.deno;

export function App() {
  const [status, setStatus] = useState<BinariesStatus | null>(null);
  const [tool, setTool] = useState<ToolName>("home");
  const [busy, setBusy] = useState<Partial<Record<ToolName, boolean>>>({});
  const [clipStep, setClipStep] = useState<ClipStep>("video");
  // videoId lives above the step so stepper navigation can jump between the
  // three stages without losing the current video.
  const [videoId, setVideoId] = useState<string | null>(null);
  // Furthest stage reached for this video — the stepper can jump back to a
  // visited stage and forward again to one already completed, but never skip
  // ahead to an unreached one.
  const [reached, setReached] = useState<1 | 2 | 3>(1);
  // Files handed to Convert from another tool; `n` makes a repeat hand-off of
  // the same path a new value.
  const [convertSeed, setConvertSeed] = useState<{
    path: string;
    title: string;
    n: number;
  } | null>(null);
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
    setClipStep("video");
    setTool("clips");
  }, []);

  const resume = useCallback((id: string, hasClips: boolean) => {
    setVideoId(id);
    setReached(hasClips ? 3 : 2);
    setClipStep(hasClips ? "clips" : "import");
    setTool("clips");
  }, []);

  const goHome = useCallback(() => setTool("home"), []);

  const sendToConvert = useCallback((path: string, title: string) => {
    setConvertSeed((prev) => ({ path, title, n: (prev?.n ?? 0) + 1 }));
    setTool("convert");
  }, []);

  // The clip cutter's current video was deleted from the library.
  const forget = useCallback(
    (id: string) => {
      if (id !== videoId) return;
      setVideoId(null);
      setReached(1);
      setClipStep("video");
    },
    [videoId],
  );

  const busyClips = useCallback(
    (b: boolean) => setBusy((prev) => ({ ...prev, clips: b })),
    [],
  );
  const busyDownload = useCallback(
    (b: boolean) => setBusy((prev) => ({ ...prev, download: b })),
    [],
  );
  const busyJoin = useCallback(
    (b: boolean) => setBusy((prev) => ({ ...prev, join: b })),
    [],
  );
  const busyConvert = useCallback(
    (b: boolean) => setBusy((prev) => ({ ...prev, convert: b })),
    [],
  );

  // Stepper jump — only to a stage already reached (back, or forward to a
  // completed one).
  const navigate = useCallback(
    (target: 1 | 2 | 3) => {
      if (target > reached) return;
      if (target === 1) setClipStep("video");
      else if (target === 2 && videoId) setClipStep("import");
      else if (target === 3 && videoId) setClipStep("clips");
    },
    [reached, videoId],
  );

  // A stage past "video" needs a video; without one the cutter starts over.
  const step: ClipStep = videoId ? clipStep : "video";

  let clipScreen: ReactNode;
  if (step === "import" && videoId) {
    clipScreen = (
      <ImportXml
        videoId={videoId}
        onDone={() => {
          setReached(3);
          setClipStep("clips");
        }}
        onBack={() => setClipStep("video")}
        onAnother={startFresh}
      />
    );
  } else if (step === "clips" && videoId) {
    clipScreen = <Clips videoId={videoId} onBack={goHome} />;
  } else {
    clipScreen = (
      <AddVideo
        active={tool === "clips"}
        onBusy={busyClips}
        onVideo={(id) => {
          setVideoId(id);
          setReached(2);
          setClipStep("import");
        }}
        onResume={resume}
        onBack={goHome}
      />
    );
  }

  return (
    <>
      <Shell
        tool={inFlow ? tool : undefined}
        busy={busy}
        onTool={setTool}
        step={inFlow && tool === "clips" ? INDEX[step] : undefined}
        reached={reached}
        onNavigate={navigate}
      >
        {!inFlow ? (
          <Setup status={status} onReady={refresh} />
        ) : (
          <>
            {tool === "home" && (
              <Landing
                // The card starts a new video; the rail tab returns to the
                // one in progress.
                onTool={(next) =>
                  next === "clips" ? startFresh() : setTool(next)
                }
                onResume={resume}
                onDeleted={forget}
              />
            )}
            {/* The tools stay mounted so a running download/join/convert — and
                its progress — survives a trip to another tool. */}
            <div className="pane" hidden={tool !== "clips"}>
              {clipScreen}
            </div>
            <div className="pane" hidden={tool !== "download"}>
              <Download
                onBusy={busyDownload}
                onCutClips={(id) => resume(id, false)}
                onConvert={sendToConvert}
              />
            </div>
            <div className="pane" hidden={tool !== "join"}>
              <Join active={tool === "join"} onBusy={busyJoin} />
            </div>
            <div className="pane" hidden={tool !== "convert"}>
              <Convert
                active={tool === "convert"}
                seed={convertSeed}
                onBusy={busyConvert}
              />
            </div>
          </>
        )}
      </Shell>
      <UpdateBanner />
      {booting && <Splash onDone={() => setBooting(false)} />}
    </>
  );
}

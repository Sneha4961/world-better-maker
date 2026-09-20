import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import pharmacySign from "@/assets/pharmacy-sign.jpg";
import prescriptionImg from "@/assets/prescription.jpg";
import cafeMenu from "@/assets/cafe-menu.jpg";
import busStopImg from "@/assets/bus-stop.jpg";
import avatarImg from "@/assets/avatar.jpg";
import { analyzeImage, speakText } from "@/lib/drishti.functions";
import {
  base64ToBlobUrl,
  clearHistory,
  ensureSeededHistory,
  fileToDataUrl,
  kindLabel,
  loadHistory,
  saveHistory,
  timeAgo,
  type Scan,
} from "@/lib/drishti-client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Drishti AI — See it. Hear it. Understand it." },
      {
        name: "description",
        content:
          "Point your camera at any sign, prescription or menu. Drishti AI explains it in plain language and reads it aloud for low-vision, elderly and low-literacy users.",
      },
      {
        property: "og:title",
        content: "Drishti AI — See it. Hear it. Understand it.",
      },
      {
        property: "og:description",
        content:
          "Photograph anything around you — Drishti explains it in plain, friendly words and reads it aloud.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const DEMO_SCANS: Scan[] = [
  {
    id: "demo-prescription",
    title: "Prescription slip",
    kind: "prescription",
    explanation:
      "This is a doctor's prescription for Amoxicillin, an antibiotic. Take one capsule by mouth three times a day, after food, for seven days — that's twenty-one capsules in total. Finish the full course even if you feel better, and don't skip a dose.",
    thumb: prescriptionImg,
    createdAt: Date.now() - 30 * 60 * 1000,
  },
  {
    id: "demo-menu",
    title: "Café menu",
    kind: "menu",
    explanation:
      "This is the menu at a café called The Daily Bean. Coffee drinks are on the left — a latte costs four dollars fifty, and a cappuccino the same. On the right are the pastries: a croissant is three dollars fifty, and a cinnamon roll is four dollars. Tea is at the bottom left, and every kind costs three dollars.",
    thumb: cafeMenu,
    createdAt: Date.now() - 5 * 60 * 60 * 1000,
  },
  {
    id: "demo-bus",
    title: "Bus stop sign",
    kind: "sign",
    explanation:
      "This is a MetroTransit bus stop sign. Four buses stop here: number 22 going Downtown, number 47 to Riverside, number 58 to West End, and number 102 to Lakeside. The big numbers on the left are the route numbers, so look for your route number on the front of the incoming bus.",
    thumb: busStopImg,
    createdAt: Date.now() - 26 * 60 * 60 * 1000,
  },
];

const CURRENT_DEMO: Scan = {
  id: "demo-pharmacy",
  title: "Pharmacy sign",
  kind: "sign",
  explanation:
    "This is a sign for the Green Cross Pharmacy, and it is open right now. The window lists what they sell: prescription medicines, vitamins, and personal care. The hours on the door say it is open Monday to Saturday from 9 in the morning to 9 at night, and on Sundays from 10 to 6.",
  thumb: pharmacySign,
  createdAt: Date.now(),
};

type Current = {
  id?: string;
  dataUrl: string;
  thumb: string;
  title: string;
  kind: string;
  explanation: string;
};

type Status = "ready" | "analyzing" | "error";

function Index() {
  const [current, setCurrent] = useState<Current | null>(null);
  const [status, setStatus] = useState<Status>("ready");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Scan[]>([]);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playLabel, setPlayLabel] = useState("Tap play to listen");
  const [dragOver, setDragOver] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // Initial state: restore history (seeded with examples on first visit).
  useEffect(() => {
    const demos = [CURRENT_DEMO, ...DEMO_SCANS];
    const stored = ensureSeededHistory(demos);
    setHistory(stored.length ? stored : demos);
    const featured = stored.find((s) => s.id === CURRENT_DEMO.id) ?? CURRENT_DEMO;
    setCurrent({
      id: featured.id,
      dataUrl: featured.thumb,
      thumb: featured.thumb,
      title: featured.title,
      kind: featured.kind,
      explanation: featured.explanation,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (synthRef.current) {
      window.speechSynthesis.cancel();
      synthRef.current = null;
    }
    setPlaying(false);
    setProgress(0);
  }, []);

  const play = useCallback(
    async (text: string) => {
      stopAudio();
      setPlaying(true);
      setProgress(0);
      setPlayLabel("Warming up the voice…");
      try {
        const { audio, mime } = await speakText({ data: { text } });
        const el = new Audio(base64ToBlobUrl(audio, mime));
        audioRef.current = el;
        el.ontimeupdate = () => {
          if (el.duration > 0) {
            setProgress(el.currentTime / el.duration);
            const cur = fmtTime(el.currentTime);
            const total = fmtTime(el.duration);
            setPlayLabel(`Reading aloud · ${cur} of ${total}`);
          }
        };
        el.onended = () => {
          setPlaying(false);
          setProgress(0);
          setPlayLabel("Tap play to listen again");
        };
        await el.play();
      } catch {
        // Fallback: browser's built-in speech, so listening always works.
        if (!("speechSynthesis" in window)) {
          setPlaying(false);
          setPlayLabel("Voice isn't available in this browser");
          return;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 0.95;
        u.onend = () => {
          setPlaying(false);
          setProgress(0);
          setPlayLabel("Tap play to listen again");
        };
        synthRef.current = u;
        setPlayLabel("Reading aloud…");
        window.speechSynthesis.speak(u);
      }
    },
    [stopAudio],
  );

  const togglePlay = useCallback(() => {
    if (playing) {
      stopAudio();
      setPlayLabel("Paused · tap play to continue");
      return;
    }
    if (current?.explanation) void play(current.explanation);
  }, [playing, current, play, stopAudio]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setStatus("error");
        setError("That file isn't a photo. Please pick a JPG or PNG image.");
        return;
      }
      stopAudio();
      try {
        const { dataUrl, thumb } = await fileToDataUrl(file);
        setCurrent({ dataUrl, thumb, title: "", kind: "", explanation: "" });
        setStatus("analyzing");
        setError("");
        const result = await analyzeImage({ data: { image: dataUrl } });
        const scan: Scan = {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `scan-${Date.now()}`,
          title: result.title,
          kind: result.kind,
          explanation: result.explanation,
          thumb,
          createdAt: Date.now(),
        };
        setCurrent({
          id: scan.id,
          dataUrl,
          thumb,
          title: scan.title,
          kind: scan.kind,
          explanation: scan.explanation,
        });
        setStatus("ready");
        setPlayLabel("Tap play to listen");
        setHistory((prev) => {
          const next = [scan, ...prev].slice(0, 20);
          saveHistory(next);
          return next;
        });
        if (autoSpeak) void play(scan.explanation);
      } catch (e) {
        setStatus("error");
        setError(
          e instanceof Error
            ? e.message
            : "Something went wrong while reading that photo. Please try again.",
        );
      }
    },
    [autoSpeak, play, stopAudio],
  );

  const openScan = useCallback(
    (scan: Scan) => {
      stopAudio();
      setCurrent({
        id: scan.id,
        dataUrl: scan.thumb,
        thumb: scan.thumb,
        title: scan.title,
        kind: scan.kind,
        explanation: scan.explanation,
      });
      setStatus("ready");
      setError("");
      setPlayLabel("Tap play to listen");
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [stopAudio],
  );

  const scansToday = history.filter(
    (s) => Date.now() - s.createdAt < 24 * 60 * 60 * 1000,
  ).length;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background font-sans text-foreground">
      {/* Ambient glow field */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-40 -left-32 h-[520px] w-[520px] rounded-full bg-brand/30 blur-3xl" />
        <div className="absolute top-1/3 -right-40 h-[560px] w-[560px] rounded-full bg-spark/25 blur-3xl" />
        <div className="absolute bottom-[-180px] left-1/3 h-[480px] w-[480px] rounded-full bg-glow-pink/20 blur-3xl" />
      </div>

      <div ref={topRef} className="relative mx-auto max-w-6xl px-5 py-6 sm:px-8">
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />

        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand to-spark font-display text-xl font-semibold text-primary-foreground shadow-glow">
              D
            </div>
            <div>
              <p className="font-display text-xl font-semibold leading-none">
                Drishti AI
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                See it. Hear it. Understand it.
              </p>
            </div>
          </div>
          <nav className="hidden items-center gap-1 rounded-full border border-glass-border bg-glass-soft px-2 py-1 shadow-sm backdrop-blur-xl md:flex">
            <button
              onClick={() =>
                topRef.current?.scrollIntoView({ behavior: "smooth" })
              }
              className="rounded-full bg-card px-4 py-1.5 text-sm font-semibold text-brand shadow-sm"
            >
              Capture
            </button>
            <button
              onClick={() =>
                asideRef.current?.scrollIntoView({ behavior: "smooth" })
              }
              className="rounded-full px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              History
            </button>
            <div className="relative">
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className="rounded-full px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Settings
              </button>
              {settingsOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setSettingsOpen(false)}
                  />
                  <div className="absolute right-0 top-full z-20 mt-2 w-60 rounded-2xl border border-glass-border bg-popover/95 p-3 shadow-xl backdrop-blur-xl">
                    <label className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-sm hover:bg-accent">
                      <span>Auto-speak new scans</span>
                      <input
                        type="checkbox"
                        checked={autoSpeak}
                        onChange={(e) => setAutoSpeak(e.target.checked)}
                        className="h-4 w-4 accent-[var(--brand)]"
                      />
                    </label>
                    <button
                      onClick={() => {
                        stopAudio();
                        clearHistory();
                        const demos = [CURRENT_DEMO, ...DEMO_SCANS];
                        saveHistory(demos);
                        setHistory(demos);
                        setSettingsOpen(false);
                      }}
                      className="w-full rounded-xl px-3 py-2 text-left text-sm text-destructive hover:bg-accent"
                    >
                      Reset example history
                    </button>
                  </div>
                </>
              )}
            </div>
          </nav>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoSpeak((v) => !v)}
              className="hidden items-center gap-1.5 rounded-full border border-glass-border bg-glass-soft px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-xl transition-colors hover:text-foreground sm:inline-flex"
              title="Toggle auto-speak"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${autoSpeak ? "bg-brand" : "bg-muted-foreground/40"}`}
              />
              Auto-speak {autoSpeak ? "on" : "off"}
            </button>
            <img
              src={avatarImg}
              alt="Your profile"
              width={40}
              height={40}
              loading="lazy"
              className="h-10 w-10 rounded-full object-cover outline-1 -outline-offset-1 outline-black/5"
            />
          </div>
        </header>

        {/* Main grid */}
        <div className="mt-8 grid gap-5 lg:grid-cols-12">
          {/* Capture + explanation */}
          <section className="rounded-3xl p-6 shadow-glass glass sm:p-8 lg:col-span-8">
            <div className="flex items-center justify-between gap-3">
              <h1 className="font-display text-3xl font-semibold sm:text-4xl">
                What are you looking at?
              </h1>
              <span className="shrink-0 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
                {scansToday} scan{scansToday === 1 ? "" : "s"} today
              </span>
            </div>
            <p className="mt-2 max-w-md text-muted-foreground">
              Point at a sign, prescription, or menu. Drishti reads it aloud in
              plain, simple language.
            </p>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              {/* Preview */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void handleFile(f);
                }}
                className={`flex flex-col rounded-2xl border p-3 transition-colors ${
                  dragOver
                    ? "border-brand bg-brand/10"
                    : "border-glass-border bg-glass-soft"
                }`}
              >
                <div className="relative w-full overflow-hidden rounded-xl bg-secondary">
                  {current ? (
                    <img
                      src={current.dataUrl}
                      alt={current.title || "Photo you captured"}
                      className="aspect-[4/3] w-full object-cover"
                    />
                  ) : (
                    <div className="grid aspect-[4/3] w-full place-items-center text-sm text-muted-foreground">
                      No photo yet
                    </div>
                  )}
                  {status === "analyzing" && (
                    <div className="absolute inset-0" aria-hidden="true">
                      <div className="absolute inset-x-4 h-1/2 rounded-full bg-gradient-to-b from-spark/30 to-transparent scan-line" />
                      <div className="absolute inset-0 bg-background/20 backdrop-blur-[1px]" />
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground/70">
                    {status === "analyzing"
                      ? "Preview · just captured"
                      : current?.title
                        ? `Preview · ${current.title}`
                        : "Preview"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {status === "analyzing"
                      ? "reading…"
                      : current
                        ? timeAgo(
                            history.find((h) => h.id === current.id)
                              ?.createdAt ?? Date.now(),
                          )
                        : ""}
                  </span>
                </div>
              </div>

              {/* Capture actions */}
              <div className="flex flex-col justify-center gap-3">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={status === "analyzing"}
                  className="group rounded-2xl border-2 border-dashed border-brand/40 bg-glass-soft p-6 text-center transition-colors hover:border-brand hover:bg-brand/5 disabled:opacity-50"
                >
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand to-spark text-2xl text-primary-foreground shadow-glow transition-transform group-hover:scale-105">
                    +
                  </div>
                  <p className="mt-3 font-display text-lg font-medium">
                    Capture a photo
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Tap to open the camera
                  </p>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={status === "analyzing"}
                  className="rounded-2xl border border-glass-border bg-glass-soft p-4 text-center transition-colors hover:bg-glass disabled:opacity-50"
                >
                  <p className="text-sm font-semibold text-foreground/70">
                    or upload an image
                  </p>
                  <p className="text-xs text-muted-foreground">
                    JPG, PNG up to 10 MB — you can also drag &amp; drop
                  </p>
                </button>
              </div>
            </div>

            {/* Explanation card */}
            <div className="mt-6 rounded-2xl border border-glass-border bg-gradient-to-br from-brand/10 to-spark/10 p-6">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                  Plain-language explanation
                </span>
                {current?.kind && (
                  <span className="text-[11px] text-muted-foreground">
                    {kindLabel(current.kind)}
                  </span>
                )}
              </div>

              {status === "analyzing" ? (
                <div className="mt-3">
                  <p className="flex items-center gap-2 font-display text-2xl italic leading-snug text-muted-foreground">
                    <span className="relative grid place-items-center">
                      <span className="absolute h-2.5 w-2.5 rounded-full bg-brand/40 breathe" />
                      <span className="h-2 w-2 rounded-full bg-brand" />
                    </span>
                    Drishti is taking a look…
                  </p>
                  <div className="mt-4 space-y-3" aria-hidden="true">
                    <div className="h-4 w-11/12 animate-pulse rounded-full bg-brand/10" />
                    <div className="h-4 w-4/5 animate-pulse rounded-full bg-brand/10" />
                    <div className="h-4 w-2/3 animate-pulse rounded-full bg-brand/10" />
                  </div>
                </div>
              ) : status === "error" ? (
                <div className="mt-3">
                  <p className="font-display text-2xl leading-snug text-destructive">
                    {error}
                  </p>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-4 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Try another photo
                  </button>
                </div>
              ) : (
                <p className="mt-3 font-display text-2xl leading-snug sm:text-[28px]">
                  {current?.explanation}
                </p>
              )}

              {current?.explanation && status === "ready" && (
                <div className="mt-5 flex items-center gap-4">
                  <button
                    onClick={togglePlay}
                    aria-label={playing ? "Stop reading" : "Play aloud"}
                    className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-spark text-2xl text-primary-foreground shadow-glow transition-transform hover:scale-105"
                  >
                    {playing ? (
                      <span className="flex items-end gap-1" aria-hidden="true">
                        <span className="h-5 w-1.5 rounded-sm bg-current" />
                        <span className="h-5 w-1.5 rounded-sm bg-current" />
                      </span>
                    ) : (
                      <span className="ml-1" aria-hidden="true">
                        ▶
                      </span>
                    )}
                  </button>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 items-end gap-1" aria-hidden="true">
                        {[0, 0.15, 0.3, 0.45, 0.6, 0.75].map((d, i) => (
                          <span
                            key={i}
                            className={`eq-bar h-6 w-1 rounded-full ${i % 2 ? "bg-spark" : "bg-brand"}`}
                            style={{
                              animationDelay: `${d}s`,
                              animationPlayState: playing
                                ? "running"
                                : "paused",
                            }}
                          />
                        ))}
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">
                        {playLabel}
                      </span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-glass">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand to-spark transition-[width] duration-300"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Recent scans */}
          <aside
            ref={asideRef}
            className="h-fit rounded-3xl p-6 shadow-glass glass lg:col-span-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold">
                Recent scans
              </h2>
              <span className="text-xs text-muted-foreground">
                {history.length} saved
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {history
                .filter((s) => s.id !== current?.id)
                .slice(0, 6)
                .map((scan) => (
                  <button
                    key={scan.id}
                    onClick={() => openScan(scan)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-glass-border bg-glass-soft p-3 text-left transition-colors hover:bg-glass"
                  >
                    {scan.thumb ? (
                      <img
                        src={scan.thumb}
                        alt={scan.title}
                        width={56}
                        height={56}
                        loading="lazy"
                        className="h-14 w-14 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-secondary text-xs text-muted-foreground">
                        Photo
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {scan.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {scan.explanation}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                        {timeAgo(scan.createdAt)}
                      </p>
                    </div>
                  </button>
                ))}
              {history.filter((s) => s.id !== current?.id).length === 0 && (
                <p className="rounded-2xl bg-glass-soft p-4 text-sm text-muted-foreground">
                  Your scans will appear here. Capture a photo to get started.
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

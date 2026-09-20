/** Browser-side helpers for Drishti AI: image prep and scan history. */

export type Scan = {
  id: string;
  title: string;
  kind: string;
  explanation: string;
  thumb: string;
  createdAt: number;
};

const HISTORY_KEY = "drishti.history.v1";
const SEEDED_KEY = "drishti.seeded.v1";

/** Downscale a picked file to a compact JPEG data URL plus a small thumbnail. */
export async function fileToDataUrl(
  file: File,
  max = 1280,
  quality = 0.82,
): Promise<{ dataUrl: string; thumb: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);

    const thumbCanvas = document.createElement("canvas");
    const tScale = Math.min(1, 240 / Math.max(bitmap.width, bitmap.height));
    thumbCanvas.width = Math.max(1, Math.round(bitmap.width * tScale));
    thumbCanvas.height = Math.max(1, Math.round(bitmap.height * tScale));
    thumbCanvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumb = thumbCanvas.toDataURL("image/jpeg", 0.7);

    return { dataUrl, thumb };
  } finally {
    bitmap.close?.();
  }
}

export function loadHistory(): Scan[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Scan[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(scans: Scan[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(scans));
  } catch {
    // storage full — drop thumbnails before giving up entirely
    try {
      const trimmed = scans.map((s) => ({ ...s, thumb: "" }));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    } catch {
      /* ignore */
    }
  }
}

/** First visit: seed history with the built-in examples. */
export function ensureSeededHistory(demos: Scan[]): Scan[] {
  const existing = loadHistory();
  if (existing.length > 0 || localStorage.getItem(SEEDED_KEY)) return existing;
  localStorage.setItem(SEEDED_KEY, "1");
  saveHistory(demos);
  return demos;
}

export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    sign: "Sign",
    prescription: "Prescription",
    menu: "Menu",
    document: "Document",
    scene: "Scene",
    other: "Photo",
  };
  return map[kind] ?? "Photo";
}

export function base64ToBlobUrl(b64: string, mime: string): string {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr], { type: mime }));
}

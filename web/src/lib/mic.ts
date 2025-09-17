// Cross-browser safe constraints (use ideal to avoid hard failures)
export const micConstraints: MediaStreamConstraints = {
  audio: {
    echoCancellation: { ideal: true } as unknown as boolean,
    noiseSuppression: { ideal: true } as unknown as boolean,
    autoGainControl: { ideal: false } as unknown as boolean,
    channelCount: { ideal: 1 } as unknown as number,
    sampleRate: { ideal: 48000 } as unknown as number,
  },
};

// Cache a single mic stream across pages to avoid re-prompt/slow init
let cachedMicStream: MediaStream | null = null;

export async function getMicStream(): Promise<MediaStream> {
  if (cachedMicStream && cachedMicStream.active) return cachedMicStream;
  try {
    cachedMicStream = await navigator.mediaDevices.getUserMedia(micConstraints);
  } catch (e) {
    // Fallback to minimal constraints for strict/older browsers
    cachedMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  return cachedMicStream;
}

// Optional: explicitly release the cached mic stream when truly leaving the app
export function releaseMicStream() {
  if (!cachedMicStream) return;
  try { cachedMicStream.getTracks().forEach(t => t.stop()); } catch {}
  cachedMicStream = null;
}

export function setStreamMuted(stream: MediaStream | null, muted: boolean) {
  if (!stream) return;
  stream.getAudioTracks().forEach((t) => (t.enabled = !muted));
}

// ---------- Speaking detection (shared by Lobby/Game) ----------
let sharedAudioContext: AudioContext | null = null;

export type SpeakingOptions = {
  fftSize?: number; // default 512
  smoothingTimeConstant?: number; // default 0.85
  onThreshold?: number; // default 18
  offThreshold?: number; // default 12
  minHoldMs?: number; // default 150
  useSharedContext?: boolean; // default true
};

function ensureAudioContext(shared = true): AudioContext | null {
  type AudioGlobal = { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const g = globalThis as unknown as AudioGlobal;
  const Ctx: typeof AudioContext | undefined = g.AudioContext || g.webkitAudioContext;
  if (!Ctx) return null;
  if (!shared) return new Ctx();
  if (!sharedAudioContext) sharedAudioContext = new Ctx();
  return sharedAudioContext;
}

export type SpeakingHandle = {
  stop: () => void;
  audioContext: AudioContext | null;
};

/**
 * Start speaking detector on a given MediaStream (local or remote).
 * Hysteresis is applied using onThreshold/offThreshold with a minimal hold time.
 */
export function startSpeakingDetector(
  stream: MediaStream,
  onChange: (speaking: boolean) => void,
  opts: SpeakingOptions = {}
): SpeakingHandle {
  const {
    fftSize = 512,
    smoothingTimeConstant = 0.85,
    onThreshold = 18,
    offThreshold = 12,
    minHoldMs = 150,
    useSharedContext = true,
  } = opts;

  const ctx = ensureAudioContext(useSharedContext);
  if (!ctx) {
    // No AudioContext support; report "not speaking" and return no-op
    try { onChange(false); } catch {}
    return { stop: () => void 0, audioContext: null };
  }

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = smoothingTimeConstant;
  source.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  let speaking = false;
  let lastFlip = 0;
  let rafId = 0;

  const tick = () => {
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const avg = sum / dataArray.length;
    const now = performance.now();

    if (!speaking && avg > onThreshold && now - lastFlip > minHoldMs) {
      speaking = true;
      lastFlip = now;
      try { onChange(true); } catch {}
    } else if (speaking && avg < offThreshold && now - lastFlip > minHoldMs) {
      speaking = false;
      lastFlip = now;
      try { onChange(false); } catch {}
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  return {
    stop: () => {
      cancelAnimationFrame(rafId);
      try { source.disconnect(); } catch {}
      try { analyser.disconnect(); } catch {}
      // keep shared context alive for reuse
    },
    audioContext: ctx,
  };
}

/** Utility to attach stream to <audio> and try to auto-play. */
export function attachStreamToAudio(el: HTMLAudioElement, stream: MediaStream) {
  if (!el) return;
  try { el.autoplay = true; } catch {}
  try { el.setAttribute('playsinline', 'true'); } catch {}
  if (el.srcObject !== stream) el.srcObject = stream;
  el.play?.().catch(() => {});
}

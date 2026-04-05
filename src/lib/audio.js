"use client";

let cachedAudioContext = null;

function getAudioContext() {
  if (typeof window === "undefined") {
    return null;
  }

  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    return null;
  }

  if (!cachedAudioContext || cachedAudioContext.state === "closed") {
    cachedAudioContext = new AudioContextConstructor();
  }

  return cachedAudioContext;
}

export async function playFaceRecognitionSound() {
  try {
    const context = getAudioContext();
    if (!context) {
      return false;
    }

    if (context.state === "suspended") {
      await context.resume();
    }

    const startAt = context.currentTime + 0.01;
    const masterGain = context.createGain();
    masterGain.connect(context.destination);
    masterGain.gain.setValueAtTime(0.0001, startAt);
    masterGain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.03);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.45);

    [
      { frequency: 740, startOffset: 0, duration: 0.14 },
      { frequency: 988, startOffset: 0.15, duration: 0.18 },
    ].forEach(({ frequency, startOffset, duration }) => {
      const oscillator = context.createOscillator();
      const noteGain = context.createGain();
      const noteStart = startAt + startOffset;
      const noteEnd = noteStart + duration;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, noteStart);

      noteGain.gain.setValueAtTime(0.0001, noteStart);
      noteGain.gain.exponentialRampToValueAtTime(1, noteStart + 0.02);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

      oscillator.connect(noteGain);
      noteGain.connect(masterGain);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd);
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Shared silence detection utilities
 */

/**
 * Calculate the average amplitude of an audio buffer
 * @param buffer - Raw PCM audio buffer (Int16 little-endian)
 * @returns Average amplitude value
 */
export function calculateAmplitude(buffer: Buffer): number {
  let sum = 0;
  const samples = buffer.length / 2;

  for (let i = 0; i < samples; i++) {
    sum += Math.abs(buffer.readInt16LE(i * 2));
  }

  return sum / samples;
}

/**
 * Convert Int16 buffer to Float32Array for audio processing
 * @param buffer - Raw PCM audio buffer (Int16 little-endian)
 * @returns Float32Array with normalized samples [-1, 1]
 */
export function bufferToFloat32(buffer: Buffer): Float32Array {
  const samples = new Float32Array(buffer.length / 2);

  for (let i = 0; i < samples.length; i++) {
    samples[i] = buffer.readInt16LE(i * 2) / 32768.0;
  }

  return samples;
}

/**
 * Check if audio buffer represents silence
 * @param buffer - Raw PCM audio buffer
 * @param threshold - Amplitude threshold for silence detection
 * @returns true if the buffer is considered silence
 */
export function isSilent(buffer: Buffer, threshold: number): boolean {
  return calculateAmplitude(buffer) < threshold;
}

/**
 * Silence detector state machine
 */
export interface SilenceDetectorState {
  silenceStartTime: number | null;
  isRecording: boolean;
}

/**
 * Create initial silence detector state
 */
export function createSilenceDetectorState(): SilenceDetectorState {
  return {
    silenceStartTime: null,
    isRecording: false,
  };
}

/**
 * Update silence detector state based on audio input
 * @param state - Current detector state
 * @param buffer - Audio buffer to analyze
 * @param silenceAmplitude - Amplitude threshold for silence
 * @param silenceThresholdMs - Duration of silence to trigger end (ms)
 * @returns Updated state and whether silence threshold was exceeded
 */
export function updateSilenceDetector(
  state: SilenceDetectorState,
  buffer: Buffer,
  silenceAmplitude: number,
  silenceThresholdMs: number
): { state: SilenceDetectorState; shouldEnd: boolean } {
  const amplitude = calculateAmplitude(buffer);
  const now = Date.now();

  if (amplitude < silenceAmplitude) {
    // Currently silent
    if (!state.silenceStartTime) {
      // Just started being silent
      return {
        state: { ...state, silenceStartTime: now },
        shouldEnd: false,
      };
    } else if (now - state.silenceStartTime > silenceThresholdMs) {
      // Silence threshold exceeded
      return {
        state: { ...state, silenceStartTime: null },
        shouldEnd: true,
      };
    }
    // Still in silence period
    return { state, shouldEnd: false };
  } else {
    // Not silent - reset timer
    return {
      state: { ...state, silenceStartTime: null },
      shouldEnd: false,
    };
  }
}

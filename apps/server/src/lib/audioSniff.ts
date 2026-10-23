/** Audio containers we accept. The extension is what a device's player needs to open the cached file. */
export interface AudioFormat {
  mime: string;
  extension: string;
}

const startsWith = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
const ascii = (buf: Buffer, text: string, offset = 0) => buf.subarray(offset, offset + text.length).toString("latin1") === text;

/**
 * Recognises the format from the first bytes, so a file is judged by what it is, not by the
 * Content-Type the client claimed. Returns null for anything that is not WAV, MP3, Ogg, WebM or MP4/M4A audio.
 */
export function sniffAudio(buf: Buffer): AudioFormat | null {
  if (buf.length < 12) return null;
  if (ascii(buf, "RIFF") && ascii(buf, "WAVE", 8)) return { mime: "audio/wav", extension: "wav" };
  if (ascii(buf, "OggS")) return { mime: "audio/ogg", extension: "ogg" };
  // EBML header: Matroska/WebM, which is what browsers produce when recording from the microphone.
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: "audio/webm", extension: "webm" };
  if (ascii(buf, "ftyp", 4)) return { mime: "audio/mp4", extension: "m4a" };
  // MP3: an ID3 tag, or an MPEG frame sync (11 set bits).
  if (ascii(buf, "ID3") || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) return { mime: "audio/mpeg", extension: "mp3" };
  return null;
}

import { describe, expect, it } from "vitest";
import { sniffAudio } from "./audioSniff.js";

const pad = (head: Buffer) => Buffer.concat([head, Buffer.alloc(32)]);

describe("sniffAudio", () => {
  it("recognises the supported containers by their first bytes", () => {
    expect(sniffAudio(pad(Buffer.from("RIFF\0\0\0\0WAVEfmt ")))?.mime).toBe("audio/wav");
    expect(sniffAudio(pad(Buffer.from("OggS")))?.mime).toBe("audio/ogg");
    expect(sniffAudio(pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))?.mime).toBe("audio/webm");
    expect(sniffAudio(pad(Buffer.from("\0\0\0\x20ftypM4A ")))?.mime).toBe("audio/mp4");
    expect(sniffAudio(pad(Buffer.from("ID3\x04")))?.mime).toBe("audio/mpeg");
    expect(sniffAudio(pad(Buffer.from([0xff, 0xfb, 0x90])))?.mime).toBe("audio/mpeg");
  });

  it("refuses scripts, images, executables and truncated input", () => {
    expect(sniffAudio(pad(Buffer.from("<script>alert(1)</script>")))).toBeNull();
    expect(sniffAudio(pad(Buffer.from([0x89, 0x50, 0x4e, 0x47])))).toBeNull();
    expect(sniffAudio(pad(Buffer.from("MZ\x90\0")))).toBeNull();
    expect(sniffAudio(Buffer.from("OggS"))).toBeNull();
  });
});

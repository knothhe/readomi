import { createHash, webcrypto } from "node:crypto"
import { TextEncoder } from "node:util"
import { describe, expect, it } from "vitest"
import { sha256 } from "../sha256"

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
}

describe("local SHA-256", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"],
  ])("matches the standard test vector for %j", (text, expected) => {
    expect(hex(sha256(new TextEncoder().encode(text)))).toBe(expected)
  })

  it("matches the million-a test vector across many blocks", () => {
    expect(hex(sha256(new Uint8Array(1_000_000).fill(0x61))))
      .toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0")
  })

  it("matches both native implementations around every padding and block boundary", async () => {
    for (let length = 0; length <= 257; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 197 + length * 13) & 0xFF)
      const actual = hex(sha256(bytes))
      expect(actual).toBe(createHash("sha256").update(bytes).digest("hex"))
      expect(actual).toBe(hex(new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes))))
    }
  })

  it("hashes only the supplied byte view and preserves its backing buffer", () => {
    const buffer = Uint8Array.from({ length: 280 }, (_, i) => i & 0xFF)
    const original = buffer.slice()
    const bytes = buffer.subarray(7, 263)
    expect(hex(sha256(bytes))).toBe(createHash("sha256").update(bytes).digest("hex"))
    expect(buffer).toEqual(original)
  })
})

/** 0.25 s of 16 kHz mono 16-bit silence as a valid WAV container (~8 KB). Used by provider test endpoints. */
export function makeTestWav(): Buffer {
  const sampleRate = 16000
  const samples = sampleRate / 4
  const dataSize = samples * 2
  const b = Buffer.alloc(44 + dataSize)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + dataSize, 4)
  b.write('WAVE', 8)
  b.write('fmt ', 12)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(sampleRate, 24)
  b.writeUInt32LE(sampleRate * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(dataSize, 40)
  return b
}

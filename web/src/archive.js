import JSZip from "jszip";

export const ARCHIVE_LIMITS = Object.freeze({ bytes: 256 * 1024 * 1024, entries: 10000 });
export const compareDocumentPaths = (a, b) => a.localeCompare(b, "en", { numeric: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

// Check directory metadata before inflation, then verify actual streamed bytes and CRC.
export async function loadArchive(data, { limits = ARCHIVE_LIMITS } = {}) {
  if ((data.byteLength ?? data.size ?? data.length ?? 0) > limits.bytes) {
    throw new Error("파일 크기가 허용 범위를 초과합니다.");
  }
  const zip = await JSZip.loadAsync(data, { checkCRC32: false }).catch(error => {
    throw new Error("HWPX/ZIP 파일을 읽지 못했습니다. 파일이 손상되었거나 지원하지 않는 형식입니다.", { cause: error });
  });
  const all = Object.values(zip.files);
  if (all.length > limits.entries) throw new Error("압축 파일의 항목 수가 허용 범위를 초과합니다.");
  const entries = all.filter(entry => !entry.dir);
  const declared = entries.reduce((sum, entry) => sum + entry._data.uncompressedSize, 0);
  if (!Number.isSafeInteger(declared) || declared > limits.bytes) {
    throw new Error("압축 해제 크기가 허용 범위를 초과합니다.");
  }
  let actual = 0;
  for (const entry of entries) {
    await new Promise((resolve, reject) => {
      let crc = -1;
      const stream = entry.internalStream("uint8array");
      stream.on("data", chunk => {
        actual += chunk.byteLength;
        if (actual > limits.bytes) {
          stream.pause();
          reject(new Error("압축 해제 크기가 허용 범위를 초과합니다."));
          return;
        }
        for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      });
      stream.on("error", reject);
      stream.on("end", () => {
        if (((crc ^ -1) >>> 0) !== (entry._data.crc32 >>> 0)) reject(new Error("압축 파일의 CRC 검증에 실패했습니다."));
        else resolve();
      });
      stream.resume();
    });
  }
  return zip;
}

// HWPX readers identify the package from the first, uncompressed ZIP entry.
export async function generateHwpxArchive(zip) {
  const mimetype = zip.file("mimetype");
  if (!mimetype) throw new Error("HWPX mimetype 항목을 찾지 못했습니다.");
  const output = new JSZip();
  output.file("mimetype", await mimetype.async("uint8array"), { compression: "STORE" });
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || entry.name === "mimetype") continue;
    output.file(entry.name, await entry.async("uint8array"), { compression: "DEFLATE" });
  }
  return output.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

import JSZip from "jszip";

const HWPX_MIME_TYPE = "application/vnd.hancom.hwpx";
const PREFIXED_HWPX_ATTRIBUTE_RE = /\s(?:hp|hh|hc|hs|ha):([A-Za-z_][\w.-]*)=/g;
const MANIFEST_ITEM_RE = /<(?:opf:)?item\b[^>]*>/g;

function xmlAttribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || "";
}

function setXmlAttribute(tag, name, value) {
  const escaped = String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const attribute = new RegExp(`(\\s${name}=")[^"]*(")`);
  if (attribute.test(tag)) return tag.replace(attribute, `$1${escaped}$2`);
  return tag.replace(/\s*\/?>(?=$)/, (ending) => ` ${name}="${escaped}"${ending}`);
}

function bytesEqual(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function detectSourceImageFormat(bytes) {
  if (!bytes?.length) return null;
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { extension: "png", mediaType: "image/png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: "jpg", mediaType: "image/jpeg" };
  }
  if (bytes.length >= 6) {
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") {
      return { extension: "gif", mediaType: "image/gif" };
    }
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { extension: "bmp", mediaType: "image/bmp" };
  }
  if (bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") {
    return { extension: "webp", mediaType: "image/webp" };
  }
  return null;
}

/**
 * RHWP의 HWP → HWPX 내보내기에서 일부 뒤쪽 BinData가 선택지 ⑤ JPEG로
 * 반복 기록되는 경우가 있다. HWP 원본 이미지 API의 동일 ID 바이트로 패키지를
 * 복원하고, 실제 바이트 형식에 맞춰 manifest 경로와 MIME도 함께 수정한다.
 */
export async function repairConvertedHwpxBinData(bytes, getSourceImageBytes) {
  if (typeof getSourceImageBytes !== "function") return bytes;

  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const contentEntry = zip.file("Contents/content.hpf");
  if (!contentEntry) throw new Error("변환된 HWPX에 Contents/content.hpf가 없습니다.");

  let manifest = await contentEntry.async("string");
  const itemTags = [...manifest.matchAll(MANIFEST_ITEM_RE)].map((match) => match[0]);
  let changed = false;

  for (const itemTag of itemTags) {
    const id = xmlAttribute(itemTag, "id");
    const match = id.match(/^image(\d+)$/i);
    const href = xmlAttribute(itemTag, "href");
    if (!match || !/^BinData\//i.test(href)) continue;

    let sourceBytes;
    try {
      sourceBytes = getSourceImageBytes(`bin:0:${Number(match[1])}:src`);
    } catch {
      continue;
    }
    const format = detectSourceImageFormat(sourceBytes);
    if (!format) continue;

    const sourceCopy = Uint8Array.from(sourceBytes);
    const currentEntry = zip.file(href);
    const currentBytes = currentEntry ? await currentEntry.async("uint8array") : null;
    const basename = href.replace(/\.[^/.]+$/, "");
    const nextHref = `${basename}.${format.extension}`;
    const nextTag = setXmlAttribute(
      setXmlAttribute(itemTag, "href", nextHref),
      "media-type",
      format.mediaType,
    );
    if (currentBytes && bytesEqual(currentBytes, sourceCopy) && nextTag === itemTag) continue;

    if (nextHref !== href) zip.remove(href);
    zip.file(nextHref, sourceCopy);
    manifest = manifest.replace(itemTag, nextTag);
    changed = true;
  }

  if (!changed) return bytes;
  zip.file("Contents/content.hpf", manifest);
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  });
}

export function isSupportedBankFile(file) {
  return /\.(?:hwp|hwpx)$/i.test(file?.name || "");
}

export function isLegacyHwpFile(file) {
  return /\.hwp$/i.test(file?.name || "");
}

export function convertedHwpxName(filename) {
  return String(filename || "document.hwp").replace(/\.hwp$/i, ".hwpx");
}

export function bankPreviewBytes(record) {
  if (record?.convertedFromHwp && record.sourceBytes?.length) return record.sourceBytes;
  return record?.bytes || null;
}

export function detectBankFormat(bytes) {
  if (bytes.length >= 8
    && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
    && bytes[4] === 0xa1 && bytes[5] === 0xb1 && bytes[6] === 0x1a && bytes[7] === 0xe1) return "hwp";
  if (bytes.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "hwpx";
  if (bytes.length >= 17) {
    const signature = String.fromCharCode(...bytes.subarray(0, 17));
    if (signature === "HWP Document File") return "hwp3";
  }
  return "unknown";
}

function convertedRelativePath(file) {
  const sourcePath = file.webkitRelativePath || file._relativePath || file.name;
  return convertedHwpxName(sourcePath);
}

export function hwpConversionError(error) {
  const name = error?.name || "";
  const message = error?.message || String(error || "알 수 없는 오류");
  if (name === "HwpEncryptedError" || /암호화/.test(message)) {
    return new Error("암호화된 HWP 파일은 변환할 수 없습니다. 암호를 해제해 다시 저장한 뒤 추가하세요.");
  }
  if (name === "HwpUnsupportedError" || /HWP 3\.0|배포용|ViewText|지원하지 않는 HWP/.test(message)) {
    return new Error(`지원하지 않는 HWP 형식입니다. ${message}`);
  }
  if (name === "HwpInvalidFormatError") {
    return new Error(`유효한 HWP 5.0 파일이 아닙니다. ${message}`);
  }
  return new Error(`HWP → HWPX 변환 실패: ${message}`);
}

function parserFileFrom(bytes, sourceFile) {
  const parserFile = new File([bytes], convertedHwpxName(sourceFile.name), {
    type: HWPX_MIME_TYPE,
    lastModified: sourceFile.lastModified,
  });
  Object.defineProperty(parserFile, "_relativePath", {
    value: convertedRelativePath(sourceFile),
    configurable: true,
  });
  return parserFile;
}

export async function normalizeConvertedHwpx(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const xmlPaths = Object.keys(zip.files).filter((path) => path.endsWith(".xml")).sort();
  let endnoteNumber = 0;
  for (const path of xmlPaths) {
    let xml = await zip.file(path).async("string");
    xml = xml.replace(PREFIXED_HWPX_ATTRIBUTE_RE, " $1=");
    xml = xml.replace(/\sbinaryItemIDRef="0"/g, "");
    if (/^Contents\/section\d+\.xml$/.test(path)) {
      xml = xml.replace(/<hp:endNote\b[^>]*>/g, (tag) => {
        endnoteNumber += 1;
        return tag
          .replace(/\bnumber="[^"]*"/, `number="${endnoteNumber}"`)
          .replace(/\binstId="[^"]*"/, `instId="${endnoteNumber}"`);
      });
    }
    zip.file(path, xml);
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  });
}

export async function normalizeBankFile(file, {
  normalizeConverted = normalizeConvertedHwpx,
  convertHwp = null,
} = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isLegacyHwpFile(file)) {
    return { bytes, sourceBytes: bytes, parserFile: file, convertedFromHwp: false };
  }

  try {
    const detected = detectBankFormat(bytes);
    if (detected === "hwp3") {
      throw Object.assign(new Error("HWP 3.0은 지원하지 않습니다. 한컴오피스에서 HWP 5.0 또는 HWPX로 다시 저장하세요."), { name: "HwpUnsupportedError" });
    }
    if (detected === "hwpx") {
      return { bytes, sourceBytes: bytes, parserFile: parserFileFrom(bytes, file), convertedFromHwp: true };
    }
    if (detected !== "hwp") {
      throw Object.assign(new Error(`파일 내용에서 ${detected} 형식이 감지되었습니다.`), { name: "HwpInvalidFormatError" });
    }
    if (!convertHwp) throw new Error("RHWP HWP 변환기가 초기화되지 않았습니다.");
    const convertedBytes = await convertHwp(bytes);
    if (detectBankFormat(convertedBytes) !== "hwpx") {
      throw new Error("변환 결과가 올바른 HWPX 패키지가 아닙니다.");
    }
    const normalizedBytes = await normalizeConverted(convertedBytes);
    return {
      bytes: normalizedBytes,
      sourceBytes: bytes,
      parserFile: parserFileFrom(normalizedBytes, file),
      convertedFromHwp: true,
    };
  } catch (error) {
    throw hwpConversionError(error);
  }
}

import JSZip from "jszip";

const SECTION_RE = /^Contents\/section(\d+)\.xml$/;

function parseXml(xml, label) {
  const documentNode = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = documentNode.querySelector("parsererror");
  if (parseError) throw new Error(`${label} XML을 읽지 못했습니다.`);
  return documentNode;
}

const localName = (node) => node.localName || node.nodeName.split(":").pop();
const descendants = (element, name) => Array.from(element.getElementsByTagNameNS("*", name));

function sectionNames(zip) {
  return Object.keys(zip.files)
    .filter((name) => SECTION_RE.test(name))
    .sort((left, right) => Number(left.match(SECTION_RE)[1]) - Number(right.match(SECTION_RE)[1]));
}

export async function renumberEndnotesHwpx(bytes, startAt = 1) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  let number = startAt - 1;
  for (const name of sectionNames(zip)) {
    const documentNode = parseXml(await zip.file(name).async("string"), name);
    descendants(documentNode.documentElement, "endNote").forEach((note) => {
      number += 1;
      note.setAttribute("number", String(number));
      descendants(note, "autoNum")
        .filter((autoNumber) => autoNumber.getAttribute("numType") === "ENDNOTE")
        .forEach((autoNumber) => autoNumber.setAttribute("num", String(number)));
    });
    zip.file(name, new XMLSerializer().serializeToString(documentNode));
  }
  const headerEntry = zip.file("Contents/header.xml");
  if (headerEntry) {
    const headerDocument = parseXml(await headerEntry.async("string"), "Contents/header.xml");
    descendants(headerDocument.documentElement, "beginNum")
      .forEach((begin) => begin.setAttribute("endnote", String(startAt)));
    zip.file("Contents/header.xml", new XMLSerializer().serializeToString(headerDocument));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

function blankSectionFrom(sourceDocument) {
  const sourceRoot = sourceDocument.documentElement;
  const blankDocument = sourceDocument.implementation.createDocument(
    sourceRoot.namespaceURI,
    sourceRoot.nodeName,
    null,
  );
  const blankRoot = blankDocument.documentElement;
  Array.from(sourceRoot.attributes).forEach((attribute) => blankRoot.setAttributeNS(
    attribute.namespaceURI,
    attribute.name,
    attribute.value,
  ));
  const sourceParagraph = Array.from(sourceRoot.children).find((element) => descendants(element, "secPr").length)
    || Array.from(sourceRoot.children).find((element) => localName(element) === "p");
  if (!sourceParagraph) throw new Error("빈 페이지의 용지 설정을 만들 수 없습니다.");
  const paragraph = blankDocument.importNode(sourceParagraph, true);
  paragraph.setAttribute("id", String(Math.floor(2_000_000_000 + Math.random() * 500_000_000)));
  paragraph.setAttribute("pageBreak", "0");
  paragraph.setAttribute("columnBreak", "0");
  descendants(paragraph, "secPr").forEach((sectionProperties) => {
    ["header", "footer", "headerApply", "footerApply", "masterPage", "pageBorderFill"].forEach((name) => {
      descendants(sectionProperties, name).forEach((node) => node.remove());
    });
    descendants(sectionProperties, "visibility").forEach((visibility) => {
      visibility.setAttribute("hideFirstHeader", "1");
      visibility.setAttribute("hideFirstFooter", "1");
      visibility.setAttribute("hideFirstMasterPage", "1");
      visibility.setAttribute("hideFirstPageNum", "1");
      visibility.setAttribute("border", "HIDE_ALL");
      visibility.setAttribute("fill", "HIDE_ALL");
    });
  });
  descendants(paragraph, "t").forEach((node) => { node.textContent = ""; });
  descendants(paragraph, "footer").forEach((node) => node.remove());
  descendants(paragraph, "header").forEach((node) => node.remove());
  descendants(paragraph, "pageNum").forEach((node) => node.remove());
  descendants(paragraph, "autoNum")
    .filter((node) => node.getAttribute("numType") === "PAGE")
    .forEach((node) => node.remove());
  blankRoot.appendChild(paragraph);
  return blankDocument;
}

export async function appendCompletelyBlankPageHwpx(bytes) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const names = sectionNames(zip);
  const lastName = names.at(-1);
  const contentEntry = zip.file("Contents/content.hpf");
  const headerEntry = zip.file("Contents/header.xml");
  if (!lastName || !contentEntry || !headerEntry) throw new Error("빈 페이지를 추가할 HWPX 본문 구조가 없습니다.");

  const nextIndex = Math.max(...names.map((name) => Number(name.match(SECTION_RE)[1]))) + 1;
  const nextId = `section${nextIndex}`;
  const nextName = `Contents/${nextId}.xml`;
  const sourceDocument = parseXml(await zip.file(lastName).async("string"), lastName);
  const blankDocument = blankSectionFrom(sourceDocument);
  zip.file(nextName, new XMLSerializer().serializeToString(blankDocument));

  const contentDocument = parseXml(await contentEntry.async("string"), "Contents/content.hpf");
  const manifest = descendants(contentDocument.documentElement, "manifest")[0];
  const spine = descendants(contentDocument.documentElement, "spine")[0];
  if (!manifest || !spine) throw new Error("HWPX 본문 목록을 갱신할 수 없습니다.");
  const itemPrototype = Array.from(manifest.children).find((element) => localName(element) === "item");
  const itemRefPrototype = Array.from(spine.children).find((element) => localName(element) === "itemref");
  if (!itemPrototype || !itemRefPrototype) throw new Error("HWPX section 목록의 기준 항목이 없습니다.");
  const item = contentDocument.importNode(itemPrototype, false);
  item.setAttribute("id", nextId);
  item.setAttribute("href", nextName);
  item.setAttribute("media-type", "application/xml");
  manifest.appendChild(item);
  const itemRef = contentDocument.importNode(itemRefPrototype, false);
  itemRef.setAttribute("idref", nextId);
  itemRef.setAttribute("linear", "yes");
  spine.appendChild(itemRef);
  zip.file("Contents/content.hpf", new XMLSerializer().serializeToString(contentDocument));

  const headerDocument = parseXml(await headerEntry.async("string"), "Contents/header.xml");
  headerDocument.documentElement.setAttribute("secCnt", String(names.length + 1));
  zip.file("Contents/header.xml", new XMLSerializer().serializeToString(headerDocument));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

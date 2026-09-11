// Keep paragraph positions stable: cached question ranges refer to them.
// Run only on source sections, never on the destination template.
export function removeSourceHeadersAndFooters(root) {
  for (const name of ["header", "footer", "headerApply", "footerApply"]) {
    for (const node of Array.from(root.getElementsByTagNameNS("*", name))) node.remove();
  }
  return root;
}

// Verified publisher banner from the reported document. Match image bytes, not
// dimensions or filenames, so wide mathematical diagrams remain untouched.
const SOLUTION_BANNER_HASHES = new Set([
  "9eaba86f53f060b9d92964a9ed561c20887c94b6d5a9a211104f97a0e25d8e13",
]);

export async function sourceSolutionBannerIds(zip, contentDocument) {
  const ids = new Set();
  for (const item of Array.from(contentDocument.getElementsByTagNameNS("*", "item"))) {
    const href = item.getAttribute("href") || "";
    if (!/\.(?:jpe?g|png|gif|bmp)$/i.test(href)) continue;
    const entry = zip.file(href) || zip.file(href.replace(/^\.\.\//, "")) || zip.file(`Contents/${href}`);
    if (!entry) continue;
    const bytes = await entry.async("uint8array");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (SOLUTION_BANNER_HASHES.has(hash)) ids.add(item.getAttribute("id"));
  }
  return ids;
}

export function preprocessSourceContent(root, bannerIds = new Set()) {
  removeSourceHeadersAndFooters(root);
  for (const picture of Array.from(root.getElementsByTagNameNS("*", "pic"))) {
    const images = Array.from(picture.getElementsByTagNameNS("*", "img"));
    if (images.some(image => bannerIds.has(image.getAttribute("binaryItemIDRef")))) picture.remove();
  }
  return root;
}

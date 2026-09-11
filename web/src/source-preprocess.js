// Keep paragraph positions stable: cached question ranges refer to them.
// Run only on source sections, never on the destination template.
export function removeSourceHeadersAndFooters(root) {
  for (const name of ["header", "footer", "headerApply", "footerApply"]) {
    for (const node of Array.from(root.getElementsByTagNameNS("*", name))) node.remove();
  }
  return root;
}

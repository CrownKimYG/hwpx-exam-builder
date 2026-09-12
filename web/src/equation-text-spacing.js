// Hancom 2020 on Windows can draw following Hangul against an inline
// equation's last glyph. A real text space also participates in line layout.
export function separateEquationFromHangul(paragraph) {
  let afterEquation = false;
  for (const run of [...paragraph.children].filter(n => n.localName === 'run')) {
    for (const node of run.children) {
      if (node.localName === 'equation') {
        afterEquation = true;
      } else if (node.localName === 't') {
        for (const part of node.childNodes) {
          if (part.nodeType === 3) {
            if (!part.nodeValue) continue;
            if (afterEquation && /^\p{Script=Hangul}/u.test(part.nodeValue)) {
              part.nodeValue = ` ${part.nodeValue}`;
            }
          }
          // Spaces, punctuation, tabs and explicit breaks already separate
          // content; never carry the boundary into a nested control.
          afterEquation = false;
        }
      } else {
        afterEquation = false;
      }
    }
  }
}

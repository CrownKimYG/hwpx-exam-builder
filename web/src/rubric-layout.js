const tag = node => node.localName || node.nodeName.split(':').pop();
const children = (node, name) => [...(node?.children || [])].filter(n => tag(n) === name);
const child = (node, name) => children(node, name)[0];
const all = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const text = node => all(node, 't').map(n => n.textContent || '').join('').replace(/\s/g, '');
const num = (node, attr, fallback = 0) => Number(node?.getAttribute(attr) || fallback);
export const RUBRIC_FONT_SIZE = 1000;
export const RUBRIC_SCORE_WIDTH = 3600;

export function isRubricTable(table) {
  const rows = children(table, 'tr');
  const cells = children(rows[0], 'tc');
  return num(table, 'colCnt') === 2 && cells.length === 2
    && text(cells[0]) === '채점기준' && ['배점', '점수'].includes(text(cells[1]))
    && rows.every(row => children(row, 'tc').length === 2
      && children(row, 'tc').every(cell => num(child(cell, 'cellSpan'), 'colSpan', 1) === 1));
}

// Share one set of styles across all copied rubrics, regardless of source bank.
export function createRubricNormalizer(header, paragraphStyles) {
  let styles;
  const appendStyle = (list, source, edit) => {
    const clone = source.cloneNode(true);
    clone.setAttribute('id', String(Math.max(-1, ...[...list.children].map(n => num(n, 'id', -1))) + 1));
    edit(clone);
    // Reuse an identical style on repeated fitting passes.
    const signature = node => { const c = node.cloneNode(true); c.removeAttribute('id'); return new XMLSerializer().serializeToString(c); };
    const existing = [...list.children].find(n => signature(n) === signature(clone));
    if (existing) return existing;
    list.appendChild(clone);
    list.setAttribute('itemCnt', String(list.children.length));
    return clone;
  };
  const init = () => {
    const chars = all(header, 'charProperties')[0], paras = all(header, 'paraProperties')[0];
    if (!chars?.firstElementChild || !paras?.firstElementChild) return null;
    const fontIds = {};
    for (const face of all(header, 'fontface')) {
      let font = children(face,'font').find(n => n.getAttribute('face') === '함초롬바탕');
      if (!font) {
        font = header.createElementNS(face.namespaceURI, `${face.prefix ? face.prefix + ':' : ''}font`);
        font.setAttribute('id',String(Math.max(-1,...children(face,'font').map(n=>num(n,'id',-1)))+1));
        font.setAttribute('face','함초롬바탕');
        font.setAttribute('type','TTF');
        font.setAttribute('isEmbedded','0');
        face.appendChild(font);
        face.setAttribute('fontCnt',String(children(face,'font').length));
      }
      fontIds[face.getAttribute('lang')?.toLowerCase()] = font.getAttribute('id');
    }
    const charStyle = () => appendStyle(chars, chars.firstElementChild, node => {
      node.setAttribute('height', String(RUBRIC_FONT_SIZE));
      node.setAttribute('textColor', '#000000');
      node.setAttribute('shadeColor', 'none');
      node.setAttribute('symMark', 'NONE');
      const fontRef = child(node,'fontRef');
      if (fontRef) for (const [language,id] of Object.entries(fontIds)) fontRef.setAttribute(language,id);
      for (const name of ['bold', 'italic', 'supscript', 'subscript']) children(node, name).forEach(n => n.remove());
      for (const [name, value] of [['ratio',100],['relSz',100],['spacing',0],['offset',0]]) {
        const element = child(node, name);
        if (element) for (const attribute of [...element.attributes]) element.setAttribute(attribute.name, String(value));
      }
      for (const [name, attr] of [['underline','type'],['strikeout','shape'],['outline','type'],['shadow','type']]) child(node, name)?.setAttribute(attr, 'NONE');
    }).getAttribute('id');
    const paraStyle = center => {
      const node = appendStyle(paras, paras.firstElementChild, node => {
        let align = child(node, 'align');
        if (!align) { align = header.createElementNS(node.namespaceURI, `${node.prefix ? node.prefix + ':' : ''}align`); node.prepend(align); }
        align.setAttribute('horizontal', center ? 'CENTER' : 'LEFT');
        align.setAttribute('vertical', 'BASELINE');
        node.setAttribute('snapToGrid','0');
        node.setAttribute('condense','0');
        all(node, 'margin').forEach(m => [...m.children].forEach(v => v.setAttribute('value','0')));
        all(node, 'lineSpacing').forEach(n => { n.setAttribute('type','PERCENT'); n.setAttribute('value','150'); });
        const heading = child(node,'heading');
        heading?.setAttribute('type','NONE');
        const breaks = child(node,'breakSetting');
        if (breaks) {
          breaks.setAttribute('breakNonLatinWord','KEEP_WORD');
          breaks.setAttribute('keepWithNext','0');
          breaks.setAttribute('pageBreakBefore','0');
        }
      });
      paragraphStyles.set(node.getAttribute('id'), node);
      return node.getAttribute('id');
    };
    return { normal:charStyle(), left:paraStyle(false), center:paraStyle(true) };
  };
  return (table, width) => {
    if (!isRubricTable(table)) return false;
    styles ||= init();
    if (!styles) return false;
    const spacing = num(table, 'cellSpacing');
    const scoreWidth = Math.min(RUBRIC_SCORE_WIDTH, Math.floor((width - spacing) / 2));
    const widths = [width - spacing - scoreWidth, scoreWidth];
    const size = child(table,'sz');
    if (!size || widths[0] <= 0) return false;
    size.setAttribute('width',String(width));
    size.setAttribute('widthRelTo','ABSOLUTE');
    table.setAttribute('noAdjust','0');
    table.setAttribute('repeatHeader','1');
    const position = child(table,'pos');
    position?.setAttribute('horzAlign','LEFT');
    position?.setAttribute('horzRelTo','PARA');
    position?.setAttribute('horzOffset','0');
    for (const [rowIndex,row] of children(table,'tr').entries()) {
      for (const [column,cell] of children(row,'tc').entries()) {
        child(cell,'cellSz')?.setAttribute('width',String(widths[column]));
        cell.setAttribute('hasMargin','1');
        cell.setAttribute('header',rowIndex===0 ? '1' : '0');
        let margin = child(cell,'cellMargin');
        if (!margin) { margin = table.ownerDocument.createElementNS(cell.namespaceURI, `${cell.prefix ? cell.prefix + ':' : ''}cellMargin`); cell.appendChild(margin); }
        for (const side of ['left','right']) margin.setAttribute(side,'300');
        for (const side of ['top','bottom']) margin.setAttribute(side,'250');
        const list = child(cell,'subList');
        if (!list) continue;
        list.setAttribute('vertAlign','CENTER');
        list.setAttribute('lineWrap','BREAK');
        list.setAttribute('textWidth',String(Math.max(1,widths[column]-600)));
        for (const p of all(list,'p')) {
          p.setAttribute('paraPrIDRef',rowIndex===0 || column===1 ? styles.center : styles.left);
          p.setAttribute('pageBreak','0'); p.setAttribute('columnBreak','0');
          children(p,'linesegarray').forEach(n=>n.remove());
        }
        for (const run of all(list,'run')) run.setAttribute('charPrIDRef',styles.normal);
        for (const equation of all(list,'equation')) {
          const factor = RUBRIC_FONT_SIZE / num(equation,'baseUnit',RUBRIC_FONT_SIZE);
          const eqSize = child(equation,'sz');
          if (eqSize) for (const dimension of ['width','height']) eqSize.setAttribute(dimension,String(Math.round(num(eqSize,dimension)*factor)));
          equation.setAttribute('baseUnit',String(RUBRIC_FONT_SIZE));
          equation.setAttribute('font','HancomEQN');
          equation.setAttribute('textColor','#000000');
        }
      }
    }
    return true;
  };
}

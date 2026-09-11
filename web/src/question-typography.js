const name = n => n.localName || n.nodeName.split(':').pop();
const all = (n,t) => [...n.getElementsByTagNameNS('*',t)];
const child = (n,t) => [...n.children].find(c=>name(c)===t);
const size = 1000;

/** Normalize copied question and solution text; leave template text separate. */
export function createQuestionTypographyNormalizer(header) {
  const cache = new Map();
  let fontIds;
  function fonts() {
    if (fontIds) return fontIds;
    fontIds = {};
    for (const list of all(header,'fontface')) {
      let font = [...list.children].find(n=>n.getAttribute('face')==='함초롬바탕');
      if (!font) {
        font = header.createElementNS(list.namespaceURI,`${list.prefix ? list.prefix+':' : ''}font`);
        font.setAttribute('id',String(Math.max(-1,...[...list.children].map(n=>Number(n.getAttribute('id'))))+1));
        font.setAttribute('face','함초롬바탕'); font.setAttribute('type','TTF'); font.setAttribute('isEmbedded','0');
        list.appendChild(font); list.setAttribute('fontCnt',String(list.children.length));
      }
      fontIds[list.getAttribute('lang').toLowerCase()]=font.getAttribute('id');
    }
    return fontIds;
  }
  function styleFor(id) {
    if(cache.has(id))return cache.get(id);
    const list=all(header,'charProperties')[0];
    const source=[...(list?.children || [])].find(n=>n.getAttribute('id')===id);
    if(!source)return id;
    if(source.getAttribute('textColor')?.toUpperCase()==='#FFFFFF' && Number(source.getAttribute('height'))<=100)return id;
    const clone=source.cloneNode(true);
    clone.setAttribute('height',String(size));
    [...clone.children].filter(n=>name(n)==='bold').forEach(n=>n.remove());
    const ref=child(clone,'fontRef');
    if(ref)for(const [lang,fontId] of Object.entries(fonts()))ref.setAttribute(lang,fontId);
    for(const [tag,value] of [['ratio',100],['relSz',100],['spacing',0],['offset',0]]) {
      const node=child(clone,tag);
      if(node)for(const attr of [...node.attributes])node.setAttribute(attr.name,String(value));
    }
    const signature=node=>{const c=node.cloneNode(true);c.removeAttribute('id');return new XMLSerializer().serializeToString(c);};
    let match=[...list.children].find(n=>signature(n)===signature(clone));
    if(!match){
      clone.setAttribute('id',String(Math.max(-1,...[...list.children].map(n=>Number(n.getAttribute('id'))))+1));
      list.appendChild(clone);list.setAttribute('itemCnt',String(list.children.length));match=clone;
    }
    cache.set(id,match.getAttribute('id'));return match.getAttribute('id');
  }
  function visit(node) {
    const tag=name(node);
    if(['header','footer','secPr','pic'].includes(tag))return;
    if(tag==='run')node.setAttribute('charPrIDRef',styleFor(node.getAttribute('charPrIDRef')));
    if(tag==='equation'){
      const old=Number(node.getAttribute('baseUnit')) || size;
      const box=child(node,'sz');
      if(box)for(const dimension of ['width','height'])box.setAttribute(dimension,String(Math.round(Number(box.getAttribute(dimension))*size/old)));
      node.setAttribute('baseUnit',String(size));node.setAttribute('font','HancomEQN');
      child(node,'pos')?.setAttribute('affectLSpacing','1');
    }
    if(tag==='p') [...node.children].filter(n=>name(n)==='linesegarray').forEach(n=>n.remove());
    [...node.children].forEach(visit);
  }
  return roots=>roots.forEach(visit);
}

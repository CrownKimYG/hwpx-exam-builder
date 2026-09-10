import { compileBankQuotaRules, parseSlotReferences, seededRandom } from './quick-generator.js';

export function compileMixedRules(banks, rows) {
  const size = compileBankQuotaRules(banks).size;
  const allowed = (value, label, count) => {
    const slots = parseSlotReferences(String(value || 'All').replace(/(\d+)\s*[-–～]\s*#?(\d+)/g, '$1~$2'), size);
    if (slots.length < count) throw new Error(`${label}: ${count}문항을 배치해야 하지만 허용 번호는 ${slots.length}개입니다.`);
    return slots;
  };
  const compiledBanks = banks.map(b => ({...b, slots:allowed(b.range,b.name,b.count)}));
  if (!rows?.length) throw new Error('혼합 배치 조건을 한 개 이상 추가하세요.');
  const compiledRows = rows.map((r,i) => {
    const count = Number(r.count);
    if (!Number.isInteger(count) || count < 0 || count > size) throw new Error(`조건 ${i+1}: 문항 수를 0~${size}로 입력하세요.`);
    if (r.bankId && !banks.some(b=>b.bankId===r.bankId)) throw new Error(`조건 ${i+1}: 은행을 다시 선택하세요.`);
    return {...r,count,slots:allowed(r.range,`조건 ${i+1}`,count)};
  });
  if (compiledRows.reduce((sum,r)=>sum+r.count,0)!==size) throw new Error(`조건별 문항 수 합계를 전체 ${size}문항에 맞춰 주세요.`);
  return {kind:'mixed',size,banks:compiledBanks,rows:compiledRows};
}

export function allocateMixedExamSets({questions,rules,examCount,usedCodes=new Set(),seed='mixed', nodeLimit=150000}) {
  if (!Number.isInteger(examCount)||examCount<1) throw new Error('시험지 수를 1 이상 입력하세요.');
  if (examCount*rules.size>1000) throw new Error('혼합 배치는 한 번에 총 1,000문항까지 출제할 수 있습니다. 부수를 나눠 주세요.');
  const random=seededRandom(seed);
  const shuffle=items=>{ const a=[...items]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
  const bankIndex=new Map(rules.banks.map((b,i)=>[b.bankId,i]));
  const groups=new Map();
  for(const q of questions) {
    if(usedCodes.has(q.code)||!bankIndex.has(q.bankId)) continue;
    const key=JSON.stringify([q.bankId,q.unitKey,q.difficulty]);
    if(!groups.has(key)) groups.set(key,{...q,bank:bankIndex.get(q.bankId),codes:[]});
    groups.get(key).codes.push(q.code);
  }
  const pool=shuffle([...groups.values()]).map(g=>({...g,codes:shuffle(g.codes)}));
  for (const bank of rules.banks) {
    const available=pool.filter(g=>g.bankId===bank.bankId).reduce((n,g)=>n+g.codes.length,0);
    if (available<bank.count*examCount) throw new Error(`${bank.name}: 미사용 문항 ${available}개로 ${bank.count*examCount}문항을 구성할 수 없습니다.`);
  }
  for (const [i,row] of rules.rows.entries()) {
    const available=pool.filter(g=>(!row.bankId||row.bankId===g.bankId)&&(!row.unitKey||row.unitKey===g.unitKey)&&(!row.difficulty||row.difficulty===g.difficulty)).reduce((n,g)=>n+g.codes.length,0);
    if(available<row.count*examCount) throw new Error(`조건 ${i+1}: 미사용 문항 ${available}개, 필요한 문항 ${row.count*examCount}개입니다.`);
  }
  const remaining=pool.map(g=>g.codes.length);
  const options=Array.from({length:rules.size},(_,s)=>shuffle(rules.rows.flatMap((r,ri)=>
    r.slots.includes(s+1)?pool.flatMap((g,gi)=>rules.banks[g.bank].slots.includes(s+1)&&(!r.bankId||r.bankId===g.bankId)&&(!r.unitKey||r.unitKey===g.unitKey)&&(!r.difficulty||r.difficulty===g.difficulty)?[{ri,gi,bi:g.bank}]:[]):[])));
  const demands=Array.from({length:examCount},(_,e)=>Array.from({length:rules.size},(_,s)=>({e,s}))).flat();
  const bankLeft=Array.from({length:examCount},()=>rules.banks.map(b=>b.count));
  const rowLeft=Array.from({length:examCount},()=>rules.rows.map(r=>r.count));
  const assigned=Array(demands.length).fill(null);
  let nodes=0;
  const deadline=Date.now()+2000;
  function search(depth) {
    if(++nodes>nodeLimit || Date.now()>deadline) throw new Error('조건 조합 탐색 한도에 도달했습니다. 부수를 줄이거나 허용 번호 범위를 넓혀 주세요. 조건을 완화해 출제하지는 않았습니다.');
    if(depth===demands.length) return true;
    let best=-1,bestOptions;
    const bankSlots=bankLeft.map(a=>a.map(()=>0)); const rowSlots=rowLeft.map(a=>a.map(()=>0));
    for(let i=0;i<demands.length;i++) {
      if(assigned[i]) continue;
      const {e,s}=demands[i];
      const choices=options[s].filter(o=>remaining[o.gi]>0&&bankLeft[e][o.bi]>0&&rowLeft[e][o.ri]>0);
      if(!choices.length) return false;
      for(const b of new Set(choices.map(o=>o.bi))) bankSlots[e][b]++;
      for(const r of new Set(choices.map(o=>o.ri))) rowSlots[e][r]++;
      if(best<0||choices.length<bestOptions.length){best=i;bestOptions=choices;}
    }
    for(let e=0;e<examCount;e++) {
      if(bankLeft[e].some((n,b)=>n>bankSlots[e][b])||rowLeft[e].some((n,r)=>n>rowSlots[e][r])) return false;
    }
    const {e}=demands[best];
    for(const o of bestOptions) {
      assigned[best]=o; remaining[o.gi]--; bankLeft[e][o.bi]--; rowLeft[e][o.ri]--;
      if(search(depth+1)) return true;
      assigned[best]=null; remaining[o.gi]++; bankLeft[e][o.bi]++; rowLeft[e][o.ri]++;
    }
    return false;
  }
  for(let s=0;s<options.length;s++) if(!options[s].length) throw new Error(`#${s+1}: 은행·단원·난이도 범위를 만족하는 미사용 문항이 없습니다.`);
  if(!search(0)) throw new Error('은행별 수량·조건별 수량·번호 범위를 동시에 만족하는 미사용 문항 조합이 없습니다. 수량이나 범위를 확인하세요.');
  const result=Array.from({length:examCount},()=>Array(rules.size));
  assigned.forEach((o,i)=>{const {e,s}=demands[i];result[e][s]=pool[o.gi].codes.pop();});
  return result;
}

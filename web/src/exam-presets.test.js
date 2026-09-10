import test from "node:test";
import assert from "node:assert/strict";
import { createExamPreset, applyExamPreset, presetRules, readExamPresets, writeExamPresets } from "./exam-presets.js";
const profiles = [{ bankId:"a", displayName:"은행 A", ruleId:"math" }, { bankId:"b", displayName:"은행 B", ruleId:"math" }];
const quick = { examName:"중간고사", examCount:2, seed:"keep-this-seed", bankCounts:{a:2,b:1}, cells:{
  '["a","unit1","lv1"]':"1", '["a","unit2","lv3"]':"2", '["b",null,"lv2"]':"All",
} };
const create = () => createExamPreset({id:"test",name:"세부 출제",profiles,quick,mode:"matrix"});
test("저장과 재적용 후 문항 위치별 은행·단원·난이도 조건을 보존한다", () => {
  const preset = JSON.parse(JSON.stringify(create()));
  const restored = applyExamPreset(preset, [...profiles, {bankId:"extra"}], {a:["unit1","unit2"],b:[]}, {seed:"new-seed"});
  assert.deepEqual(restored.cells,quick.cells);
  assert.deepEqual(restored.bankCounts,{a:2,b:1,extra:0});
  assert.equal(restored.seed,"new-seed");
  assert.equal(restored.examCount,2);
  assert.equal(presetRules(preset).size,3);
  assert.deepEqual(presetRules(preset).get(2), [{unitKey:"unit2", difficulty:"lv3", bankId:"a"}]);
});
test("사라진 단원이나 은행·변경된 처리 방식을 임의 대체하지 않는다", () => {
  assert.throws(() => applyExamPreset(create(),profiles,{a:["unit1"],b:[]},quick), /단원/);
  assert.throws(() => applyExamPreset(create(),[],{},quick), /문제은행/);
  assert.throws(() => applyExamPreset(create(),[{...profiles[0],ruleId:"changed"},profiles[1]],{},quick), /처리 방식/);
});
test("누락된 문항 위치 조건은 저장하지 않는다", () => {
  assert.throws(() => createExamPreset({id:"x",name:"test",profiles,quick:{...quick,cells:{}},mode:"matrix"}));
});
test("조건 수정이 저장된 템플릿에 영향을 주지 않는다", () => {
  const preset = create();
  const restored = applyExamPreset(preset,profiles,{a:["unit1","unit2"],b:[]},quick);
  restored.cells['["a","unit1","lv1"]'] = "2";
  assert.equal(preset.banks[0].cells[0].value,"1");
});
test("여러 템플릿 보관 및 저장 실패를 전달한다", () => {
  const values = new Map(); const storage = {getItem:k => values.get(k),setItem:(k,v) => values.set(k,v)};
  writeExamPresets(storage,[create(),{...create(),id:"second"}]);
  assert.equal(readExamPresets(storage).length,2);
  assert.throws(() => writeExamPresets({setItem(){throw new Error("quota");}},[create()]),/quota/);
});

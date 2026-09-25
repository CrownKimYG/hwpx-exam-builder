export const TRACKS = ['인문계', '자연계'];
export function difficultyCounts(values, size) {
  const counts = Object.fromEntries(['lv1', 'lv2', 'lv3'].map(k => [k, values?.[k] === '' || values?.[k] == null ? NaN : Number(values[k])]));
  if (Object.values(counts).some(n => !Number.isInteger(n) || n < 0)) throw new Error('하·중·상 문항 수를 각각 입력하세요.');
  if (Object.values(counts).reduce((a, b) => a + b, 0) !== size) throw new Error(`난이도 합계를 ${size}문항으로 맞추세요.`);
  return counts;
}
export function seriesSignature(quick, track) {
  return JSON.stringify([quick.questionCount, quick.examCount, quick.examName, quick.grouped, quick.series?.[track]?.counts]);
}
export function seriesExams(state, track) {
  const saved = state.quick.series?.[track];
  if (!saved?.result || saved.result.signature !== seriesSignature(state.quick, track)) return [];
  const exams = saved.result.exams.map(snapshot => state.exams.find(e => e.id === snapshot.id && e.codesText === snapshot.codesText));
  return exams.every(Boolean) ? exams : [];
}

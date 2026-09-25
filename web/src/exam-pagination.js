// Measure only the page areas needed by the requested output. Final output
// validation remains the caller's responsibility for every generated variant.
export async function prepareExamPagination({ variants, explicitSolutionSlot, assembleProblem, pageCount, removeEndnotes, appendBlank, check = () => {} }) {
  const problem = variants.includes('problem'), solution = variants.includes('solution');
  if (!problem && (!solution || explicitSolutionSlot)) return { problemBytes: null, problemContentPages: null, solutionNeedsBlankPage: false };
  let problemBytes = await assembleProblem(); check();
  let problemOutputPages = null, problemContentPages = null;
  if (!explicitSolutionSlot && problem) { problemOutputPages = await pageCount(problemBytes); check(); }
  if (!explicitSolutionSlot && solution) {
    const content = await removeEndnotes(problemBytes); check();
    problemContentPages = await pageCount(content); check();
  }
  if (problemOutputPages !== null && problemOutputPages % 2 === 1) { problemBytes = await appendBlank(problemBytes); check(); }
  return { problemBytes, problemContentPages, solutionNeedsBlankPage: problemContentPages !== null && problemContentPages % 2 === 1 };
}

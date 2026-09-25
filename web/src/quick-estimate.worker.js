import { allocateExamSets, estimateMaximumExamSets } from './quick-generator.js';
self.onmessage = ({ data }) => {
  try {
    if (data.rules.kind === 'mixed') {
      allocateExamSets(data); self.postMessage({ requested: data.examCount });
    } else self.postMessage({ maximum: estimateMaximumExamSets(data) });
  } catch (error) { self.postMessage({ error: error.message }); }
};

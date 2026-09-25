import { estimateGroupedCapacity } from './grouped-capacity.js';
self.onmessage = ({ data }) => {
  try { self.postMessage(estimateGroupedCapacity(data)); }
  catch (error) { self.postMessage({ error: error.message }); }
};

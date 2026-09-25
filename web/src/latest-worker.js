// A cancelled worker can still have a queued event; the generation guard also
// prevents its result from replacing the status for newer input.
export function latestWorker(create) {
  let current = null, generation = 0;
  const cancel = () => { generation++; current?.terminate(); current = null; };
  return {
    cancel,
    run(data, receive) {
      cancel(); const token = generation;
      try {
        const worker = create(); current = worker;
        const finish = result => { if (token !== generation) return; cancel(); receive(result); };
        worker.onmessage = event => finish(event.data);
        worker.onerror = () => finish({ error: '가능 부수 계산에 실패했습니다. 조건을 다시 확인하세요.' });
        worker.postMessage(data);
      } catch (error) { cancel(); receive({ error: `가능 부수 계산 실패: ${error.message}` }); }
    },
  };
}

export const WORKSPACE_DRAFT_KEY = "exam-builder-workspace-v1";
export class WorkspaceConflictError extends Error {
  constructor() { super("다른 탭에서 작업이 변경되었습니다. 최신 작업을 불러온 뒤 계속해 주세요."); }
}

export function createWorkspaceStore(storage) {
  let expected;
  let payload;
  try { expected = storage.getItem(WORKSPACE_DRAFT_KEY); } catch { /* A later explicit retry may succeed. */ }
  return {
    read() { return JSON.parse(storage.getItem(WORKSPACE_DRAFT_KEY) || "null"); },
    adopt() {
      const raw = storage.getItem(WORKSPACE_DRAFT_KEY);
      const draft = JSON.parse(raw || "null");
      expected = raw;
      if (draft) { const { revision, savedAt, ...content } = draft; payload = JSON.stringify(content); }
      else payload = undefined;
      return draft;
    },
    save(draft) {
      const current = storage.getItem(WORKSPACE_DRAFT_KEY);
      if (expected === undefined) expected = current;
      if (current !== expected) throw new WorkspaceConflictError();
      const nextPayload = JSON.stringify(draft);
      if (nextPayload === payload) return false;
      // The caller serializes cross-tab writes with Web Locks. The expected
      // revision also prevents an old tab from overwriting a newer snapshot.
      const raw = JSON.stringify({ ...draft, revision: crypto.randomUUID(), savedAt: new Date().toISOString() });
      storage.setItem(WORKSPACE_DRAFT_KEY, raw);
      expected = raw;
      payload = nextPayload;
      return true;
    },
  };
}

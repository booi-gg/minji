import type { Account, ApiError, RevisionDto, SyncItem, WorkspaceDoc } from "./protocol.ts";

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers,
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json()) as T | ApiError;
  if (!response.ok) throw new ApiFailure(response.status, body as ApiError);
  return body as T;
};

export const getAccount = (): Promise<Account> => request("/api/me");
export const logOut = (): Promise<void> => request("/api/auth/logout", { method: "POST" });
export const pullChanges = (
  since: number,
): Promise<{ items: SyncItem[]; cursor: number; more: boolean }> =>
  request(`/api/workspaces?since=${since}`);
export const pushWorkspace = (
  id: string,
  baseRevision: number,
  doc: WorkspaceDoc,
): Promise<{ revision: number; seq: number }> =>
  request(`/api/workspaces/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ baseRevision, doc }),
  });
export const deleteWorkspace = (
  id: string,
  baseRevision: number,
): Promise<{ revision: number; seq: number }> =>
  request(`/api/workspaces/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: JSON.stringify({ baseRevision }),
  });
export const pullRevisions = (id: string): Promise<{ items: RevisionDto[] }> =>
  request(`/api/workspaces/${encodeURIComponent(id)}/revisions`);
export const pushRevisions = (id: string, items: RevisionDto[]): Promise<{ accepted: string[] }> =>
  request(`/api/workspaces/${encodeURIComponent(id)}/revisions`, {
    method: "POST",
    body: JSON.stringify({ items }),
  });

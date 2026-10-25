import { Case, DocumentAssertion, Person } from "./types";
export type Snapshot = { case: Case; people: Person[]; documents: DocumentAssertion[] };
export type ShareRecord = {
  id: string;
  owner_token: string;
  helper_token: string;
  revision: number;
  expires_at: number;
  lastSyncedCase?: Case;
  shareNotes?: boolean;
};
export class ShareError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail: any,
  ) {
    super(message);
  }
}
export async function shareRequest(
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
): Promise<any> {
  const r = await fetch("/api/helper-shares" + path, {
    method,
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok)
    throw new ShareError(
      typeof data.detail === "string"
        ? data.detail
        : data.detail?.message || "Could not access this case",
      r.status,
      data.detail,
    );
  return data;
}
export const helperUrl = (s: ShareRecord) => `${location.origin}/helper/${s.id}#${s.helper_token}`;

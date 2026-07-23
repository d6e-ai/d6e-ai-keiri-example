# Workspace members and invitations

Admin and membership routes under `/api/v1/workspaces/{id}/members` and
`/invitations`. Workspace is resolved from the **path** `{id}` plus membership
check. `X-Workspace-ID` is optional; if sent it must match the path.

See [auth-header-matrix.md](./auth-header-matrix.md).

## Members

| Method | Path | Auth | Response |
| ------ | ---- | ---- | -------- |
| `GET` | `/api/v1/workspaces/{id}/members` | Bearer (any member) | `MemberInfo[]` |
| `POST` | `/api/v1/workspaces/{id}/members` | Bearer (admin) | `AddMemberResponse` |
| `PATCH` | `/api/v1/workspaces/{id}/members/{memberId}` | Bearer (admin) | `MemberInfo` |
| `DELETE` | `/api/v1/workspaces/{id}/members/{memberId}` | Bearer (admin) | 204 |

### Auth

```
Authorization: Bearer <jwt>
Content-Type: application/json
```

### MemberInfo

```ts
interface MemberInfo {
  id: string;              // membership row id
  user_id: string;
  user_email: string;
  user_name: string;
  role: 'admin' | 'member';
  created_at: string;
}
```

Roles: `admin` | `member` (serialized as `WorkspaceRole` enum).

## POST — discriminated membership | invitation

Adding a member by email returns **either** a new membership **or** a pending
invitation — never both. The response shape is discriminated:

```ts
interface AddMemberResponse {
  membership?: MemberInfo;    // email matched existing user
  invitation?: InvitationInfo; // email not yet provisioned
}
```

**Request:**

```json
POST /api/v1/workspaces/{wsId}/members
{
  "email": "colleague@example.com",
  "role": "member"
}
```

`role` defaults to `member` when omitted.

**Frontend UX:** branch on which field is set — show "Member added" vs
"Invitation sent" toasts.

### InvitationInfo

```ts
interface InvitationInfo {
  id: string;
  workspace_id: string;
  email: string;
  role: 'admin' | 'member';
  invited_by_user_id?: string | null;
  invited_by_user_name?: string | null;
  created_at: string;
}
```

Pending invitations are auto-consumed when the invitee first authenticates
(server-side `apply_pending_invitations`).

## PATCH — role change

```json
PATCH /api/v1/workspaces/{wsId}/members/{memberId}
{ "role": "admin" }
```

## DELETE — remove member

```
DELETE /api/v1/workspaces/{wsId}/members/{memberId}
```

## LAST_ADMIN guard

Demoting or removing the **last admin** of a workspace returns:

```json
{
  "code": "LAST_ADMIN",
  "message": "Cannot remove the last administrator of this workspace"
}
```

HTTP status is 409-style conflict (via `ApiError::last_admin_protected`).
Admin UIs must disable demote/remove when only one admin remains, or prompt
the user to promote another member first.

Applies to:

- PATCH demoting last admin to `member`
- DELETE removing last admin membership

## Invitations (admin)

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| `GET` | `/api/v1/workspaces/{id}/invitations` | Bearer (admin) | List pending invitations |
| `DELETE` | `/api/v1/workspaces/{id}/invitations/{invitationId}` | Bearer (admin) | Cancel invitation |

Invitations are created only via `POST …/members` when the email has no user
account yet. There is no standalone POST invitations endpoint.

## Membership probe

Custom frontends use `GET /api/v1/workspaces/{id}` as an allow-list probe during
OAuth callback:

- `200` → user is a member; proceed to app
- `403` / `404` → route to `/auth/no-access`

See [`d6e-auth-integration`](../../d6e-auth-integration/SKILL.md).

## Server-side pinning

Pin `{id}` from `D6E_WORKSPACE_ID`. Never let the browser choose which
workspace to administer unless you operate a multi-workspace admin console with
explicit workspace switching and per-request validation.

## Related

- [api-catalog.md](./api-catalog.md) — master index
- [auth-header-matrix.md](./auth-header-matrix.md) — auth transport

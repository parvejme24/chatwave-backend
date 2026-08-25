# ChatWave API

NestJS API for ChatWave. The Next.js app at `http://localhost:3000` talks to this server at `http://localhost:5000` (or `PORT`). Auth, Users, Conversations, and Messages (REST + Socket.IO) are implemented; calls and contacts come later.

## Setup

```bash
pnpm install
cp .env.example .env
```

Fill in `.env`. MongoDB and Redis are required. SMTP, Cloudinary, Google, and GitHub can stay empty while you build locally.

### MongoDB

Use MongoDB Atlas (`MONGODB_URI`) or run locally:

```bash
docker run -d --name chatwave-mongo -p 27017:27017 mongo:7
```

```
MONGODB_URI=mongodb://127.0.0.1:27017
DB_NAME=chatwave-db
```

### Redis

Sessions, password-reset OTPs, and live presence live in Redis, not MongoDB.

```bash
docker run -d --name chatwave-redis -p 6379:6379 redis:7
```

```
REDIS_URL=redis://127.0.0.1:6379
```

For Redis Cloud / TLS, set `REDIS_TLS=true`.

### Run

```bash
pnpm start:dev
```

The API prints `Server is running at http://localhost:5000`.

Google callback: `{API_URL}/api/auth/google/callback`  
GitHub callback: `{API_URL}/api/auth/github/callback`

## Auth examples

Register (does not sign you in):

```bash
curl -s -X POST http://localhost:5000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ayesha Rahman","email":"ayesha@example.com","password":"password1"}'
```

Login (sets `cw_session` cookie and returns `accessToken`):

```bash
curl -s -c cookies.txt -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ayesha@example.com","password":"password1"}'
```

Current user:

```bash
curl -s -b cookies.txt http://localhost:5000/api/auth/me
```

Forgot password (always `{ "ok": true }`):

```bash
curl -s -X POST http://localhost:5000/api/auth/forgot-password \
  -H 'Content-Type: application/json' \
  -d '{"email":"ayesha@example.com"}'
```

Reset password:

```bash
curl -s -X POST http://localhost:5000/api/auth/reset-password \
  -H 'Content-Type: application/json' \
  -d '{"email":"ayesha@example.com","otp":"123456","password":"newpass12"}'
```

Logout:

```bash
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:5000/api/auth/logout
```

## Users examples

Current profile (settings screen):

```bash
curl -s -b cookies.txt http://localhost:5000/api/users/me
```

Update name, username, role, location, or avatar tone:

```bash
curl -s -b cookies.txt -X PATCH http://localhost:5000/api/users/me \
  -H 'Content-Type: application/json' \
  -d '{"name":"Md Parvej","username":"parvej","role":"Full-stack developer","location":"Dhaka","tone":"a"}'
```

Search people (Contacts + create-group picker):

```bash
curl -s -b cookies.txt 'http://localhost:5000/api/users/search?q=nadia&limit=20'
```

Heartbeat / presence (`online`, `away`, or `offline`):

```bash
curl -s -b cookies.txt -X PATCH http://localhost:5000/api/users/me/presence \
  -H 'Content-Type: application/json' \
  -d '{"presence":"online"}'
```

Public profile and people currently online:

```bash
curl -s -b cookies.txt http://localhost:5000/api/users/online
curl -s -b cookies.txt http://localhost:5000/api/users/by-username/nadia
```

`GET /api/auth/me` and `PATCH /api/auth/profile` still work; they call the Users service.

## Conversations examples

List chats (chips: `all`, `unread`, `groups`, `archived`; `calls` returns `[]` until Calls exist):

```bash
curl -s -b cookies.txt 'http://localhost:5000/api/conversations?filter=all&limit=50'
```

Start a direct chat (200 if it already exists, otherwise 201):

```bash
curl -s -b cookies.txt -X POST http://localhost:5000/api/conversations/direct \
  -H 'Content-Type: application/json' \
  -d '{"userId":"64a000000000000000000002"}'
```

Create a group (name + at least 3 other people; you become admin):

```bash
curl -s -b cookies.txt -X POST http://localhost:5000/api/conversations/groups \
  -H 'Content-Type: application/json' \
  -d '{"name":"Frontend Guild","memberIds":["64a000000000000000000002","64a000000000000000000003","64a000000000000000000004"]}'
```

Pin to top and mark a thread read:

```bash
curl -s -b cookies.txt -X PATCH http://localhost:5000/api/conversations/CONVERSATION_ID/membership \
  -H 'Content-Type: application/json' \
  -d '{"pinned":true}'

curl -s -b cookies.txt -X POST http://localhost:5000/api/conversations/CONVERSATION_ID/read
```

## Messages examples

List a thread (oldest → newest in the page). `view=pinned` filters pins; `q` searches text, caption, and file name:

```bash
curl -s -b cookies.txt 'http://localhost:5000/api/conversations/CONVERSATION_ID/messages?limit=30'

curl -s -b cookies.txt 'http://localhost:5000/api/conversations/CONVERSATION_ID/messages?view=pinned&q=waveform'
```

Send a text message (201). Media (`image`, `file`, `voice`, `video_note`) is multipart field `file` on the same path:

```bash
curl -s -b cookies.txt -X POST http://localhost:5000/api/conversations/CONVERSATION_ID/messages \
  -H 'Content-Type: application/json' \
  -d '{"type":"text","text":"the waveform looks good"}'
```

React, pin, or delete (query `scope=me|everyone`, default `me`):

```bash
curl -s -b cookies.txt -X POST http://localhost:5000/api/messages/MESSAGE_ID/reactions \
  -H 'Content-Type: application/json' \
  -d '{"emoji":"🔥"}'

curl -s -b cookies.txt -X POST http://localhost:5000/api/messages/MESSAGE_ID/pin

curl -s -b cookies.txt -X DELETE 'http://localhost:5000/api/messages/MESSAGE_ID?scope=me'
```

Mark delivered / seen (seen also clears unread via the same path as `POST /conversations/:id/read`):

```bash
curl -s -b cookies.txt -X POST http://localhost:5000/api/conversations/CONVERSATION_ID/delivered
curl -s -b cookies.txt -X POST http://localhost:5000/api/conversations/CONVERSATION_ID/seen
```

REST history DTOs include `dir` (`in` | `out`) relative to you. Socket payloads are canonical: same fields, plus `senderId` instead of `dir`. Map locally with `dir = message.senderId === me ? "out" : "in"`. Reaction objects on the socket may include `userIds` so the client can set `mine`.

## Socket.IO

Same origin and port as HTTP is fine (`http://localhost:5000`), path `/socket.io`. CORS origin is `FRONTEND_URL` with credentials. Auth is the `cw_session` cookie **or** `handshake.auth.token` / `Authorization: Bearer` JWT (`sub` + `sid`).

```ts
import { io } from "socket.io-client"

const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL, {
  withCredentials: true,
  auth: { token },
})

socket.emit("conversation:join", { conversationId })
socket.on("message:new", handler)
```

| Client emit | Payload | Server emit | Payload |
| --- | --- | --- | --- |
| `conversation:join` | `{ conversationId }` | `conversation:joined` | `{ conversationId }` |
| `conversation:leave` | `{ conversationId }` | | |
| `message:send` | `{ conversationId, type: "text", text, replyTo?, clientId? }` | `message:new` | `{ message }` canonical |
| | | ACK | `{ ok, message, clientId }` viewer DTO (`dir: "out"`) |
| `typing:start` / `typing:stop` | `{ conversationId }` | `typing` | `{ conversationId, userId, name, typing }` |
| `message:delivered` | `{ conversationId, messageId? }` | `receipts:updated` | `{ conversationId, messageId, receipts }` |
| `message:seen` | `{ conversationId, messageId? }` | `receipts:updated` | same |
| | | `message:updated` | `{ message }` pin / reaction |
| | | `message:deleted` | `{ id, conversationId, scope: "me" \| "everyone" }` |
| | | `conversation:preview` | `{ conversationId, preview, previewIcon, lastMessageAt, unread }` to `user:{id}` |

Rooms: `conversation:{conversationId}` (open thread) and `user:{userId}` (sidebar unread / preview). Upload media with REST; the server broadcasts `message:new`. Text can go through REST or `message:send` — both use `MessagesService.send`.

## Env

See `.env.example` for `PORT`, `FRONTEND_URL`, `API_URL`, Mongo, Redis, JWT/session secrets, Google, GitHub, SMTP, and Cloudinary.

## Tests

```bash
pnpm test
```

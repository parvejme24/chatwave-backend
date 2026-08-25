# ChatWave API

NestJS API for ChatWave. The Next.js app at `http://localhost:3000` talks to this server at `http://localhost:5000` (or `PORT`). Auth and Users are implemented; chats, groups, and calls come later.

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

## Env

See `.env.example` for `PORT`, `FRONTEND_URL`, `API_URL`, Mongo, Redis, JWT/session secrets, Google, GitHub, SMTP, and Cloudinary.

## Tests

```bash
pnpm test
```

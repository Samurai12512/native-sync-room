# Railway deployment

## One-time setup

1. Push this repository to GitHub.
2. In Railway, choose **New Project**.
3. Select **Deploy from GitHub repo**.
4. Pick this repo.
5. Add the TURN environment variables from `docs/coturn.md`.
6. Deploy.

Railway will use `railway.json`, install dependencies, run `npm start`, and check `/health`.

## Variables

Required for reliable worldwide streaming:

```text
TURN_URL=turn:turn.yourdomain.com:3478,turns:turn.yourdomain.com:5349
TURN_USERNAME=syncuser
TURN_CREDENTIAL=replace-with-a-long-random-password
```

Optional:

```text
PORT=3030
```

Railway normally sets `PORT` automatically, so you usually do not need to set it yourself.

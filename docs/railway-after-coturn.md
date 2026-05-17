# What to do in Railway after coturn is running

## 1. Create the Railway app

1. Go to Railway.
2. Click **New Project**.
3. Choose **Deploy from GitHub repo**.
4. Select `Samurai12512/native-sync-room`.
5. Let Railway deploy once.

## 2. Add TURN variables

In the Railway project:

1. Open the service.
2. Go to **Variables**.
3. Add:

```text
TURN_URL=turn:turn.yourdomain.com:3478,turns:turn.yourdomain.com:5349
TURN_USERNAME=syncuser
TURN_CREDENTIAL=replace-with-a-long-random-password
```

Use the same username/password you gave the coturn install script.

## 3. Redeploy

After adding variables, trigger a redeploy or let Railway redeploy automatically.

## 4. Test the app

Open the Railway public URL, start hosting, click **Share screen**, and send the room link to the viewer.

To confirm the frontend received TURN config, open:

```text
https://your-railway-domain/config.js
```

It should include your `turn:` and `turns:` URLs.

## 5. Optional custom domain

You can later add:

```text
sync.yourdomain.com -> Railway
turn.yourdomain.com -> VPS
```

Keep those separate. `sync` is the web app. `turn` is the relay server.

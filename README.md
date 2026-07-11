# BuildLab Zambia WhatsApp Bot for Render

This project receives WhatsApp Cloud API webhooks, records recent messages in a
small browser inbox, marks incoming messages as read, and sends automatic
BuildLab Zambia replies.

## Files

- `server.js` — webhook, automatic replies and testing inbox
- `package.json` — Node.js dependencies and start command
- `.env.example` — environment variable names
- `render.yaml` — optional Render Blueprint configuration
- `.gitignore` — protects local secrets

## 1. Upload to GitHub

Create a GitHub repository and upload all files in this folder.

Do not rename `.gitignore`.
Do not upload a real `.env` file or any access token.

## 2. Create the Render Web Service

In Render:

1. Select **New > Web Service**.
2. Connect the GitHub repository.
3. Use:
   - Runtime: `Node`
   - Build command: `npm install`
   - Start command: `npm start`
4. Deploy the service.

Render automatically provides `PORT`; do not set a fixed production port.

## 3. Add Render environment variables

Open the service and select **Environment**. Add:

- `VERIFY_TOKEN` — create your own private text, for example
  `buildlab_verify_2026_long_private_value`
- `WHATSAPP_TOKEN` — Meta access token
- `PHONE_NUMBER_ID` — WhatsApp Business Phone Number ID, not the visible phone number
- `GRAPH_API_VERSION` — `v25.0`
- `APP_SECRET` — Meta App Secret; optional during initial testing, recommended in production
- `ADMIN_KEY` — a long private password used to open the testing inbox

Save changes and redeploy.

## 4. Configure the Meta webhook

Use this callback URL:

`https://YOUR-RENDER-SERVICE.onrender.com/webhook`

The Verify Token must exactly match the Render `VERIFY_TOKEN`.

After verification, subscribe the WhatsApp Business Account webhook to the
`messages` field.

The code also accepts webhook POST requests at the root URL for compatibility,
but `/webhook` is recommended.

## 5. Test

Open:

`https://YOUR-RENDER-SERVICE.onrender.com/health`

It should return JSON showing that the bot is online.

Send `Hi` from another WhatsApp account to the registered BuildLab number. The
bot should reply with the BuildLab menu.

## 6. View recent messages

Open:

`https://YOUR-RENDER-SERVICE.onrender.com/inbox?key=YOUR_ADMIN_KEY`

The page refreshes every 10 seconds.

Important: this is a temporary testing inbox stored in memory. Render clears it
after a restart, redeploy or free-service sleep. Use PostgreSQL, Firebase or
another database before relying on it for permanent customer records.

## Available automatic replies

- `Hi`, `Hello`, `Menu` — main menu
- `1` — project registration instructions
- `2` — services
- `3` — quotation request
- `4` — human handover and 30-minute automatic-reply pause
- `5` — location

## Common problems

### Meta says the webhook cannot be verified

- Confirm the callback URL ends in `/webhook`.
- Confirm `VERIFY_TOKEN` in Render exactly matches the token entered in Meta.
- Open Render **Logs** and look for `WEBHOOK VERIFIED`.
- Confirm the Render service is deployed and `/health` works.

### Messages arrive but no reply is sent

- Confirm `WHATSAPP_TOKEN` is valid and has not expired.
- Confirm `PHONE_NUMBER_ID` is the Phone Number ID, not the WhatsApp telephone number.
- Check Render **Logs** for the complete WhatsApp API error.
- Confirm the webhook is subscribed to the `messages` field.
- Confirm the recipient has first messaged the business or that an approved
  template is used outside the customer-service window.

### Inbox says Unauthorized

Use:

`/inbox?key=THE_EXACT_ADMIN_KEY_FROM_RENDER`

Do not share the inbox URL because it contains the admin key.

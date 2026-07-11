'use strict';

require('dotenv').config();

const crypto = require('crypto');
const express = require('express');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || 'v25.0';
const APP_SECRET = process.env.APP_SECRET || '';
const ADMIN_KEY = process.env.ADMIN_KEY || '';

if (!VERIFY_TOKEN) {
  console.warn('WARNING: VERIFY_TOKEN is not set.');
}
if (!WHATSAPP_TOKEN) {
  console.warn('WARNING: WHATSAPP_TOKEN is not set.');
}
if (!PHONE_NUMBER_ID) {
  console.warn('WARNING: PHONE_NUMBER_ID is not set.');
}
if (!ADMIN_KEY) {
  console.warn('WARNING: ADMIN_KEY is not set. The inbox page will be disabled.');
}

/*
 * Store the raw request body so X-Hub-Signature-256 can be verified.
 * APP_SECRET is optional during initial testing, but recommended in production.
 */
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buffer) => {
    req.rawBody = buffer;
  }
}));

/*
 * This lightweight inbox is stored in memory.
 * It is useful for testing, but Render will clear it after a restart or redeploy.
 */
const recentMessages = [];
const processedMessageIds = new Map();
const pausedCustomers = new Map();

function addInboxMessage(message) {
  recentMessages.unshift({
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    ...message
  });

  if (recentMessages.length > 200) {
    recentMessages.length = 200;
  }
}

function cleanTemporaryMemory() {
  const now = Date.now();

  for (const [messageId, expiresAt] of processedMessageIds.entries()) {
    if (expiresAt <= now) {
      processedMessageIds.delete(messageId);
    }
  }

  for (const [customerNumber, expiresAt] of pausedCustomers.entries()) {
    if (expiresAt <= now) {
      pausedCustomers.delete(customerNumber);
    }
  }
}

setInterval(cleanTemporaryMemory, 10 * 60 * 1000).unref();

function verifyMetaSignature(req) {
  if (!APP_SECRET) {
    return true;
  }

  const signatureHeader = req.get('x-hub-signature-256');

  if (!signatureHeader || !req.rawBody) {
    return false;
  }

  const expectedSignature =
    'sha256=' +
    crypto
      .createHmac('sha256', APP_SECRET)
      .update(req.rawBody)
      .digest('hex');

  const receivedBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function getWebhookValue(body) {
  return body?.entry?.[0]?.changes?.[0]?.value || null;
}

function getReadableMessage(message) {
  switch (message?.type) {
    case 'text':
      return message.text?.body || '';

    case 'image':
      return message.image?.caption
        ? `[Image] ${message.image.caption}`
        : '[Image received]';

    case 'document':
      return `[Document] ${message.document?.filename || 'Unnamed document'}`;

    case 'audio':
      return '[Audio received]';

    case 'video':
      return message.video?.caption
        ? `[Video] ${message.video.caption}`
        : '[Video received]';

    case 'sticker':
      return '[Sticker received]';

    case 'location':
      return `[Location] ${message.location?.latitude}, ${message.location?.longitude}`;

    case 'contacts':
      return '[Contact received]';

    case 'button':
      return message.button?.text || '[Button reply]';

    case 'interactive':
      return (
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        '[Interactive reply]'
      );

    default:
      return `[Unsupported message type: ${message?.type || 'unknown'}]`;
  }
}

async function callWhatsAppApi(payload) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error(
      'WHATSAPP_TOKEN and PHONE_NUMBER_ID must be set in Render Environment.'
    );
  }

  const url =
    `https://graph.facebook.com/${GRAPH_API_VERSION}/` +
    `${PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `WhatsApp API ${response.status}: ${JSON.stringify(result)}`
    );
  }

  return result;
}

async function sendTextMessage(to, body) {
  const result = await callWhatsAppApi({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: false,
      body
    }
  });

  addInboxMessage({
    direction: 'outgoing',
    customerNumber: to,
    customerName: 'BuildLab Zambia',
    type: 'text',
    text: body,
    whatsappMessageId: result?.messages?.[0]?.id || ''
  });

  console.log(`Reply sent to ${to}`);
  return result;
}

async function markMessageAsRead(messageId) {
  if (!messageId) {
    return;
  }

  await callWhatsAppApi({
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId
  });
}

function menuMessage(firstName) {
  return (
    `Hello ${firstName} 👋\n\n` +
    `Welcome to *BuildLab Zambia*.\n\n` +
    `We help students, innovators, startups, schools and businesses develop practical prototypes and technology projects.\n\n` +
    `Please reply with a number:\n\n` +
    `1️⃣ Register a project\n` +
    `2️⃣ View our services\n` +
    `3️⃣ Request a quotation\n` +
    `4️⃣ Speak to our team\n` +
    `5️⃣ Our location\n\n` +
    `Reply *MENU* at any time to see these options again.`
  );
}

function automaticReply(messageText, customerName) {
  const text = String(messageText || '').trim().toLowerCase();
  const firstName =
    String(customerName || 'there').trim().split(/\s+/)[0] || 'there';

  const greetingWords = new Set([
    'hi',
    'hello',
    'hey',
    'hie',
    'good morning',
    'good afternoon',
    'good evening',
    'start',
    'menu'
  ]);

  if (greetingWords.has(text)) {
    return { reply: menuMessage(firstName), pauseAutomation: false };
  }

  if (
    text === '1' ||
    text === 'register' ||
    text.includes('register project')
  ) {
    return {
      pauseAutomation: false,
      reply:
        `*Project Registration*\n\n` +
        `Please send the following details in one message:\n\n` +
        `Full name:\n` +
        `School, company or organisation:\n` +
        `Project title:\n` +
        `Short project description:\n` +
        `Service required:\n` +
        `Expected completion date:\n` +
        `Estimated budget, if known:\n\n` +
        `You may also attach sketches, photos or reference files.`
    };
  }

  if (
    text === '2' ||
    text === 'services' ||
    text.includes('service')
  ) {
    return {
      pauseAutomation: false,
      reply:
        `*BuildLab Zambia Services*\n\n` +
        `• Prototype design and development\n` +
        `• 3D printing\n` +
        `• CNC machining and engraving\n` +
        `• Electronics and IoT development\n` +
        `• Sensors and monitoring systems\n` +
        `• Mobile and web applications\n` +
        `• Dashboards and data analysis\n` +
        `• Component sourcing\n` +
        `• Technical training\n` +
        `• Complete project construction\n\n` +
        `Reply *1* to register a project or *3* to request a quotation.`
    };
  }

  if (
    text === '3' ||
    text === 'quote' ||
    text === 'quotation' ||
    text.includes('price') ||
    text.includes('cost')
  ) {
    return {
      pauseAutomation: false,
      reply:
        `*Quotation Request*\n\n` +
        `Please send:\n\n` +
        `1. Your name\n` +
        `2. Project or product required\n` +
        `3. Quantity required\n` +
        `4. Dimensions, where applicable\n` +
        `5. Material preference\n` +
        `6. Required completion date\n` +
        `7. Photos, drawings or reference files\n\n` +
        `We will review the information and prepare a quotation.`
    };
  }

  if (
    text === '4' ||
    text === 'human' ||
    text === 'agent' ||
    text.includes('speak to') ||
    text.includes('team member')
  ) {
    return {
      pauseAutomation: true,
      reply:
        `Thank you. Your request has been handed over to the *BuildLab Zambia team*.\n\n` +
        `A team member will respond as soon as possible. You may send a short description of what you need while waiting.\n\n` +
        `Automatic menu replies will pause for 30 minutes. Reply *MENU* to restart them.`
    };
  }

  if (
    text === '5' ||
    text.includes('location') ||
    text.includes('where are you') ||
    text.includes('address')
  ) {
    return {
      pauseAutomation: false,
      reply:
        `BuildLab Zambia operates from *Chingola, Zambia*.\n\n` +
        `Project consultations can also be conducted online or through WhatsApp.`
    };
  }

  return {
    pauseAutomation: false,
    reply:
      `Thank you for contacting *BuildLab Zambia*.\n\n` +
      `We have received your message:\n` +
      `“${String(messageText || '').slice(0, 500)}”\n\n` +
      `Please reply with:\n\n` +
      `1️⃣ Register a project\n` +
      `2️⃣ View services\n` +
      `3️⃣ Request a quotation\n` +
      `4️⃣ Speak to our team\n` +
      `5️⃣ Our location`
  };
}

async function processIncomingMessage(value, message) {
  if (!message?.id || !message?.from) {
    return;
  }

  if (processedMessageIds.has(message.id)) {
    console.log(`Duplicate webhook ignored: ${message.id}`);
    return;
  }

  processedMessageIds.set(message.id, Date.now() + 24 * 60 * 60 * 1000);

  const contact = value.contacts?.find(
    (item) => item.wa_id === message.from
  );

  const customerName =
    contact?.profile?.name || 'WhatsApp customer';

  const readableText = getReadableMessage(message);

  addInboxMessage({
    direction: 'incoming',
    customerNumber: message.from,
    customerName,
    type: message.type || 'unknown',
    text: readableText,
    whatsappMessageId: message.id
  });

  console.log('\n================================');
  console.log('NEW WHATSAPP MESSAGE');
  console.log(`Name: ${customerName}`);
  console.log(`Number: ${message.from}`);
  console.log(`Type: ${message.type}`);
  console.log(`Message: ${readableText}`);
  console.log(`Message ID: ${message.id}`);
  console.log('================================\n');

  try {
    await markMessageAsRead(message.id);
  } catch (error) {
    console.error('Could not mark message as read:', error.message);
  }

  const normalizedText = readableText.trim().toLowerCase();

  if (normalizedText === 'menu') {
    pausedCustomers.delete(message.from);
  } else {
    const pauseUntil = pausedCustomers.get(message.from);

    if (pauseUntil && pauseUntil > Date.now()) {
      console.log(
        `Automatic reply paused for ${message.from} until ${new Date(
          pauseUntil
        ).toISOString()}`
      );
      return;
    }
  }

  if (message.type !== 'text') {
    await sendTextMessage(
      message.from,
      `Thank you, ${customerName}.\n\n` +
        `We received your ${message.type || 'media'} message. ` +
        `Please also send a short text description explaining what you need.`
    );
    return;
  }

  const response = automaticReply(readableText, customerName);

  await sendTextMessage(message.from, response.reply);

  if (response.pauseAutomation) {
    pausedCustomers.set(
      message.from,
      Date.now() + 30 * 60 * 1000
    );
  }
}

async function processWebhook(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const change of changes) {
      const value = change?.value;

      if (!value) {
        continue;
      }

      if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          console.log(
            `Message status: ${status.status} | ` +
            `Recipient: ${status.recipient_id || 'unknown'} | ` +
            `Message ID: ${status.id || 'unknown'}`
          );
        }
      }

      if (Array.isArray(value.messages)) {
        for (const message of value.messages) {
          try {
            await processIncomingMessage(value, message);
          } catch (error) {
            console.error(
              `Message processing failed for ${message?.id || 'unknown'}:`,
              error.message
            );
          }
        }
      }
    }
  }
}

function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  const token = req.query['hub.verify_token'];

  if (
    mode === 'subscribe' &&
    VERIFY_TOKEN &&
    token === VERIFY_TOKEN
  ) {
    console.log('WEBHOOK VERIFIED');
    return res.status(200).send(challenge);
  }

  console.warn('Webhook verification failed.');
  return res.sendStatus(403);
}

function receiveWebhook(req, res) {
  if (!verifyMetaSignature(req)) {
    console.warn('Invalid Meta webhook signature.');
    return res.sendStatus(401);
  }

  /*
   * Acknowledge quickly. Processing continues after the 200 response.
   */
  res.sendStatus(200);

  setImmediate(() => {
    processWebhook(req.body).catch((error) => {
      console.error('Webhook processing error:', error);
    });
  });
}

app.get('/', (req, res) => {
  if (req.query['hub.mode']) {
    return verifyWebhook(req, res);
  }

  return res.status(200).send(
    'BuildLab Zambia WhatsApp bot is online. Use /health for status.'
  );
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'online',
    service: 'BuildLab Zambia WhatsApp Bot',
    apiVersion: GRAPH_API_VERSION,
    time: new Date().toISOString()
  });
});

/*
 * Meta can use either URL:
 * https://YOUR-SERVICE.onrender.com/webhook
 * or https://YOUR-SERVICE.onrender.com/
 *
 * The root POST route is kept for compatibility with an existing setup.
 */
app.get('/webhook', verifyWebhook);
app.post('/webhook', receiveWebhook);
app.get('/verify', verifyWebhook);
app.post('/', receiveWebhook);

function requireAdminKey(req, res, next) {
  const suppliedKey =
    req.query.key ||
    req.get('x-admin-key') ||
    '';

  if (!ADMIN_KEY || suppliedKey !== ADMIN_KEY) {
    return res.status(401).send('Unauthorized');
  }

  next();
}

app.get('/api/messages', requireAdminKey, (_req, res) => {
  res.json({
    count: recentMessages.length,
    messages: recentMessages
  });
});

app.get('/inbox', requireAdminKey, (req, res) => {
  const safeKey = encodeURIComponent(String(req.query.key || ''));

  const rows = recentMessages
    .map((message) => {
      const direction =
        message.direction === 'incoming' ? 'Customer' : 'BuildLab';
      const safeName = escapeHtml(message.customerName || '');
      const safeNumber = escapeHtml(message.customerNumber || '');
      const safeType = escapeHtml(message.type || '');
      const safeText = escapeHtml(message.text || '').replace(/\n/g, '<br>');
      const safeTime = escapeHtml(message.receivedAt || '');

      return `
        <article class="message ${message.direction}">
          <div class="meta">
            <strong>${direction}: ${safeName}</strong>
            <span>${safeNumber}</span>
          </div>
          <div class="body">${safeText}</div>
          <div class="footer">${safeType} · ${safeTime}</div>
        </article>
      `;
    })
    .join('');

  res.type('html').send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="refresh" content="10">
        <title>BuildLab WhatsApp Inbox</title>
        <style>
          :root {
            font-family: Arial, sans-serif;
            color: #162033;
            background: #eef3f8;
          }
          body {
            max-width: 900px;
            margin: 0 auto;
            padding: 24px;
          }
          header {
            margin-bottom: 20px;
          }
          h1 {
            margin: 0 0 6px;
          }
          .note {
            color: #5b6678;
          }
          .message {
            background: white;
            border-radius: 14px;
            padding: 16px;
            margin: 12px 0;
            box-shadow: 0 3px 14px rgba(0,0,0,.08);
            border-left: 6px solid #0aa9c7;
          }
          .message.outgoing {
            border-left-color: #e9b12b;
          }
          .meta {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 10px;
          }
          .body {
            line-height: 1.5;
          }
          .footer {
            margin-top: 12px;
            color: #6a7280;
            font-size: 12px;
          }
          a {
            color: #087f99;
          }
        </style>
      </head>
      <body>
        <header>
          <h1>BuildLab Zambia WhatsApp Inbox</h1>
          <div class="note">
            Auto-refreshes every 10 seconds. This testing inbox is cleared
            whenever Render restarts or redeploys the service.
          </div>
        </header>

        ${rows || '<p>No messages have been received since the latest service start.</p>'}

        <p>
          <a href="/inbox?key=${safeKey}">Refresh now</a>
        </p>
      </body>
    </html>
  `);
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

app.use((error, _req, res, _next) => {
  console.error('Unhandled server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`BuildLab WhatsApp bot listening on port ${PORT}`);
});

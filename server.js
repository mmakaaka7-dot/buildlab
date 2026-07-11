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

/* Show every request that reaches Render */
app.use((req, _res, next) => {
  console.log(
    `[HTTP REQUEST] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`
  );
  next();
});

/* Read JSON and preserve raw body for optional signature verification */
app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buffer) => {
      req.rawBody = buffer;
    }
  })
);

/* Prevent duplicate automatic replies */
const processedMessageIds = new Map();

setInterval(() => {
  const now = Date.now();

  for (const [messageId, expiresAt] of processedMessageIds.entries()) {
    if (expiresAt <= now) {
      processedMessageIds.delete(messageId);
    }
  }
}, 10 * 60 * 1000).unref();

function verifyMetaSignature(req) {
  /*
   * During initial testing, leave APP_SECRET unset in Render.
   * When APP_SECRET is empty, signature verification is skipped.
   */
  if (!APP_SECRET) {
    return true;
  }

  const receivedSignature = req.get('x-hub-signature-256');

  if (!receivedSignature || !req.rawBody) {
    return false;
  }

  const expectedSignature =
    'sha256=' +
    crypto
      .createHmac('sha256', APP_SECRET)
      .update(req.rawBody)
      .digest('hex');

  const receivedBuffer = Buffer.from(receivedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  const token = req.query['hub.verify_token'];

  console.log('Webhook verification request received.');

  if (
    mode === 'subscribe' &&
    VERIFY_TOKEN &&
    token === VERIFY_TOKEN
  ) {
    console.log('WEBHOOK VERIFIED');
    return res.status(200).send(challenge);
  }

  console.warn('WEBHOOK VERIFICATION FAILED');
  return res.sendStatus(403);
}

async function callWhatsAppApi(payload) {
  if (!WHATSAPP_TOKEN) {
    throw new Error(
      'WHATSAPP_TOKEN is missing in Render Environment.'
    );
  }

  if (!PHONE_NUMBER_ID) {
    throw new Error(
      'PHONE_NUMBER_ID is missing in Render Environment.'
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
      `WhatsApp API error ${response.status}: ${JSON.stringify(result)}`
    );
  }

  return result;
}

async function sendTextMessage(to, messageBody) {
  const result = await callWhatsAppApi({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: false,
      body: messageBody
    }
  });

  console.log(`AUTOMATIC REPLY SENT TO ${to}`);
  console.log(JSON.stringify(result, null, 2));
}

async function markMessageAsRead(messageId) {
  await callWhatsAppApi({
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId
  });
}

function mainMenu(firstName) {
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

function createAutomaticReply(messageText, customerName) {
  const text = String(messageText || '').trim().toLowerCase();

  const firstName =
    String(customerName || 'there')
      .trim()
      .split(/\s+/)[0] || 'there';

  const greetings = new Set([
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

  if (greetings.has(text)) {
    return mainMenu(firstName);
  }

  if (
    text === '1' ||
    text === 'register' ||
    text.includes('register project')
  ) {
    return (
      `*Project Registration*\n\n` +
      `Please send the following details in one message:\n\n` +
      `Full name:\n` +
      `School, company or organisation:\n` +
      `Project title:\n` +
      `Short project description:\n` +
      `Service required:\n` +
      `Expected completion date:\n` +
      `Estimated budget, if known:\n\n` +
      `You may attach sketches, photos or reference files.`
    );
  }

  if (
    text === '2' ||
    text === 'services' ||
    text.includes('service')
  ) {
    return (
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
    );
  }

  if (
    text === '3' ||
    text === 'quote' ||
    text === 'quotation' ||
    text.includes('price') ||
    text.includes('cost')
  ) {
    return (
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
    );
  }

  if (
    text === '4' ||
    text === 'human' ||
    text === 'agent' ||
    text.includes('speak to') ||
    text.includes('team member')
  ) {
    return (
      `Thank you. Your request has been handed over to the *BuildLab Zambia team*.\n\n` +
      `A team member will respond as soon as possible.`
    );
  }

  if (
    text === '5' ||
    text.includes('location') ||
    text.includes('where are you') ||
    text.includes('address')
  ) {
    return (
      `BuildLab Zambia operates from *Chingola, Zambia*.\n\n` +
      `Project consultations can also be conducted online or through WhatsApp.`
    );
  }

  return (
    `Thank you for contacting *BuildLab Zambia*.\n\n` +
    `We received your message:\n` +
    `“${String(messageText || '').slice(0, 500)}”\n\n` +
    `Please reply with:\n\n` +
    `1️⃣ Register a project\n` +
    `2️⃣ View services\n` +
    `3️⃣ Request a quotation\n` +
    `4️⃣ Speak to our team\n` +
    `5️⃣ Our location`
  );
}

async function processIncomingMessage(value, message) {
  if (!message?.id || !message?.from) {
    console.log(
      'Webhook did not contain a usable incoming message.'
    );
    return;
  }

  if (processedMessageIds.has(message.id)) {
    console.log(`Duplicate message ignored: ${message.id}`);
    return;
  }

  processedMessageIds.set(
    message.id,
    Date.now() + 24 * 60 * 60 * 1000
  );

  const contact = value.contacts?.find(
    (item) => item.wa_id === message.from
  );

  const customerName =
    contact?.profile?.name || 'WhatsApp customer';

  console.log('\n================================');
  console.log('NEW WHATSAPP MESSAGE');
  console.log(`Name: ${customerName}`);
  console.log(`Number: ${message.from}`);
  console.log(`Type: ${message.type}`);
  console.log(`Message ID: ${message.id}`);

  if (message.type === 'text') {
    console.log(`Message: ${message.text?.body || ''}`);
  }

  console.log('================================\n');

  try {
    await markMessageAsRead(message.id);
    console.log(`MESSAGE MARKED AS READ: ${message.id}`);
  } catch (error) {
    console.error(
      'Could not mark message as read:',
      error.message
    );
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

  const incomingText = message.text?.body || '';

  const reply = createAutomaticReply(
    incomingText,
    customerName
  );

  await sendTextMessage(message.from, reply);
}

async function processWebhook(body) {
  console.log('WEBHOOK BODY:');
  console.log(JSON.stringify(body, null, 2));

  const entries = Array.isArray(body?.entry)
    ? body.entry
    : [];

  if (entries.length === 0) {
    console.log('No entry array found in webhook body.');
    return;
  }

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes)
      ? entry.changes
      : [];

    for (const change of changes) {
      const value = change?.value;

      if (!value) {
        continue;
      }

      if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          console.log(
            `MESSAGE STATUS: ${status.status} | ` +
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
              `Message processing failed for ` +
                `${message?.id || 'unknown'}:`,
              error.message
            );
          }
        }
      }
    }
  }
}

function receiveWebhook(req, res) {
  console.log('POST WEBHOOK RECEIVED FROM META');

  if (!verifyMetaSignature(req)) {
    console.warn('INVALID META WEBHOOK SIGNATURE');
    return res.sendStatus(401);
  }

  /* Respond immediately so Meta does not retry */
  res.sendStatus(200);

  setImmediate(() => {
    processWebhook(req.body).catch((error) => {
      console.error(
        'Webhook processing error:',
        error
      );
    });
  });
}

/* Browser test and optional root webhook verification */
app.get('/', (req, res) => {
  if (req.query['hub.mode']) {
    return verifyWebhook(req, res);
  }

  return res
    .status(200)
    .send('BuildLab Zambia WhatsApp bot is online.');
});

/* Recommended Meta callback URL */
app.get('/webhook', verifyWebhook);
app.post('/webhook', receiveWebhook);

/* Root POST support */
app.post('/', receiveWebhook);

/* Render health-check route */
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'online',
    service: 'BuildLab Zambia WhatsApp Bot',
    apiVersion: GRAPH_API_VERSION,
    hasVerifyToken: Boolean(VERIFY_TOKEN),
    hasWhatsAppToken: Boolean(WHATSAPP_TOKEN),
    hasPhoneNumberId: Boolean(PHONE_NUMBER_ID),
    signatureCheckingEnabled: Boolean(APP_SECRET),
    time: new Date().toISOString()
  });
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled server error:', error);

  res.status(500).json({
    error: 'Internal server error'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `BuildLab WhatsApp bot listening on port ${PORT}`
  );
  console.log(
    `Graph API version: ${GRAPH_API_VERSION}`
  );
  console.log(
    'Recommended webhook path: /webhook'
  );
  console.log(
    `Signature checking: ${
      APP_SECRET ? 'enabled' : 'disabled'
    }`
  );
});

/**
 * Async multi-format generation with webhook delivery.
 *
 * Pass a callback_url to generateMultiFormatMedia() — Abyssale will POST the
 * completed GenerationRequestStatus payload to that URL when all formats are
 * ready. No polling loop, no open process required.
 *
 * This file has two parts:
 *   1. The generation call that registers the webhook
 *   2. A minimal HTTP server showing how to receive and type the payload
 *
 * Run the generation trigger:
 *   ABYSSALE_API_KEY=your-key npx tsx generate-multi-format-media-webhook.ts trigger
 *
 * Run the webhook receiver (must be publicly reachable, e.g. via ngrok):
 *   npx tsx generate-multi-format-media-webhook.ts receiver
 */

import http from 'node:http';
import abyssale, { type GenerationRequestStatus } from '@abyssale/sdk';

const DESIGN_ID = 'your-design-id';
const WEBHOOK_URL = 'https://your-server.com/webhooks/abyssale';

// ── Part 1: trigger generation with a callback_url ────────────────────────────

async function triggerGeneration() {
  const { data, error } = await abyssale.generateMultiFormatMedia(DESIGN_ID, {
    elements: {
      headline: { payload: 'New Product Launch' },
      logo: { image_url: 'https://cdn.example.com/logo.png' },
    },
    callback_url: WEBHOOK_URL,
  });

  if (error) {
    console.error('Failed to start generation:', error);
    process.exit(1);
  }

  console.log('Generation queued:', data.generation_request_id);
  console.log('Abyssale will POST to', WEBHOOK_URL, 'when complete.');
}

// ── Part 2: webhook receiver ──────────────────────────────────────────────────

function startReceiver() {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/webhooks/abyssale') {
      res.writeHead(404).end();
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      // Abyssale POSTs the full GenerationRequestStatus when is_finalized: true
      const payload = JSON.parse(body) as GenerationRequestStatus;

      console.log(`Received ${payload.banners.length} banners:`);
      for (const banner of payload.banners) {
        console.log(` - ${banner.format?.id}: ${banner.file.cdn_url}`);
      }

      res.writeHead(200).end(); // acknowledge — Abyssale retries on non-2xx
    });
  });

  server.listen(3000, () => console.log('Webhook receiver listening on :3000'));
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

const mode = process.argv[2];
if (mode === 'trigger') {
  await triggerGeneration();
} else if (mode === 'receiver') {
  startReceiver();
} else {
  console.error('Usage: npx tsx generate-multi-format-media-webhook.ts [trigger|receiver]');
  process.exit(1);
}

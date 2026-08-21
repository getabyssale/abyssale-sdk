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
// Imported from the subpath, not from '@abyssale/sdk': the verifier needs no API key, so a
// receiver-only process never has to hold a credential that can spend credits.
import { verifyWebhookSignature } from '@abyssale/sdk/webhooks';

const DESIGN_ID = 'your-design-id';
const WEBHOOK_URL = 'https://your-server.com/webhooks/abyssale';

// From `GET /signing-secret` (abyssale.getSigningSecret()), stored like a password. Deliveries are
// unsigned until that endpoint is called once, and this example refuses unsigned deliveries.
const SIGNING_SECRET = process.env.ABYSSALE_SIGNING_SECRET ?? '';

// Delivery ids already processed. In-memory here for brevity; use a store with a TTL in
// production, because retries can arrive hours apart and across process restarts.
const alreadyHandled = new Set<string>();

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

    // Accumulate the RAW bytes. The signature is computed over exactly what was sent, so
    // parsing and re-serializing the JSON before verifying would reorder keys and never match.
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks);

      // Verify before parsing, and reject rather than trust: anyone who finds this URL can POST
      // to it. Returns false — never throws — on a missing, malformed or forged header.
      if (!verifyWebhookSignature({
        body: raw,
        header: req.headers['x-abyssale-signature'] as string | undefined,
        secret: SIGNING_SECRET,
      })) {
        // 401 is deliberate: a non-2xx makes Abyssale retry, and a delivery we could not verify
        // is one we would rather see again than silently drop.
        res.writeHead(401).end();
        return;
      }

      // Stable across retries, unlike the signature's `t` — so this, not the payload, is the
      // dedup key. Abyssale retries a delivery your endpoint did not acknowledge, and a retry
      // carries the same id.
      const deliveryId = req.headers['x-abyssale-delivery-id'];
      if (deliveryId && alreadyHandled.has(deliveryId as string)) {
        res.writeHead(200).end(); // acknowledge again, but do the work only once
        return;
      }
      if (deliveryId) alreadyHandled.add(deliveryId as string);

      // Abyssale POSTs the full GenerationRequestStatus when is_finalized: true
      const payload = JSON.parse(raw.toString()) as GenerationRequestStatus;

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

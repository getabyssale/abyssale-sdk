/**
 * Async multi-format generation with built-in polling.
 *
 * generateMultiFormatMedia() starts an async job that renders the same design
 * across every format simultaneously (images, GIFs, videos, HTML5, PDFs).
 * waitForGenerationRequest() polls automatically with exponential backoff
 * until all formats are ready, then returns the completed result.
 *
 * For production use, prefer a callback_url to avoid holding an open process —
 * see generate-multi-format-media-webhook.ts.
 *
 * Run:
 *   ABYSSALE_API_KEY=your-key npx tsx generate-multi-format-media.ts
 */

import abyssale from '@abyssale/sdk';

const DESIGN_ID = 'your-design-id';

const { data: request, error: startError } = await abyssale.generateMultiFormatMedia(DESIGN_ID, {
  elements: {
    headline: { payload: 'New Product Launch' },
    logo: { image_url: 'https://cdn.example.com/logo.png' },
    background: { background_color: '#1A1A2E' },
  },
});

if (startError) {
  console.error('Failed to start generation:', startError);
  process.exit(1);
}

const generationRequestId = request.generation_request_id;
if (!generationRequestId) throw new Error('No generation_request_id in response');

console.log('Generation started:', generationRequestId);

try {
  // Polls with exponential backoff until is_finalized: true; throws on timeout
  const result = await abyssale.waitForGenerationRequest(generationRequestId);

  console.log(`\nGenerated ${result.banners.length} banners:`);
  for (const banner of result.banners) {
    console.log(` - ${banner.format?.id}: ${banner.file.cdn_url}`);
  }
} catch (err) {
  console.error('Polling failed:', err);
  process.exit(1);
}

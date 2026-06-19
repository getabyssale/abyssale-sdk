/**
 * Async multi-format generation with built-in polling.
 *
 * generateMultiFormatMedia() starts an async job that renders the same design
 * across every format simultaneously (images, GIFs, videos, HTML5, PDFs).
 * waitForGenerationRequest() polls automatically with exponential backoff
 * until all formats are ready, then returns the completed result.
 *
 * For production use, prefer a callback_url to avoid holding an open process.
 *
 * Run:
 *   ABYSSALE_API_KEY=your-key node examples/generate-multi-format.mjs
 */

import abyssale from '@abyssale/sdk';

const DESIGN_ID = 'your-design-id';

const { data: request, error: startError } = await abyssale.generateMultiFormatMedia(DESIGN_ID, {
  elements: {
    headline: { payload: 'New Product Launch' },
    logo: { url: 'https://cdn.example.com/logo.png' },
    background: { background_color: '#1A1A2E' },
  },
});

if (startError) {
  console.error('Failed to start generation:', startError);
  process.exit(1);
}

console.log('Generation started:', request.generation_request_id);

// Polls with exponential backoff until is_finalized: true; throws on timeout
const result = await abyssale.waitForGenerationRequest(request.generation_request_id);

console.log(`\nGenerated ${result.banners.length} banners:`);
for (const banner of result.banners) {
  console.log(` - ${banner.template_format_name}: ${banner.file.cdn_url}`);
}

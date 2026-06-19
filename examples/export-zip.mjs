/**
 * Batch export — package a set of banners into a downloadable ZIP archive.
 *
 * exportBanners() queues an async export job. Supply a callback_url to get
 * notified when the archive is ready, or poll getGenerationRequest() manually.
 *
 * Typical use: after bulk-generating ad creatives, export them all as a ZIP
 * to hand off to a media buyer or upload to an ad platform.
 *
 * Run:
 *   ABYSSALE_API_KEY=your-key node examples/export-zip.mjs
 */

import abyssale from '@abyssale/sdk';

// IDs of previously generated banners to package
const BANNER_IDS = [
  'banner-id-1',
  'banner-id-2',
  'banner-id-3',
];

const { data, error } = await abyssale.exportBanners({
  ids: BANNER_IDS,
  // Optional: Abyssale will POST to this URL when the ZIP is ready
  // callback_url: 'https://your-server.com/webhooks/export-ready',
});

if (error) {
  console.error('Export failed:', error);
  process.exit(1);
}

console.log('Export queued.');
console.log('Export request ID:', data.export_request_id);
console.log('');
console.log('Poll getGenerationRequest(export_request_id) or wait for your callback_url');
console.log('to be called with the download link once the ZIP is ready.');

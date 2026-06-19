/**
 * Batch export — package a set of banners into a downloadable ZIP archive.
 *
 * exportBanners() queues an async export job and returns an export_id.
 * Supply a callback_url to be notified when the archive is ready — Abyssale
 * will POST to that URL with a download link once the ZIP is built.
 *
 * Typical use: after bulk-generating ad creatives, export them all as a ZIP
 * to hand off to a media buyer or upload to an ad platform.
 *
 * Run:
 *   ABYSSALE_API_KEY=your-key npx tsx export-banners.ts
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
  // Abyssale will POST to this URL with the ZIP download link when ready
  callback_url: 'https://your-server.com/webhooks/export-ready',
});

if (error) {
  console.error('Export failed:', error);
  process.exit(1);
}

console.log('Export queued.');
console.log('Export ID:', data.export_id);

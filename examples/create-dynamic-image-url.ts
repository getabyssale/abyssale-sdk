/**
 * Dynamic image URL for personalised emails.
 *
 * createDynamicImageUrl() activates dynamic rendering for a design and returns
 * a per-format base URL. Append query parameters at send time — the image is
 * rendered on the fly when the recipient opens the email.
 * No pre-generation, no storage costs, infinite personalised variations.
 *
 * Run:
 *   ABYSSALE_API_KEY=your-key npx tsx create-dynamic-image-url.ts
 */

import abyssale from '@abyssale/sdk';

const DESIGN_ID = 'your-design-id';

const { data, error } = await abyssale.createDynamicImageUrl(DESIGN_ID, {
  enable_production_mode: true,
});

if (error || !data) {
  console.error('Failed to create dynamic URL:', error);
  process.exit(1);
}

// Each format has its own dynamic_image_url base — append element values as query params
for (const format of data.formats) {
  const params = new URLSearchParams({
    first_name: 'Alice',
    company_name: 'Acme Corp',
    offer_text: '30% off today',
  });
  console.log(`${format.id}: ${format.dynamic_image_url}?${params}`);
}

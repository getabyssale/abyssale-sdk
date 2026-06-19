/**
 * Dynamic image URL for personalised emails.
 *
 * createDynamicImageUrl() returns a base URL with named placeholders.
 * Append query parameters at send time — the image is rendered on the fly
 * when the recipient opens the email. No pre-generation, no storage costs,
 * infinite personalised variations from a single URL template.
 *
 * Run:
 *   ABYSSALE_API_KEY=your-key node examples/dynamic-image-url.mjs
 */

import abyssale from '@abyssale/sdk';

const DESIGN_ID = 'your-design-id';

const { data, error } = await abyssale.createDynamicImageUrl(DESIGN_ID, {
  template_format_name: 'email-header',
  // Declare which elements will be injected via query parameters
  elements: ['first_name', 'company_name', 'offer_text'],
});

if (error) {
  console.error('Failed to create dynamic URL:', error);
  process.exit(1);
}

console.log('Base dynamic URL:', data.dynamic_image_url);

// Build personalised URLs for each recipient — no API call needed per recipient
const recipients = [
  { first_name: 'Alice', company_name: 'Acme Corp', offer_text: '30% off today' },
  { first_name: 'Bob',   company_name: 'Globex',    offer_text: 'Free shipping' },
];

console.log('\nPersonalised image URLs:');
for (const r of recipients) {
  const params = new URLSearchParams(r);
  console.log(`  ${r.first_name}: ${data.dynamic_image_url}?${params}`);
}

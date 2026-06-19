/**
 * Synchronous single-image generation.
 *
 * generateImage() returns the finished banner immediately — no polling needed.
 * Use this for one-off renders or low-volume flows where latency is acceptable.
 *
 * Run:
 *   ABYSSALE_API_KEY=your-key node examples/generate-image.mjs
 */

import abyssale from '@abyssale/sdk';

const DESIGN_ID = 'your-design-id';

const { data, error } = await abyssale.generateImage(DESIGN_ID, {
  template_format_name: 'instagram-square',
  elements: {
    headline: { payload: 'Summer Sale — 50% Off' },
    product_image: { url: 'https://cdn.example.com/product.jpg' },
    cta_button: {
      payload: 'Shop Now',
      background_color: '#FF6B35',
    },
  },
});

if (error) {
  console.error('Generation failed:', error);
  process.exit(1);
}

console.log('Banner ID  :', data.banner_id);
console.log('CDN URL    :', data.file.cdn_url);
console.log('Format     :', data.template_format_name);

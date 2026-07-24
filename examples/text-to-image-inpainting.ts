/**
 * AI image generation (text-to-image) and inpainting.
 *
 * Set `text_to_image: true` on an image element with `text_to_image_properties`
 * to have Abyssale generate the image from a prompt instead of using `image_url`.
 * Passing `inpaint_images` switches the same mode to inpainting — the prompt then
 * describes the edit to apply to those source image(s).
 *
 * Only available on generateMultiFormatMedia() (this async endpoint) — the
 * synchronous generateImage() does not support it. Ignored on an element that
 * also sets `image_url` or `image_encoded`.
 *
 * `model`/`ratio`/`quality` are optional and default to the design's own element
 * settings — only set them to override. See the model compatibility table:
 * https://developers.abyssale.com/rest-api/generation/element-properties/image#text-to-image-inpainting
 *
 * Run:
 *   ABYSSALE_API_KEY=your-key npx tsx text-to-image-inpainting.ts
 */

import abyssale from '@abyssale/sdk';

const DESIGN_ID = 'your-design-id';

// ── Text-to-image: generate a new background from a prompt ────────────────────

const { data: textToImageRequest, error: textToImageError } = await abyssale.generateMultiFormatMedia(DESIGN_ID, {
  elements: {
    background: {
      text_to_image: true,
      text_to_image_properties: {
        prompt: 'A sleek, modern glass villa in minimalist lavender',
      },
    },
  },
});

if (textToImageError) {
  console.error('Failed to start text-to-image generation:', textToImageError);
  process.exit(1);
}

// ── Inpainting: edit an existing image from a prompt ───────────────────────────

const { data: inpaintingRequest, error: inpaintingError } = await abyssale.generateMultiFormatMedia(DESIGN_ID, {
  elements: {
    product_image: {
      text_to_image: true,
      text_to_image_properties: {
        prompt: 'enhance the product by adding background decoration',
        inpaint_images: ['https://cdn.example.com/product.jpeg'],
      },
    },
  },
});

if (inpaintingError) {
  console.error('Failed to start inpainting generation:', inpaintingError);
  process.exit(1);
}

for (const [label, generationRequestId] of [
  ['Text-to-image', textToImageRequest.generation_request_id],
  ['Inpainting', inpaintingRequest.generation_request_id],
] as const) {
  if (!generationRequestId) throw new Error(`No generation_request_id for ${label}`);

  const result = await abyssale.waitForGenerationRequest(generationRequestId);
  console.log(`\n${label} — ${result.banners.length} banner(s):`);
  for (const banner of result.banners) {
    // cdn_url is not set for zip files (e.g. html5 output) — fall back to url
    console.log(` - ${banner.format?.id}: ${banner.file.cdn_url ?? banner.file.url}`);
  }
}

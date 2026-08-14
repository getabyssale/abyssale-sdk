/**
 * AI image generation (text-to-image) and inpainting.
 *
 * Set `text_to_image: true` on an image element with `text_to_image_properties`
 * to have Abyssale generate the image from a prompt instead of using `image_url`.
 * Adding `inpaint_images` switches the same mode to inpainting — the prompt then
 * describes the edit to apply to those source image(s).
 *
 * Async only: generateMultiFormatMedia() accepts it, the synchronous
 * generateImage() answers 400 invalid_payload. It is also ignored on an element
 * that sets `image_url` (other than the design's default image) or `image_encoded`.
 *
 * `prompt` needs at least 3 whitespace-separated words. `model`/`ratio`/`quality`
 * are optional and fall back to the design's own element settings — see which
 * ratio and quality values each model supports:
 * https://developers.abyssale.com/rest-api/generation/element-properties/image#text-to-image-inpainting
 *
 * Run:
 *   ABYSSALE_API_KEY=your-key npx tsx text-to-image-inpainting.ts
 */

import abyssale from '@abyssale/sdk';

const DESIGN_ID = 'your-design-id';

// ── Text-to-image: generate a new background from a prompt ────────────────────

const { data: textToImage, error: textToImageError } = await abyssale.generateMultiFormatMedia(DESIGN_ID, {
  elements: {
    background: {
      text_to_image: true,
      text_to_image_properties: {
        prompt: 'A sleek, modern glass villa in a minimalist lavender field',
      },
    },
  },
});

if (textToImageError) {
  console.error('Failed to start text-to-image generation:', textToImageError);
  process.exit(1);
}

// ── Inpainting: edit an existing image from a prompt ──────────────────────────

const { data: inpainting, error: inpaintingError } = await abyssale.generateMultiFormatMedia(DESIGN_ID, {
  elements: {
    product_image: {
      text_to_image: true,
      text_to_image_properties: {
        prompt: 'enhance the product by adding background decoration',
        inpaint_images: ['https://cdn.example.com/product.jpeg'],
      },
    },
    // Shorthand for the same thing — 'prompt,url1[,url2]' is expanded server-side
    // secondary_image: { text_to_image: 'a warm sunset gradient behind it,https://cdn.example.com/other.jpeg' },
  },
});

if (inpaintingError) {
  console.error('Failed to start inpainting generation:', inpaintingError);
  process.exit(1);
}

for (const [label, request] of [
  ['Text-to-image', textToImage],
  ['Inpainting', inpainting],
] as const) {
  const generationRequestId = request.generation_request_id;
  if (!generationRequestId) throw new Error(`No generation_request_id for ${label}`);

  try {
    // AI generation adds a round-trip — expect these to take longer than a plain render
    const result = await abyssale.waitForGenerationRequest(generationRequestId);

    console.log(`\n${label} — ${result.banners.length} banners:`);
    for (const banner of result.banners) {
      console.log(` - ${banner.format?.id}: ${banner.file.cdn_url}`);
    }
    // Partial success resolves — a format the model failed on shows up here rather than throwing.
    // Only a request that produced no banners at all raises AbyssalePollingError.
    for (const failure of result.errors ?? []) {
      console.warn(` ! ${failure.template_format_name} failed: ${failure.reason}`);
    }
  } catch (err) {
    console.error(`${label} polling failed:`, err);
    process.exit(1);
  }
}

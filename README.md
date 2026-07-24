# @abyssale/sdk

Official Node.js / TypeScript SDK for the [Abyssale API](https://developers.abyssale.com) — programmatic creative asset generation at scale.

## Installation

```bash
npm install @abyssale/sdk
```

**Requires Node.js ≥ 20.**

## Quick start

```ts
import abyssale from '@abyssale/sdk';

// List your designs
const { data, error } = await abyssale.listDesigns();

// Generate an image synchronously
const { data: banner } = await abyssale.generateImage('your-design-id', {
  elements: {
    title: { payload: 'Hello World' },
    background: { background_color: '#FF0000' },
  },
  template_format_name: 'facebook-post',
});

console.log(banner?.file.cdn_url);
```

## Configuration

The SDK reads configuration from environment variables — no constructor arguments needed.

| Variable | Required | Default | Description |
|---|---|---|---|
| `ABYSSALE_API_KEY` | ✅ | — | Your Abyssale API key. The SDK throws at import time if this is not set. |
| `ABYSSALE_TIMEOUT_MS` | — | `30000` | Per-request timeout in milliseconds. |
| `ABYSSALE_MAX_RETRIES` | — | `3` | Maximum number of retries on `429` and `5xx` errors. |

```bash
ABYSSALE_API_KEY=your-key node your-script.js
```

## What you can build

**Personalised email headers** — Generate a unique image per recipient with their name, company logo, and offer. Serve it via a dynamic image URL that renders on email open with no pre-generation needed — one URL template, infinite variations.

**Bulk ad creative production** — Send a list of product data and generate hundreds of social media creatives (Facebook, Instagram, LinkedIn, Google Display) in every required format in a single async call. Poll for completion or supply a `callback_url`.

**E-commerce product banners** — Dynamically swap product image, price, and promotional text into a branded template for each SKU, triggered automatically when inventory or pricing changes.

**Print-on-demand** — Generate personalised multi-page PDFs (brochures, catalogues, certificates) with different content per page, ready for commercial printing with crop marks and color profiles.

**HTML5 banner ads** — Produce animated HTML5 banners for ad networks (Google Campaign Manager, Sizmek) with click-tag and backup image, directly from your design templates.

**Website social cards** — Generate Open Graph and Twitter Card images on demand for any page, with the page title and thumbnail baked in, triggered by a CDN edge function or serverless handler.

## Code examples

### Synchronous image generation

```ts
import abyssale from '@abyssale/sdk';

const { data, error } = await abyssale.generateImage('design-id', {
  template_format_name: 'instagram-square',
  elements: {
    headline: { payload: 'Summer Sale — 50% Off' },
    product_image: { url: 'https://cdn.example.com/product.jpg' },
    cta_button: { payload: 'Shop Now', background_color: '#FF6B35' },
  },
});

if (error) throw new Error(JSON.stringify(error));
console.log(data.file.cdn_url); // ready immediately
```

### Async multi-format generation with polling

```ts
import abyssale from '@abyssale/sdk';

// Kick off generation across all formats at once
const { data: request, error } = await abyssale.generateMultiFormatMedia('design-id', {
  elements: {
    headline: { payload: 'New Product Launch' },
    logo: { url: 'https://cdn.example.com/logo.png' },
  },
});

if (error) throw new Error(JSON.stringify(error));

// Wait until all banners are ready — polling is handled by the SDK
const result = await abyssale.waitForGenerationRequest(request.generation_request_id);

for (const banner of result.banners) {
  console.log(banner.format_name, banner.file.cdn_url);
}
```

### Text-to-image and inpainting (async only)

Image elements on `generateMultiFormatMedia` accept `text_to_image` / `text_to_image_properties` — Abyssale generates the image from a prompt instead of using `image_url`. Passing `inpaint_images` switches the same mode to inpainting, where the prompt describes the edit to apply to those source image(s) instead. Not available on the synchronous `generateImage`; ignored on an element that also sets `image_url` or `image_encoded`.

```ts
import abyssale from '@abyssale/sdk';

// Text-to-image — generate a new background from a prompt
const { data: request } = await abyssale.generateMultiFormatMedia('design-id', {
  elements: {
    background: {
      text_to_image: true,
      text_to_image_properties: {
        prompt: 'A sleek, modern glass villa in minimalist lavender',
      },
    },
  },
});

// Inpainting — edit an existing image from a prompt
const { data: inpaintingRequest } = await abyssale.generateMultiFormatMedia('design-id', {
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
```

`prompt` is required whenever `text_to_image: true`; the API returns a `400` if it's missing. `model`, `ratio`, and `quality` are optional and default to whatever is already configured on the design's element — only set them to override. See the [element properties guide](https://developers.abyssale.com/rest-api/generation/element-properties/image#text-to-image-inpainting) for the full list of models and which `ratio`/`quality` values each one supports.

### Dynamic image URL for personalised emails

```ts
import abyssale from '@abyssale/sdk';

const { data } = await abyssale.createDynamicImageUrl('design-id', {
  template_format_name: 'email-header',
  elements: ['first_name', 'company_logo'],
});

// Embed in email — values injected at render time via query string
const imageUrl = `${data.dynamic_image_url}?first_name=Alice&company_logo=https://...`;
```

### Multi-page PDF generation

```ts
import abyssale from '@abyssale/sdk';

const { data: request, error } = await abyssale.generateMultiPagePdf('design-id', {
  pages: {
    page_1: { root: { background_color: '#FFFFFF' } },
    page_2: { root: { background_color: '#F5F5F5' } },
  },
});

if (error) throw new Error(JSON.stringify(error));
if (!request.generation_request_id) throw new Error('No generation_request_id');

const result = await abyssale.waitForGenerationRequest(request.generation_request_id);
console.log(result.banners[0]?.file.cdn_url); // download the PDF
```

### Batch export as ZIP

```ts
import abyssale from '@abyssale/sdk';

const bannerIds = ['banner-id-1', 'banner-id-2', 'banner-id-3'];

const { data } = await abyssale.exportBanners({
  ids: bannerIds,
  callback_url: 'https://your-server.com/webhooks/export-done',
});

console.log('Export queued:', data.export_request_id);
```

## Error handling

Every method returns `{ data, error, response }` — the SDK **never throws** on HTTP errors.

```ts
const { data, error } = await abyssale.generateImage(designId, { elements: {} });

if (error) {
  console.error('API error:', error);
  // error is typed from the OpenAPI spec
} else {
  console.log(data.file.cdn_url);
}
```

## Retries & timeouts

The SDK automatically retries failed requests with exponential backoff:
- Retries on `429 Too Many Requests` and `5xx` server errors
- Default: up to **3 retries** (1 s → 2 s → 4 s delays + jitter)
- Default timeout: **30 seconds** per request

Both are configurable via environment variables (`ABYSSALE_TIMEOUT_MS`, `ABYSSALE_MAX_RETRIES`).

## Key features

- **TypeScript-first** — all types generated directly from the OpenAPI spec, full IntelliSense on every request and response field
- **Zero-config singleton** — `import abyssale from '@abyssale/sdk'` and go; no constructor, no setup beyond one env var
- **Auto-retry with exponential backoff** — transparent retries on transient failures (`429`, `5xx`), configurable retry count
- **Never throws on HTTP errors** — every method returns `{ data, error }`, keeping error handling explicit and predictable
- **Dual ESM + CJS output** — works in any Node.js project regardless of `"type"` in `package.json`
- **`openapi-fetch` under the hood** — ~6 KB type-safe HTTP client, no heavy runtime dependency

## API reference

### Designs

```ts
abyssale.listDesigns(query?)               // GET /designs
abyssale.getDesign(designId)               // GET /designs/{designId}
abyssale.getDesignFormat(designId, format) // GET /designs/{designId}/formats/{format}
```

### Asset generation

```ts
// Synchronous — returns the banner immediately
abyssale.generateImage(designId, body)

// Asynchronous — returns generation_request_id; poll or use callback_url
// Image elements here also support text_to_image / text_to_image_properties (AI generation + inpainting)
abyssale.generateMultiFormatMedia(designId, body)
abyssale.generateMultiPagePdf(designId, body)       // printer_multipage designs only

// Polling — call getGenerationRequest once, or let the SDK loop until done
abyssale.getGenerationRequest(generationRequestId)
abyssale.waitForGenerationRequest(generationRequestId, options?)
```

### Files

```ts
abyssale.getFile(bannerId)  // GET /banners/{bannerId}
```

### Fonts

```ts
abyssale.listFonts()  // GET /fonts
```

### Projects

```ts
abyssale.listProjects()           // GET /projects
abyssale.createProject({ name })  // POST /projects
```

### Exports

```ts
abyssale.exportBanners({ ids, callback_url? })  // POST /async/banners/export
```

### Dynamic images

```ts
abyssale.createDynamicImageUrl(designId, body)  // POST /designs/{designId}/dynamic-image-url
```

### Workspace templates

```ts
abyssale.duplicateWorkspaceTemplate(templateId, body)      // POST /workspace-templates/{id}/use
abyssale.getDuplicationRequest(duplicateRequestId)         // GET /design-duplication-requests/{id}
abyssale.waitForDuplicationRequest(duplicateRequestId, options?)  // polls until COMPLETED or ERROR
```

## Polling helpers

`waitForGenerationRequest` and `waitForDuplicationRequest` handle the polling loop so you don't have to. Both use exponential backoff with jitter and accept an optional `options` object:

| Option | Default | Min | Description |
|---|---|---|---|
| `intervalMs` | `3000` | `2000` | Initial delay between polls in ms |
| `maxIntervalMs` | `30000` | `5000` | Maximum delay between polls in ms |
| `timeoutMs` | `1800000` | `60000` | Absolute timeout (30 min); throws `Error("Polling timed out")` if exceeded |

```ts
// Custom poll interval and timeout
const result = await abyssale.waitForGenerationRequest(id, {
  intervalMs: 5_000,
  maxIntervalMs: 30_000,
  timeoutMs: 300_000,
});
```

`waitForDuplicationRequest` resolves when `status` is `"COMPLETED"` **or** `"ERROR"` — always check `result.status` afterwards.

```ts
const result = await abyssale.waitForDuplicationRequest(duplicateRequestId);
if (result.status === 'ERROR') throw new Error('Duplication failed');
console.log(result.designs);
```

## TypeScript

All request and response types are generated from the OpenAPI spec and fully exported:

```ts
import type { Banner, Design, Font, GenerationRequestStatus, PollOptions } from '@abyssale/sdk';

// text_to_image_properties settings for an image element (generateMultiFormatMedia only)
import type { TextToImageProperties } from '@abyssale/sdk';
```

## Links

- [Abyssale](https://www.abyssale.com)
- [Abyssale Developer Hub](https://developers.abyssale.com)
- [API Reference](https://api-reference.abyssale.com/)
- [Changelog](https://github.com/getabyssale/abyssale-sdk/releases)

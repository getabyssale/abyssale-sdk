import createClient from "openapi-fetch";
import type { paths, components, operations } from "./generated.js";
import { retryMiddleware, timeoutMiddleware } from "./middleware.js";

// ── Public type re-exports ────────────────────────────────────────────────────
// Consumers can import these directly: import type { Banner } from '@abyssale/sdk'
export type { components };
export type Banner = components["schemas"]["Banner"];
export type Design = components["schemas"]["Design"];
export type DesignFormat = components["schemas"]["DesignFormat"];
export type DesignElement = components["schemas"]["DesignElement"];
export type Font = components["schemas"]["Font"];
export type ProjectSummary = components["schemas"]["ProjectSummary"];
export type GenerationRequestStatus =
  components["schemas"]["GenerationRequestStatus"];
export type DynamicImageResponse = components["schemas"]["DynamicImageResponse"];
export type DuplicationRequest = components["schemas"]["DuplicationRequest"];
export type DuplicationRequestStatus =
  components["schemas"]["DuplicationRequestStatus"];
export type DuplicatedDesign = components["schemas"]["DuplicatedDesign"];
export type Elements = components["schemas"]["Elements"];
export type Pages = components["schemas"]["Pages"];
/** Settings for `text_to_image_properties` on an image element — see `generateMultiFormatMedia`. */
export type TextToImageProperties = components["schemas"]["TextToImageProperties"];

// ── Body type helpers (extracted from operations for cleaner method signatures) ─
type GenerateImageBody =
  operations["generateImage"]["requestBody"]["content"]["application/json"];

// Image element accepted by generateMultiFormatMedia — same shape as the image
// element in `Elements`, except `text_to_image` takes a boolean + `text_to_image_properties`
// (AI generation / inpainting) instead of a bare prompt string. This only takes
// effect here: AI image generation/inpainting is async-only and ignored by generateImage.
type ImageElementWithAI = Omit<components["schemas"]["ImageElement"], "text_to_image"> & {
  text_to_image?: boolean;
  text_to_image_properties?: TextToImageProperties;
};
type ElementWithAI = Pick<
  components["schemas"]["Element"],
  "hidden" | "shadow_color" | "shadow_blur" | "shadow_offset_x" | "shadow_offset_y"
> &
  (
    | components["schemas"]["TextElement"]
    | ImageElementWithAI
    | components["schemas"]["ButtonElement"]
    | components["schemas"]["LogoElement"]
    | components["schemas"]["ShapeElement"]
    | components["schemas"]["RatingElement"]
    | components["schemas"]["IllustrationElement"]
    | components["schemas"]["QRCodeElement"]
    | components["schemas"]["VideoElement"]
    | components["schemas"]["AudioElement"]
  );
type GenerateMultiFormatMediaBody = Omit<
  operations["generateMultiFormatMedia"]["requestBody"]["content"]["application/json"],
  "elements"
> & {
  elements: {
    [key: string]:
      | components["schemas"]["RootElement"]
      | ElementWithAI
      | components["schemas"]["VideoElement"]
      | components["schemas"]["AudioElement"];
  };
};
type GenerateMultiPagePdfBody =
  operations["generateMultiPagePdf"]["requestBody"]["content"]["application/json"];
type ExportBannersBody =
  operations["exportBanners"]["requestBody"]["content"]["application/json"];
type CreateDynamicImageUrlBody =
  operations["createDynamicImageUrl"]["requestBody"]["content"]["application/json"];
type CreateProjectBody =
  operations["createProject"]["requestBody"]["content"]["application/json"];
type DuplicateWorkspaceTemplateBody =
  operations["duplicateWorkspaceTemplate"]["requestBody"]["content"]["application/json"];
type ListDesignsQuery = NonNullable<
  operations["listDesigns"]["parameters"]["query"]
>;

// ── Config ────────────────────────────────────────────────────────────────────
const apiKey = process.env.ABYSSALE_API_KEY;
if (!apiKey) {
  throw new Error(
    "[abyssale] ABYSSALE_API_KEY environment variable is not set."
  );
}

const baseUrl =
  process.env.ABYSSALE_BASE_URL ?? "https://api.abyssale.com";

const timeoutMs = (() => {
  const raw = process.env.ABYSSALE_TIMEOUT_MS;
  if (!raw) return 30_000;
  const val = Number(raw);
  if (!Number.isFinite(val) || val <= 0)
    throw new Error(`[abyssale] ABYSSALE_TIMEOUT_MS must be a positive number, got "${raw}"`);
  return val;
})();

const maxRetries = (() => {
  const raw = process.env.ABYSSALE_MAX_RETRIES;
  if (!raw) return 3;
  const val = Number(raw);
  if (!Number.isInteger(val) || val < 0)
    throw new Error(`[abyssale] ABYSSALE_MAX_RETRIES must be a non-negative integer, got "${raw}"`);
  return val;
})();

// ── HTTP client ───────────────────────────────────────────────────────────────
const _client = createClient<paths>({
  baseUrl,
  headers: { "x-api-key": apiKey },
});

_client.use(timeoutMiddleware(timeoutMs));
_client.use(retryMiddleware(maxRetries));

// ── SDK singleton ─────────────────────────────────────────────────────────────
// Each method returns { data, error, response } — never throws on HTTP errors.
// Check `error` to handle API failures; `data` is populated on success.
const abyssale = {
  // ── Designs ──────────────────────────────────────────────────────────────

  /**
   * List all designs in the workspace.
   * Optionally filter by `project_id` or `type` (static, animated, printer, printer_multipage).
   * @example
   * const { data, error } = await abyssale.listDesigns({ type: 'static' });
   */
  listDesigns: (query?: ListDesignsQuery) =>
    _client.GET("/designs", { params: { query } }),

  /**
   * Get the full specification of a design: formats, elements, and variables.
   * Use this to discover what data to pass in a generation request.
   * @example
   * const { data } = await abyssale.getDesign('64238d01-d402-474b-8c2d-fbc957e9d290');
   */
  getDesign: (designId: string) =>
    _client.GET("/designs/{designId}", { params: { path: { designId } } }),

  /**
   * Get details for a specific format within a design.
   * `formatSpecifier` can be the format name (e.g. "facebook-post") or its UUID.
   * @example
   * const { data } = await abyssale.getDesignFormat(designId, 'facebook-post');
   */
  getDesignFormat: (designId: string, formatSpecifier: string) =>
    _client.GET("/designs/{designId}/formats/{formatSpecifier}", {
      params: { path: { designId, formatSpecifier } },
    }),

  // ── Asset Generation ──────────────────────────────────────────────────────

  /**
   * Synchronously generate a single image and receive the result immediately.
   * Best for single-asset workflows where you need the URL inline.
   * @example
   * const { data } = await abyssale.generateImage(designId, {
   *   elements: { title: { payload: 'Hello World' } },
   *   template_format_name: 'facebook-post',
   * });
   */
  generateImage: (designId: string, body: GenerateImageBody) =>
    _client.POST("/banner-builder/{designId}/generate", {
      params: { path: { designId } },
      body,
    }),

  /**
   * Asynchronously generate one or more formats (image, GIF, video, HTML5, PDF).
   * Returns a `generation_request_id` to poll with `getGenerationRequest`, or
   * provide a `callback_url` to receive a webhook when complete.
   *
   * Image elements also accept `text_to_image` / `text_to_image_properties` here —
   * AI image generation and inpainting are only available on this async endpoint,
   * not on `generateImage`. Ignored if `image_url` or `image_encoded` is also set.
   *
   * `model`/`ratio`/`quality` are optional and default to the design's own element
   * settings — only set them to override. See the model compatibility table:
   * https://developers.abyssale.com/rest-api/generation/element-properties/image#text-to-image-inpainting
   * @example
   * const { data } = await abyssale.generateMultiFormatMedia(designId, {
   *   elements: { title: { payload: 'Summer Sale' } },
   *   template_format_names: ['facebook-feed', 'instagram-post'],
   *   callback_url: 'https://your-webhook.com/abyssale',
   * });
   * @example
   * // AI-generated background image (text-to-image)
   * const { data } = await abyssale.generateMultiFormatMedia(designId, {
   *   elements: {
   *     background: {
   *       text_to_image: true,
   *       text_to_image_properties: { prompt: 'A sleek, modern glass villa in minimalist lavender' },
   *     },
   *   },
   * });
   * @example
   * // Inpainting — edit an existing image from a prompt
   * const { data } = await abyssale.generateMultiFormatMedia(designId, {
   *   elements: {
   *     product_image: {
   *       text_to_image: true,
   *       text_to_image_properties: {
   *         prompt: 'enhance the product by adding background decoration',
   *         inpaint_images: ['https://cdn.example.com/product.jpg'],
   *       },
   *     },
   *   },
   * });
   */
  generateMultiFormatMedia: (
    designId: string,
    body: GenerateMultiFormatMediaBody
  ) =>
    _client.POST("/async/banner-builder/{designId}/generate", {
      params: { path: { designId } },
      body,
    }),

  /**
   * Asynchronously generate a multi-page print-ready PDF from a `printer_multipage` design.
   * Each key in `pages` defines element overrides for that page.
   * Returns a `generation_request_id`; poll with `waitForGenerationRequest` or provide a `callback_url`.
   * @example
   * const { data } = await abyssale.generateMultiPagePdf(designId, {
   *   pages: {
   *     page_1: { root: { background_color: '#FFFFFF' } },
   *     page_2: { root: { background_color: '#000000' } },
   *   },
   * });
   */
  generateMultiPagePdf: (designId: string, body: GenerateMultiPagePdfBody) =>
    _client.POST("/async/banner-builder/{designId}/generate-multipage-pdf", {
      params: { path: { designId } },
      body,
    }),

  /**
   * Poll the status of an async generation request.
   * Returns `is_finalized: false` (HTTP 202) while in progress, `true` (HTTP 200) when done.
   * @example
   * const { data } = await abyssale.getGenerationRequest(generationRequestId);
   * if (data?.is_finalized) console.log(data.banners);
   */
  getGenerationRequest: (generationRequestId: string) =>
    _client.GET("/generation-request/{generationRequestId}", {
      params: { path: { generationRequestId } },
    }),

  // ── Files ─────────────────────────────────────────────────────────────────

  /**
   * Get metadata and download URLs (S3 + CDN) for a previously generated file.
   * @example
   * const { data } = await abyssale.getFile('64238d01-d402-474b-8c2d-fbc957e9d290');
   * console.log(data?.file.cdn_url);
   */
  getFile: (bannerId: string) =>
    _client.GET("/banners/{bannerId}", { params: { path: { bannerId } } }),

  // ── Fonts ─────────────────────────────────────────────────────────────────

  /**
   * List all fonts available in the workspace (Google Fonts + custom uploads).
   * Use a font's `id` to override the font in a generation request.
   */
  listFonts: () => _client.GET("/fonts"),

  // ── Projects ──────────────────────────────────────────────────────────────

  /**
   * List all projects in the workspace.
   * Only designs belonging to a project are accessible via the API.
   */
  listProjects: () => _client.GET("/projects"),

  /**
   * Create a new project to organise your designs.
   * @example
   * const { data } = await abyssale.createProject({ name: 'Summer Campaign 2025' });
   */
  createProject: (body: CreateProjectBody) =>
    _client.POST("/projects", { body }),

  // ── Exports ───────────────────────────────────────────────────────────────

  /**
   * Asynchronously package a set of banners into a single ZIP archive.
   * Provide a `callback_url` to receive a webhook when the archive is ready.
   * @example
   * const { data } = await abyssale.exportBanners({
   *   ids: ['uuid-1', 'uuid-2'],
   *   callback_url: 'https://your-webhook.com/export',
   * });
   */
  exportBanners: (body: ExportBannersBody) =>
    _client.POST("/async/banners/export", { body }),

  // ── Dynamic Images ────────────────────────────────────────────────────────

  /**
   * Create (or retrieve the existing) dynamic image URL for a design.
   * The returned URL can be embedded in emails or websites and customised
   * via query parameters — no extra API calls needed.
   * @example
   * const { data } = await abyssale.createDynamicImageUrl(designId, {
   *   enable_production_mode: true,
   * });
   */
  createDynamicImageUrl: (designId: string, body: CreateDynamicImageUrlBody) =>
    _client.POST("/designs/{designId}/dynamic-image-url", {
      params: { path: { designId } },
      body,
    }),

  // ── Workspace Templates ───────────────────────────────────────────────────

  /**
   * Duplicate a shared workspace template into one of your projects.
   * Returns a `duplication_request_id`; poll with `getDuplicationRequest` for status.
   * @example
   * const { data } = await abyssale.duplicateWorkspaceTemplate(templateId, {
   *   project_id: 'your-project-uuid',
   *   name: 'Holiday Campaign Copy',
   * });
   */
  duplicateWorkspaceTemplate: (
    companyTemplateId: string,
    body: DuplicateWorkspaceTemplateBody
  ) =>
    _client.POST("/workspace-templates/{companyTemplateId}/use", {
      params: { path: { companyTemplateId } },
      body,
    }),

  /**
   * Poll the status of an asynchronous template duplication request.
   * Status progresses: INIT → IN_PROGRESS → COMPLETED (or ERROR).
   * @example
   * const { data } = await abyssale.getDuplicationRequest(duplicationRequestId);
   * if (data?.status === 'COMPLETED') console.log(data.designs);
   */
  getDuplicationRequest: (duplicateRequestId: string) =>
    _client.GET("/design-duplication-requests/{duplicateRequestId}", {
      params: { path: { duplicateRequestId } },
    }),
};

// ── Polling options type ──────────────────────────────────────────────────────
export interface PollOptions {
  /** Initial poll interval in ms (default 3 000, minimum 2 000) */
  intervalMs?: number;
  /** Maximum backoff interval in ms (default 30 000, minimum 5 000) */
  maxIntervalMs?: number;
  /** Absolute timeout in ms; throws if exceeded (default 1 800 000 = 30 min, minimum 60 000 = 1 min) */
  timeoutMs?: number;
}

const POLL_MIN_INTERVAL_MS = 2_000;
const POLL_MIN_MAX_INTERVAL_MS = 5_000;
const POLL_MIN_TIMEOUT_MS = 60_000;

// ── Internal polling helper ───────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(): number {
  return Math.floor(Math.random() * 500);
}

async function pollUntil<T>(
  fn: () => Promise<{ data?: T | null; error?: unknown }>,
  isDone: (data: T) => boolean,
  opts: Required<PollOptions>
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  let interval = opts.intervalMs;
  for (;;) {
    const { data, error } = await fn();
    if (error) throw new Error(`[abyssale] Polling failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
    if (!data) throw new Error("[abyssale] Polling returned empty response");
    if (isDone(data)) return data;
    const wait = interval + jitter();
    if (Date.now() + wait > deadline) throw new Error("Polling timed out");
    await sleep(wait);
    interval = Math.min(interval * 2, opts.maxIntervalMs);
  }
}

function resolveOpts(opts?: PollOptions): Required<PollOptions> {
  return {
    intervalMs: Math.max(opts?.intervalMs ?? 3_000, POLL_MIN_INTERVAL_MS),
    maxIntervalMs: Math.max(opts?.maxIntervalMs ?? 30_000, POLL_MIN_MAX_INTERVAL_MS),
    timeoutMs: Math.max(opts?.timeoutMs ?? 1_800_000, POLL_MIN_TIMEOUT_MS),
  };
}

// ── Polling helpers (attached to singleton below) ─────────────────────────────

/**
 * Wait for an async generation request to complete.
 * Polls `getGenerationRequest` with exponential backoff until `is_finalized: true`.
 * Throws if the request errors or the timeout is exceeded.
 * @example
 * const result = await abyssale.waitForGenerationRequest(generationRequestId);
 * console.log(result.banners);
 */
function waitForGenerationRequest(
  generationRequestId: string,
  options?: PollOptions
): Promise<GenerationRequestStatus> {
  return pollUntil(
    () => abyssale.getGenerationRequest(generationRequestId),
    (data) => data.is_finalized === true,
    resolveOpts(options)
  );
}

/**
 * Wait for a template duplication request to reach COMPLETED or ERROR.
 * Polls `getDuplicationRequest` with exponential backoff.
 * @example
 * const result = await abyssale.waitForDuplicationRequest(duplicateRequestId);
 * if (result.status === 'COMPLETED') console.log(result.designs);
 */
function waitForDuplicationRequest(
  duplicateRequestId: string,
  options?: PollOptions
): Promise<DuplicationRequestStatus> {
  return pollUntil(
    () => abyssale.getDuplicationRequest(duplicateRequestId),
    (data) => data.status === "COMPLETED" || data.status === "ERROR",
    resolveOpts(options)
  );
}

export default Object.assign(abyssale, {
  waitForGenerationRequest,
  waitForDuplicationRequest,
});

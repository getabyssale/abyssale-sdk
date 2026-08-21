import createClient from "openapi-fetch";
import type { paths, components, operations } from "./generated.js";
import type { RetryPlan } from "./middleware.js";
import { retryMiddleware, timeoutMiddleware, planRetry } from "./middleware.js";

// ── Public type re-exports ────────────────────────────────────────────────────
// Consumers can import these directly: import type { Banner } from '@abyssale/sdk'
export type { components };
export type Banner = components["schemas"]["Banner"];
export type Design = components["schemas"]["Design"];
export type DesignFormat = components["schemas"]["DesignFormat"];
export type DesignElement = components["schemas"]["DesignElement"];
export type DesignAnimation = components["schemas"]["DesignAnimation"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];
export type WorkspaceTemplate = components["schemas"]["WorkspaceTemplate"];
export type WorkspaceTemplateCategory =
  components["schemas"]["WorkspaceTemplateCategory"];
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
export type AsyncElements = components["schemas"]["AsyncElements"];
/** `text_to_image_properties` on an image element — `generateMultiFormatMedia` only. */
export type TextToImageProperties = components["schemas"]["TextToImageProperties"];
export type Pages = components["schemas"]["Pages"];

// ── Body type helpers (extracted from operations for cleaner method signatures) ─
type GenerateImageBody =
  operations["generateImage"]["requestBody"]["content"]["application/json"];
type GenerateMultiFormatMediaBody =
  operations["generateMultiFormatMedia"]["requestBody"]["content"]["application/json"];
type GenerateMultiPagePdfBody =
  operations["generateMultiPagePdf"]["requestBody"]["content"]["application/json"];
type ExportBannersBody =
  operations["exportBanners"]["requestBody"]["content"]["application/json"];
// The spec marks this body optional (both flags default server-side), so the operation type is
// `{ content: ... } | undefined` — unwrap it and keep the parameter optional on the method instead.
type CreateDynamicImageUrlBody = NonNullable<
  operations["createDynamicImageUrl"]["requestBody"]
>["content"]["application/json"];
type CreateProjectBody =
  operations["createProject"]["requestBody"]["content"]["application/json"];
type DuplicateWorkspaceTemplateBody =
  operations["duplicateWorkspaceTemplate"]["requestBody"]["content"]["application/json"];
type ListDesignsQuery = NonNullable<
  operations["listDesigns"]["parameters"]["query"]
>;
type ListWorkspaceTemplatesQuery = NonNullable<
  operations["listWorkspaceTemplates"]["parameters"]["query"]
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
// Registered after the timeout middleware so its `onResponse` runs first (openapi-fetch walks
// response middleware in reverse). It takes `timeoutMs` because it re-arms the timeout per attempt.
_client.use(retryMiddleware(maxRetries, timeoutMs));

// ── SDK singleton ─────────────────────────────────────────────────────────────
// Each method returns { data, error, response } — never throws on HTTP errors.
// Check `error` to handle API failures; `data` is populated on success.
const abyssale = {
  // ── Authentication ───────────────────────────────────────────────────────

  /**
   * Verify the API key and return the workspace it belongs to.
   * Takes no body. Every failure is a `401` — unknown key, revoked key, or a plan
   * without API access (`api_access_denied`); this endpoint never answers `403`.
   *
   * Do not use the health check to test a key: it is exempt from authentication and
   * answers `200` for a revoked key.
   * @example
   * const { data, error } = await abyssale.verifyApiKey();
   * if (!error) console.log(data.company);
   */
  verifyApiKey: () => _client.POST("/auth"),

  // ── Webhook signing secret ───────────────────────────────────────────────

  /**
   * Get the workspace's webhook signing secret, creating it on the first call.
   *
   * One secret covers every delivery in the workspace, whether the receiver was subscribed in the
   * dashboard or requested per job with a `callback_url`. Until this is called at least once,
   * deliveries are **unsigned** — fetching the secret is what turns signing on.
   *
   * This is not the API key and cannot be swapped for one: the API key authorises calls to
   * Abyssale and can spend credits, this secret only proves a delivery came from Abyssale. Verify
   * with `verifyWebhookSignature` from `@abyssale/sdk/webhooks`.
   * @example
   * const { data, error } = await abyssale.getSigningSecret();
   * if (!error) console.log(data.secret);
   */
  getSigningSecret: () => _client.GET("/signing-secret"),

  /**
   * Rotate the signing secret, keeping the previous one valid for 24 hours.
   *
   * During that window every delivery carries two `v1` hashes, so a receiver holding either value
   * still verifies and you can deploy the new one on your own schedule.
   *
   * Rotating **again** inside that window answers `409 previous_secret_still_active` and changes
   * nothing, because the second rotate would drop the secret your receiver is still using. Wait
   * for the window to close, call `revokeSigningSecret` first, or pass `{ force: true }` and
   * accept that the oldest secret stops verifying within a minute.
   * @example
   * const { data, error } = await abyssale.rotateSigningSecret();
   * if (error?.id === 'previous_secret_still_active') console.log('rotated too recently');
   */
  rotateSigningSecret: (options?: { force?: boolean }) =>
    _client.POST("/signing-secret/rotate", {
      // Omitted rather than sent as `force=false`, so an ordinary rotate stays a bare POST.
      params: { query: options?.force ? { force: true } : undefined },
    }),

  /**
   * Invalidate the previous secret, ending the rotation overlap early.
   *
   * The compromise path, not routine hygiene: anything still signed with the old secret stops
   * verifying **within 60 seconds** — not instantly, because the signing side caches secrets for
   * up to a minute. The current secret is left untouched. You are the verifier, so dropping the
   * old secret from your own config is what closes a leak; do not wait on this call.
   * @example
   * await abyssale.revokeSigningSecret();
   */
  revokeSigningSecret: () => _client.POST("/signing-secret/revoke"),

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
   * Multipage print designs (`printer_multipage`) have no formats — the response
   * carries `pages` and `elements_per_page` (keyed `page_1 … page_N`) instead of
   * `formats`, `elements`, `variables` and `dynamic_image_url`.
   *
   * Pass `{ advanced: true }` to get the full layer set — notably `group` layers, which the
   * default response omits. `getDesignFormat` is always the advanced view and needs no flag.
   * @example
   * const { data } = await abyssale.getDesign('64238d01-d402-474b-8c2d-fbc957e9d290');
   * const { data: full } = await abyssale.getDesign(designId, { advanced: true });
   */
  getDesign: (designId: string, options?: { advanced?: boolean }) =>
    _client.GET("/designs/{designId}", {
      params: {
        path: { designId },
        query: options?.advanced ? { i: "advanced" as const } : undefined,
      },
    }),

  /**
   * Get details for a specific format within a design. Always the advanced view: the full
   * property set and the format's `group` layers, flattened to that one format.
   * `formatSpecifier` can be the format name (e.g. "facebook-post") or its UUID.
   * Does not apply to `printer_multipage` designs (they have no formats):
   * every specifier answers `404 format_not_found` — use `getDesign` instead.
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
   * @example
   * const { data } = await abyssale.generateMultiFormatMedia(designId, {
   *   elements: { title: { payload: 'Summer Sale' } },
   *   template_format_names: ['facebook-feed', 'instagram-post'],
   *   callback_url: 'https://your-webhook.com/abyssale',
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
  createDynamicImageUrl: (designId: string, body?: CreateDynamicImageUrlBody) =>
    _client.POST("/designs/{designId}/dynamic-image-url", {
      params: { path: { designId } },
      body,
    }),

  // ── Workspace Templates ───────────────────────────────────────────────────

  /**
   * List the organisation-level master designs shared across the workspace.
   * Optionally filter by `category_id` (see `listWorkspaceTemplateCategories`)
   * or `type` (static, animated, printer, printer_multipage).
   * Workspace templates never appear in `listDesigns` — duplicate one into a
   * project with `duplicateWorkspaceTemplate` to work on it as a design.
   * @example
   * const { data, error } = await abyssale.listWorkspaceTemplates({ type: 'static' });
   */
  listWorkspaceTemplates: (query?: ListWorkspaceTemplatesQuery) =>
    _client.GET("/workspace-templates", { params: { query } }),

  /**
   * List the categories that group workspace templates.
   * Use a category's `id` as the `category_id` filter on `listWorkspaceTemplates`.
   * Categories are optional — templates at the workspace root have none.
   */
  listWorkspaceTemplateCategories: () =>
    _client.GET("/workspace-template-categories"),

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

/**
 * How many *consecutive* transient failures a poll loop absorbs before giving up.
 *
 * A wait can legitimately run for the full 30 minutes — the async endpoint has no completion bound,
 * and an AI image round-trip pushes well past a plain render. Failing the whole wait on one 503 or
 * one aborted poll would throw away everything already elapsed for a condition that the next poll,
 * three seconds later, usually clears. The streak resets on any successful poll, so this tolerates
 * blips without hiding an endpoint that is actually down.
 */
const POLL_MAX_TRANSIENT_FAILURES = 3;

/**
 * Thrown when a polling helper's underlying request fails.
 *
 * The API's error body is preserved on `.response` (and its machine-readable `id` on `.id`)
 * rather than being flattened into the message — callers branch on `id`, never on prose. See
 * {@link ErrorResponse}.
 *
 * @example
 * try {
 *   await abyssale.waitForGenerationRequest(id);
 * } catch (err) {
 *   if (err instanceof AbyssalePollingError && err.id === "generation_request_not_found") {
 *     // handle a request that has expired
 *   }
 * }
 */
export class AbyssalePollingError extends Error {
  /** The parsed API error body, when the failure carried one. */
  readonly response?: ErrorResponse;
  /** The API's machine-readable error code, when present. */
  readonly id?: string;
  /** The raw error value, exactly as returned by the underlying fetch layer. */
  readonly cause: unknown;

  constructor(error: unknown) {
    const body = (
      error && typeof error === "object" && !(error instanceof Error) ? error : undefined
    ) as ErrorResponse | undefined;
    const detail =
      error instanceof Error ? error.message : (body?.message ?? JSON.stringify(error));
    super(`[abyssale] Polling failed: ${detail}`);
    this.name = "AbyssalePollingError";
    this.cause = error;
    this.response = body;
    this.id = body?.id;
  }
}

// ── Internal polling helper ───────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(): number {
  return Math.floor(Math.random() * 500);
}

/**
 * How a failed poll should be treated, or null when it is fatal.
 *
 * Defers to {@link planRetry} so this cannot drift from `retryMiddleware` again — it had: this
 * predicate retried *every* 429, including the permanent ones, so three re-asks and ~21s later the
 * poll failed with the error it started with.
 *
 * The rationale is unchanged: a 5xx or a real throttle says nothing about the generation itself,
 * while any other 4xx is a verdict — `generation_request_not_found` must fail on the first poll
 * rather than be re-asked for 30 minutes.
 *
 * The poll has the error body already parsed, so unlike the middleware it never re-reads the
 * response to find the `id`.
 */
function planPollRetry(response: Response | undefined, cause: unknown): RetryPlan | null {
  // A network-level throw (`fetch` rejected, or the request was aborted) has no response at all.
  if (!response) return { probe: false, delayMs: null };
  const id = typeof (cause as { id?: unknown } | null)?.id === "string" ? (cause as { id: string }).id : null;
  return planRetry(response, id);
}

async function pollUntil<T>(
  fn: () => Promise<{ data?: T | null; error?: unknown; response?: Response }>,
  isDone: (data: T) => boolean,
  opts: Required<PollOptions>
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  let interval = opts.intervalMs;
  let transientFailures = 0;
  /**
   * How long the server asked us to wait, when the last failure said so. It replaces the backoff
   * for exactly one wait: a throttle that says "60s" is not answered by re-asking in 3, which
   * would spend the whole transient-failure budget inside the window it was told to sit out.
   */
  let serverRequestedWaitMs: number | null = null;
  /**
   * Bare `429`s absorbed so far. Capped at one for the whole poll, not one in a row: the probe
   * exists to find out whether the refusal was the gateway's per-second ceiling, and a second
   * bare 429 after a successful probe answers that — it is not the ceiling, so waiting is not the
   * fix. Without this cap a spent credit balance would be re-asked for the full 30 minutes.
   */
  let ceilingProbes = 0;

  /** Fatal unless it is a blip and we have not seen too many in a row. */
  const absorb = (cause: unknown, response?: Response): AbyssalePollingError | null => {
    const plan = planPollRetry(response, cause);
    if (!plan) return new AbyssalePollingError(cause);
    if (plan.probe && ++ceilingProbes > 1) return new AbyssalePollingError(cause);
    if (++transientFailures > POLL_MAX_TRANSIENT_FAILURES) return new AbyssalePollingError(cause);
    serverRequestedWaitMs = plan.delayMs;
    return null;
  };

  for (;;) {
    // A malformed or empty body makes openapi-fetch's `res.json()` THROW rather than populate
    // `error` — a raw SyntaxError would otherwise escape a helper that promises callers can
    // branch on `err.id`. Everything that comes out of a polling helper is an
    // `AbyssalePollingError` with the original on `.cause`.
    let result: { data?: T | null; error?: unknown; response?: Response };
    let failure: AbyssalePollingError | null = null;
    try {
      result = await fn();
      const { data, error } = result;
      if (error) failure = absorb(error, result.response);
      else if (!data) failure = new AbyssalePollingError(new Error("the API returned an empty response"));
      else {
        transientFailures = 0;
        serverRequestedWaitMs = null;
        if (isDone(data)) return data;
      }
    } catch (thrown) {
      // No response to classify — a rejected or aborted fetch. Treated as transient.
      failure = absorb(thrown, undefined);
    }
    if (failure) throw failure;
    // Honour `Retry-After` when the last failure carried one, else the backoff schedule. No
    // jitter on the server's own figure — it names a window boundary, not a contended resource.
    const wait = serverRequestedWaitMs ?? interval + jitter();
    if (Date.now() + wait > deadline)
      throw new AbyssalePollingError(
        new Error(`no result after ${Math.round(opts.timeoutMs / 1000)}s — the request may still complete`)
      );
    await sleep(wait);
    // The backoff advances on its own schedule, so a one-off `Retry-After` does not reset the
    // ramp a long-running generation has already built up.
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
 *
 * **Partial success resolves.** A finalized request can carry both `banners` and per-format
 * `errors` — one format failing does not invalidate the others, so check `result.errors` if you
 * need every requested format. Only a request that finalized with *no* banners at all and at
 * least one error throws: that is a failed generation, and returning it as a success would leave
 * callers iterating an empty `banners` array with nothing to indicate why.
 *
 * @example
 * const result = await abyssale.waitForGenerationRequest(generationRequestId);
 * console.log(result.banners);
 * if (result.errors?.length) console.warn('some formats failed:', result.errors);
 */
function waitForGenerationRequest(
  generationRequestId: string,
  options?: PollOptions
): Promise<GenerationRequestStatus> {
  return pollUntil(
    () => abyssale.getGenerationRequest(generationRequestId),
    (data) => data.is_finalized === true,
    resolveOpts(options)
  ).then((result) => {
    if (result.banners?.length || !result.errors?.length) return result;
    const reasons = result.errors
      .map((e) => `${e.template_format_name ?? "unknown format"}: ${e.reason ?? "no reason given"}`)
      .join("; ");
    // `.response`/`.id` stay reserved for an actual API error body, which this is not — the poll
    // itself answered 200. The finalized status object is reachable as `err.cause.cause` for
    // callers that want to read `errors[]` programmatically rather than parse the message.
    throw new AbyssalePollingError(
      new Error(`the generation produced no banners — ${reasons}`, { cause: result })
    );
  });
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

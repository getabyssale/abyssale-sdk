'use strict';

class AbyssaleError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'AbyssaleError';
    this.status = status;
    this.body = body;
  }
}

const ENVIRONMENTS = {
  production: 'https://api.abyssale.com',
  preprod: 'https://api-preprod.abyssale.com',
  local: 'http://localhost:8012',
};

class Abyssale {
  constructor(apiKey, { environment = 'production', baseUrl } = {}) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('Abyssale: apiKey must be a non-empty string');
    }
    if (baseUrl) {
      this._baseUrl = baseUrl;
    } else if (ENVIRONMENTS[environment]) {
      this._baseUrl = ENVIRONMENTS[environment];
    } else {
      throw new Error(`Abyssale: unknown environment "${environment}". Use "production", "preprod", or "local".`);
    }
    this._apiKey = apiKey;
  }

  async #request(method, path, { body, query } = {}) {
    const url = new URL(this._baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, v);
      }
    }
    const headers = { 'x-api-key': this._apiKey };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data;
    try { data = await res.json(); } catch { data = null; }

    if (!res.ok) {
      throw new AbyssaleError(data?.message ?? `HTTP ${res.status}`, res.status, data);
    }
    return data;
  }

  // ── Designs ──────────────────────────────────────────────────────────────

  /**
   * List all designs in the workspace.
   * @param {{ project_id?: string, type?: 'static'|'animated'|'printer'|'printer_multipage' }} [params]
   * @returns {Promise<object[]>}
   */
  listDesigns(params = {}) {
    return this.#request('GET', '/designs', { query: params });
  }

  /**
   * Get full details of a design (formats, elements, variables).
   * @param {string} designId
   * @returns {Promise<object>}
   */
  getDesign(designId) {
    return this.#request('GET', `/designs/${encodeURIComponent(designId)}`);
  }

  /**
   * Get details for a specific format within a design.
   * @param {string} designId
   * @param {string} formatSpecifier - Format name or UID
   * @returns {Promise<object>}
   */
  getDesignFormat(designId, formatSpecifier) {
    return this.#request('GET', `/designs/${encodeURIComponent(designId)}/formats/${encodeURIComponent(formatSpecifier)}`);
  }

  // ── Asset Generation ─────────────────────────────────────────────────────

  /**
   * Synchronously generate a single image.
   * @param {string} designId
   * @param {{ elements: object, template_format_name?: string, image_file_type?: string, file_compression_level?: number }} body
   * @returns {Promise<object>} Banner object
   */
  generateAsset(designId, body) {
    return this.#request('POST', `/banner-builder/${encodeURIComponent(designId)}/generate`, { body });
  }

  /**
   * Asynchronously generate one or more formats (image/video/GIF/HTML5/PDF).
   * @param {string} designId
   * @param {{ elements: object, template_format_names?: string[], callback_url?: string, image_file_type?: string, file_compression_level?: number, html5?: object, gif?: object, video?: object, print?: object, original_visual_id?: string }} body
   * @returns {Promise<{ generation_request_id: string }>}
   */
  generateMultiFormatMedia(designId, body) {
    return this.#request('POST', `/async/banner-builder/${encodeURIComponent(designId)}/generate`, { body });
  }

  /**
   * Asynchronously generate a multi-page PDF from a printer_multipage design.
   *
   * Note: the path ends with U+200E (LEFT-TO-RIGHT MARK). The Abyssale API uses
   * this invisible character to distinguish this endpoint from generateMultiFormatMedia,
   * which shares the same visible path. See spec/api.yaml line 714.
   *
   * @param {string} designId
   * @param {{ pages: object, callback_url?: string }} body
   * @returns {Promise<{ generation_request_id: string }>}
   */
  generateMultiPagePdf(designId, body) {
    return this.#request('POST', `/async/banner-builder/${encodeURIComponent(designId)}/generate‎`, { body });
  }

  /**
   * Poll the status of an async generation request.
   * @param {string} generationRequestId
   * @returns {Promise<object>} GenerationRequestStatus
   */
  getGenerationRequest(generationRequestId) {
    return this.#request('GET', `/generation-request/${encodeURIComponent(generationRequestId)}`);
  }

  // ── Files ─────────────────────────────────────────────────────────────────

  /**
   * Get metadata and download URLs for a generated file.
   * @param {string} bannerId
   * @returns {Promise<object>} Banner object
   */
  getFile(bannerId) {
    return this.#request('GET', `/banners/${encodeURIComponent(bannerId)}`);
  }

  // ── Fonts ─────────────────────────────────────────────────────────────────

  /**
   * List all fonts available in the workspace.
   * @returns {Promise<object[]>}
   */
  listFonts() {
    return this.#request('GET', '/fonts');
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  /**
   * List all projects in the workspace.
   * @returns {Promise<object[]>}
   */
  listProjects() {
    return this.#request('GET', '/projects');
  }

  /**
   * Create a new project.
   * @param {{ name: string }} body
   * @returns {Promise<object>} ProjectSummary
   */
  createProject(body) {
    return this.#request('POST', '/projects', { body });
  }

  // ── Exports ───────────────────────────────────────────────────────────────

  /**
   * Asynchronously export banners as a ZIP archive.
   * @param {{ ids: string[], callback_url?: string }} body
   * @returns {Promise<{ export_id: string }>}
   */
  exportBanners(body) {
    return this.#request('POST', '/async/banners/export', { body });
  }

  // ── Dynamic Images ────────────────────────────────────────────────────────

  /**
   * Create (or retrieve existing) dynamic image URL for a design.
   * @param {string} designId
   * @param {{ enable_rate_limit?: boolean, enable_production_mode?: boolean }} body
   * @returns {Promise<object>} DynamicImageResponse
   */
  createDynamicImageUrl(designId, body) {
    return this.#request('POST', `/designs/${encodeURIComponent(designId)}/dynamic-image-url`, { body });
  }

  // ── Workspace Templates ───────────────────────────────────────────────────

  /**
   * Duplicate a workspace template into a project.
   * @param {string} companyTemplateId
   * @param {{ project_id: string, name?: string }} body
   * @returns {Promise<{ duplication_request_id: string }>}
   */
  duplicateWorkspaceTemplate(companyTemplateId, body) {
    return this.#request('POST', `/workspace-templates/${encodeURIComponent(companyTemplateId)}/use`, { body });
  }

  /**
   * Poll the status of a template duplication request.
   * @param {string} duplicateRequestId
   * @returns {Promise<object>} DuplicationRequestStatus
   */
  getDuplicationRequest(duplicateRequestId) {
    return this.#request('GET', `/design-duplication-requests/${encodeURIComponent(duplicateRequestId)}`);
  }
}

module.exports = Abyssale;
module.exports.AbyssaleError = AbyssaleError;

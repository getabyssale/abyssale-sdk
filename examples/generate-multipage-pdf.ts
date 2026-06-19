/**
 * Multi-page print-ready PDF generation.
 *
 * generateMultiPagePdf() is for designs of type "printer_multipage".
 * `pages` is a dictionary keyed by page layer name — each entry can override
 * the root background color for that page.
 * The result is a single PDF file, ready for commercial printing
 * (crop marks, CMYK color profile).
 *
 * waitForGenerationRequest() handles polling automatically.
 *
 * Run:
 *   ABYSSALE_API_KEY=your-key npx tsx generate-multipage-pdf.ts
 */

import abyssale from '@abyssale/sdk';

const DESIGN_ID = 'your-multipage-design-id';

const { data: request, error: startError } = await abyssale.generateMultiPagePdf(DESIGN_ID, {
  pages: {
    page_1: { root: { background_color: '#FFFFFF' } },
    page_2: { root: { background_color: '#F5F5F5' } },
    page_3: { root: { background_color: '#1A1A2E' } },
  },
  print: {
    display_crop_marks: true,
  },
});

if (startError) {
  console.error('Failed to start PDF generation:', startError);
  process.exit(1);
}

const generationRequestId = request.generation_request_id;
if (!generationRequestId) throw new Error('No generation_request_id in response');

console.log('PDF generation started:', generationRequestId);

try {
  const result = await abyssale.waitForGenerationRequest(generationRequestId);
  const pdf = result.banners[0];
  console.log('\nPDF ready:', pdf?.file.cdn_url ?? pdf?.file.url);
} catch (err) {
  console.error('Polling failed:', err);
  process.exit(1);
}

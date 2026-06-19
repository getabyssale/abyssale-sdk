/**
 * Multi-page print-ready PDF generation.
 *
 * generateMultiPagePdf() is for designs of type "printer_multipage".
 * Each entry in `pages` maps element names to values for that page.
 * The result is a single PDF file with one page per entry, ready for
 * commercial printing (crop marks, CMYK color profile).
 *
 * waitForGenerationRequest() handles polling automatically.
 *
 * Run:
 *   ABYSSALE_API_KEY=your-key node examples/multi-page-pdf.mjs
 */

import abyssale from '@abyssale/sdk';

const DESIGN_ID = 'your-multipage-design-id';

const { data: request, error: startError } = await abyssale.generateMultiPagePdf(DESIGN_ID, {
  pages: [
    {
      elements: {
        chapter_title: { payload: 'Introduction' },
        body_text: { payload: 'Welcome to our annual catalogue.' },
        page_image: { url: 'https://cdn.example.com/cover.jpg' },
      },
    },
    {
      elements: {
        chapter_title: { payload: 'Our Products' },
        body_text: { payload: 'Explore our full range of offerings.' },
        page_image: { url: 'https://cdn.example.com/products.jpg' },
      },
    },
    {
      elements: {
        chapter_title: { payload: 'Contact Us' },
        body_text: { payload: 'hello@example.com · +1 555 0100' },
        page_image: { url: 'https://cdn.example.com/team.jpg' },
      },
    },
  ],
});

if (startError) {
  console.error('Failed to start PDF generation:', startError);
  process.exit(1);
}

console.log('PDF generation started:', request.generation_request_id);

const result = await abyssale.waitForGenerationRequest(request.generation_request_id);

console.log('\nPDF ready:', result.banners[0].file.cdn_url);

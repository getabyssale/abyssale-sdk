/**
 * AI asset jobs: generate an image from a prompt, remove its background, then upscale it.
 *
 * Each action starts a job and answers a `job_id` right away; the work runs in the background.
 * waitForAssetJob() polls the job until it is COMPLETED (returned) or FAILED (thrown).
 * Every action spends AI credits — check them with getCredits().
 *
 * For production use, prefer a callback_url: Abyssale then POSTs the ASSET_JOB_FINALIZED webhook
 * once the job ends, and no process has to wait.
 *
 * Output URLs are signed and valid 7 days — download the files to keep them.
 *
 * Run:
 *   ABYSSALE_API_KEY=your-key npx tsx asset-jobs.ts
 */

import abyssale from '@abyssale/sdk';

// Which models can generate an image, and which aspect ratios each one takes.
const { data: listing, error: listError } = await abyssale.listAiModels('images_text_to_image');
if (listError || !listing || 'operations' in listing) {
  console.error('Failed to list models:', listError);
  process.exit(1);
}
for (const model of listing.models) {
  console.log(`${model.id}${model.is_default ? ' (default)' : ''}:`, model.aspect_ratios?.allowed ?? []);
}

try {
  // 1. Text to image — the workspace's default model, a 16:9 image.
  const { data: generated, error } = await abyssale.textToImage({
    prompt: 'A red sneaker on a white studio background, soft light',
    aspect_ratio: '16:9',
  });
  if (error) throw new Error(`text to image refused: ${error.id} — ${error.message}`);
  const image = await abyssale.waitForAssetJob(generated.job_id);
  const imageUrl = image.outputs[0]?.url;
  if (!imageUrl) throw new Error('the job completed with no output');
  console.log('\nGenerated:', imageUrl, `(${image.credits.ai_credits} AI credits)`);

  // 2. Remove the background of that image, cropping the transparent edges.
  const { data: cutout, error: cutoutError } = await abyssale.removeBackground({ image_url: imageUrl, crop: true });
  if (cutoutError) throw new Error(`remove background refused: ${cutoutError.id}`);
  const cut = await abyssale.waitForAssetJob(cutout.job_id);
  const cutUrl = cut.outputs[0]?.url;
  if (!cutUrl) throw new Error('the job completed with no output');
  console.log('Background removed:', cutUrl);

  // 3. Upscale it 2x.
  const { data: upscaled, error: upscaleError } = await abyssale.upscale({ image_url: cutUrl, upscale_factor: 2 });
  if (upscaleError) throw new Error(`upscale refused: ${upscaleError.id}`);
  const big = await abyssale.waitForAssetJob(upscaled.job_id);
  console.log('Upscaled:', big.outputs[0]?.url);
} catch (err) {
  // A FAILED job throws AbyssalePollingError naming its error code (e.g. invalid_input_asset).
  console.error(err);
  process.exit(1);
}

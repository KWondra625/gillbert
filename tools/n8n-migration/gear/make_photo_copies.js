// Code node "Make Photo Copies" in the shared sub-workflow "Gillbert - Media - Make Photo Copies"
// (gear stage 3; taken out of "Gillbert - Media - Make Thumbnails" (#38) so catch photos and gear
// setup photos make their copies the same way). Source of truth: tools/n8n-migration/gear/
// make_photo_copies.js, deployed by deploy_gear_photos.py.
//
// Input (from the caller): { container, blobPath, readUrl, mediaType ('Photo' | 'Video'),
//   contentType, originalFilename, skipReason }. skipReason set = nothing to do (the caller
//   decided, e.g. a catch file still converting): answers skip: true with that reason.
// Photo: makes <ID>-thumb.jpg (1200 px) and <ID>-view.jpg (2048 px) next to the original.
// Video: makes <ID>-thumb.jpg only, its poster frame (1200 px), from a frame about a second in.
// Both in THIS server's storage. The original is only read, from its public URL: on Staging
// most catch rows point at Production's storage, and Staging must never write there.
// Never throws: answers { ok, skip, thumbnailUrl, viewingUrl, error }.

const crypto = require('crypto');
const account = $env.GILLBERT_AZURE_STORAGE_ACCOUNT;
const keyB64 = $env.GILLBERT_AZURE_STORAGE_KEY;
if (!account || !keyB64) throw new Error('Missing GILLBERT_AZURE_STORAGE_* settings on this server');
const sasKey = Buffer.from(keyB64, 'base64');
const apiVersion = '2020-12-06';

function enc(s) { return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }

function buildSas(container, blobName, perms, minutes = 90) {
  const start  = new Date(Date.now() - 5 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
  const expiry = new Date(Date.now() + minutes * 60 * 1000).toISOString().slice(0, 19) + 'Z';
  const sr = blobName ? 'b' : 'c';
  const resource = blobName ? `/blob/${account}/${container}/${blobName}` : `/blob/${account}/${container}`;
  const toSign = [perms, start, expiry, resource, '', '', 'https', apiVersion, sr, '', '', '', '', '', '', ''].join('\n');
  const sig = crypto.createHmac('sha256', sasKey).update(toSign, 'utf8').digest('base64');
  const qs = `sv=${enc(apiVersion)}&spr=https&st=${enc(start)}&se=${enc(expiry)}&sr=${sr}&sp=${enc(perms)}&sig=${enc(sig)}`;
  return blobName
    ? `https://${account}.blob.core.windows.net/${container}/${blobName}?${qs}`
    : `https://${account}.blob.core.windows.net/${container}?${qs}`;
}

// Where originals may be, per container and type: the exact shapes the upload slots issue. The
// path goes into shell commands, so nothing else gets past this. Gear photos may be HEIC
// (magick reads it; the copies are JPEG); catch HEICs are converted before they get here.
const ORIGINAL = {
  'catch-media': {
    Photo: /^catches\/Catch-\d{2}-\d{3,}\/[A-Z0-9]{8,24}\.(jpg|jpeg|png|webp)$/,
    Video: /^catches\/Catch-\d{2}-\d{3,}\/[A-Z0-9]{8,24}\.(mp4|m4v|mov|webm)$/,
  },
  'gear-media': {
    Photo: /^gear\/\d+\/[A-Z0-9]{8,24}\.(jpg|jpeg|png|webp|heic|heif)$/,
  },
};

const { spawn } = require('child_process');
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('close', c => c === 0 ? resolve(out) : reject(new Error(`${cmd} failed (exit ${c}): ${err.trim().slice(-400)}`)));
    proc.on('error', e => reject(new Error(`${cmd} could not start: ${e.message}`)));
  });
}

// A run the task runner killed never reaches its clean-up; sweep temp files older than 3 hours.
try { await run('find', ['/tmp', '-maxdepth', '1', '-name', 'gillbert_*', '-mmin', '+180', '-delete']); } catch {}

const SIZES = {
  Photo: [{ name: 'thumb', side: 1200, quality: 82 }, { name: 'view', side: 2048, quality: 85 }],
  Video: [{ name: 'thumb', side: 1200, quality: 82 }],   // the poster frame; no viewing copy
};

const r = $('When Executed by Another Workflow').first().json;
// skip: nothing to record (the caller's reason, or a file that doesn't get copies)
const result = { ok: false, skip: false };
const temps = [];
const skip = msg => { result.skip = true; throw new Error(msg); };

try {
  if (r.skipReason) skip(r.skipReason);
  if (r.contentType === 'image/gif') skip('GIFs keep their original (a thumbnail would freeze the animation)');
  const shapes = ORIGINAL[r.container];
  if (!shapes) throw new Error('Unknown container');
  if (!shapes[r.mediaType]) skip('Only photos and videos get thumbnails');
  const m = shapes[r.mediaType].exec(r.blobPath || '');
  if (!m) throw new Error('Invalid media path');
  const u = /^https:\/\/[a-z0-9]+\.blob\.core\.windows\.net\/([a-z0-9-]+)\//.exec(r.readUrl || '');
  if (!u || u[1] !== r.container) throw new Error('Invalid media URL');
  const container = r.container;

  const base = r.blobPath.replace(/\.[^.]+$/, '');       // catches/Catch-26-147/<ID>, gear/7/<ID>
  const fileId = base.split('/').pop();
  let tempIn;
  if (r.mediaType === 'Video') {
    // One frame, read straight from the URL: ffmpeg fetches only the parts it needs, not the
    // whole video, and rotates phone videos upright by itself. About a second in, past a
    // black first frame; a clip shorter than that uses its first frame.
    tempIn = `/tmp/gillbert_${fileId}_frame.jpg`;
    temps.push(tempIn);
    const grab = at => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at, '-i', r.readUrl,
      '-frames:v', '1', '-q:v', '2', tempIn]);
    await grab('1');
    if (!Number((await run('stat', ['-c', '%s', tempIn]).catch(() => '0')).trim())) await grab('0');
  } else {
    tempIn = `/tmp/gillbert_${fileId}_thumbsrc.${m[1]}`;
    temps.push(tempIn);
    // Public read: the original may live in the other server's storage (Staging rows).
    await run('curl', ['-sS', '-f', '--retry', '2', '-o', tempIn, r.readUrl]);
  }

  for (const s of SIZES[r.mediaType]) {
    const tempOut = `/tmp/gillbert_${fileId}_${s.name}.jpg`;
    temps.push(tempOut);
    // -auto-orient FIRST: rotate the pixels by the phone's rotation flag, then drop the camera
    // data (the flag, location) but keep the color profile. "1200x1200>" only shrinks; a small photo keeps its size.
    await run('magick', [tempIn, '-auto-orient', '-resize', `${s.side}x${s.side}>`, '+profile', '!icc,*',
      '-quality', String(s.quality), tempOut]);
    const blobName = `${base}-${s.name}.jpg`;
    await run('curl', ['-sS', '-f', '--retry', '2', '-X', 'PUT', '-H', 'x-ms-blob-type: BlockBlob',
      '-H', 'Content-Type: image/jpeg', '-H', 'x-ms-blob-cache-control: public, max-age=604800', // a week: regenerating overwrites the same name
      '-T', tempOut, buildSas(container, blobName, 'cw')]);
    result[`${s.name}Url`] = `https://${account}.blob.core.windows.net/${container}/${blobName}`;
  }
  // "Download original": mark the photo's original "save as <its uploaded name>", so the
  // lightbox's plain link downloads it. Only when the original is in THIS server's storage
  // (never Production's from Staging). Setting properties replaces all of them, so the
  // current type and cache setting are read first and sent back unchanged.
  if (r.mediaType === 'Photo' && r.readUrl.startsWith(`https://${account}.blob.core.windows.net/`)) {
    const head = await run('curl', ['-sS', '-f', '-I', buildSas(container, r.blobPath, 'r', 15)]);
    const header = name => ((head.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, 'im')) || [])[1] || '');
    // ASCII fallback name plus the exact name (RFC 6266), so accents and quotes can't break it
    const name = String(r.originalFilename || `${fileId}.${m[1]}`).replace(/[\r\n]/g, '');
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    await run('curl', ['-sS', '-f', '-X', 'PUT', '-H', 'Content-Length: 0',
      '-H', `x-ms-blob-content-type: ${header('Content-Type') || 'image/jpeg'}`,
      ...(header('Cache-Control') ? ['-H', `x-ms-blob-cache-control: ${header('Cache-Control')}`] : []),
      '-H', `x-ms-blob-content-disposition: attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      buildSas(container, r.blobPath, 'w', 15) + '&comp=properties']);
  }
  Object.assign(result, { ok: true, thumbnailUrl: result.thumbUrl, viewingUrl: result.viewUrl || null });
  delete result.thumbUrl; delete result.viewUrl;
} catch (e) {
  result.error = String(e.message || e).slice(0, 1000);
} finally {
  if (temps.length) { try { await run('rm', ['-f', ...temps]); } catch {} }
}

return [{ json: result }];

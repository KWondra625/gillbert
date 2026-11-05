// Shared "profile photo" upload/crop/remove widget — used by both the admin
// Edit Angler form and the self-service "My Photo" card on me.html. Wraps the
// SAS-token upload flow and the Cropper.js crop modal so both call sites stay
// in sync as this logic evolves.
//
// Requires config.js loaded first, plus
// https://cdnjs.cloudflare.com/ajax/libs/cropperjs/2.2.0/cropper.min.js and a
// crop modal in the page matching edit-angler.html's markup.

const ANGLER_MEDIA_SAS_URL    = API_BASE + 'anglers/get-photo-sas';
const ANGLER_MEDIA_COMMIT_URL = API_BASE + 'anglers/save-photo';
const ANGLER_MEDIA_REMOVE_URL = API_BASE + 'anglers/delete-photo';
const ANGLER_MEDIA_CONVERT_URL = API_BASE + 'anglers/convert-photo';

// Same rules as the profile photo upload-slot workflow (anglers/get-photo-sas); checked here
// first so a refused file gets a clear reason instead of a generic failure. Keep in step.
const PROFILE_PHOTO_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const PROFILE_PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'];

function profilePhotoRejectReason(file) {
  const ext = (file.name || '').includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  if (!PROFILE_PHOTO_EXTENSIONS.includes(ext)) return "That file type isn't supported. Choose a JPG, PNG, WebP, GIF or HEIC photo.";
  if (file.size <= 0) return 'That file is empty.';
  if (file.size > PROFILE_PHOTO_MAX_BYTES) {
    return `That photo is too large (${Math.round(file.size / (1024 * 1024))} MB); the limit is 25 MB.`;
  }
  return null;
}

function createProfilePhotoWidget({ getAnglerId, elements: el }) {
  let currentReadUrl = null;
  let cropObjectUrl = null;
  let pendingOriginalFile = null;

  function render(readUrl) {
    if (readUrl) {
      el.img.src = readUrl;
      el.img.classList.remove('hidden');
      el.placeholder.classList.add('hidden');
      el.removeBtn.classList.remove('hidden');
    } else {
      el.img.classList.add('hidden');
      el.img.removeAttribute('src');
      el.placeholder.classList.remove('hidden');
      el.removeBtn.classList.add('hidden');
    }
  }

  function setPhoto(readUrl) {
    currentReadUrl = readUrl || null;
    render(currentReadUrl);
  }

  // Gets an upload slot for the file and puts it in storage; returns where it went
  async function uploadToStorage(anglerId, file) {
    const sasRes = await fetch(ANGLER_MEDIA_SAS_URL, {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anglerId,
        file: { name: file.name, size: file.size, type: file.type },
      }),
    });
    if (!sasRes.ok) throw new Error(`HTTP ${sasRes.status}`);
    const { uploadUrl, readUrl, blobPath, contentType } = await sasRes.json();
    if (!uploadUrl || !blobPath) throw new Error('No upload slot');

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': contentType || file.type },
      body: file,
    });
    if (!putRes.ok) throw new Error(`Azure PUT failed: ${putRes.status}`);
    return { readUrl, blobPath, contentType };
  }

  async function uploadProfilePhoto(file) {
    el.status.textContent = 'Uploading…';
    el.uploadBtn.disabled = true;

    // Instant local preview while the real upload happens in the background.
    const previewUrl = URL.createObjectURL(file);
    el.img.src = previewUrl;
    el.img.classList.remove('hidden');
    el.placeholder.classList.add('hidden');

    try {
      const anglerId = parseInt(getAnglerId(), 10);
      const { readUrl, blobPath, contentType } = await uploadToStorage(anglerId, file);

      const commitRes = await fetch(ANGLER_MEDIA_COMMIT_URL, {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anglerId,
          blobPath, readUrl,
          contentType: contentType || file.type,
          originalName: file.name,
        }),
      });
      let commitData;
      try { commitData = await commitRes.json(); } catch { commitData = {}; }
      if (!commitRes.ok || !commitData.success) throw new Error(commitData.message || `HTTP ${commitRes.status}`);

      currentReadUrl = commitData.readUrl || readUrl;
      render(currentReadUrl);
      el.status.textContent = 'Photo updated.';
    } catch (err) {
      console.error('Profile photo upload failed:', err);
      el.status.textContent = 'Upload failed. Please try again.';
      render(currentReadUrl);
    } finally {
      URL.revokeObjectURL(previewUrl);
      el.uploadBtn.disabled = false;
      el.input.value = '';
    }
  }

  async function removeProfilePhoto() {
    el.status.textContent = 'Removing…';
    el.removeBtn.disabled = true;

    try {
      const res = await fetch(ANGLER_MEDIA_REMOVE_URL, {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ anglerId: parseInt(getAnglerId(), 10) }),
      });
      let data;
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
      currentReadUrl = null;
      render(null);
      el.status.textContent = 'Photo removed.';
    } catch (err) {
      console.error('Remove profile photo failed:', err);
      el.status.textContent = 'Unable to remove photo. Please try again.';
    } finally {
      el.removeBtn.disabled = false;
    }
  }

  // ── Crop modal ────────────────────────────────────────────────────────
  // Browsers generally can't decode HEIC into an <img>/canvas at all (the
  // same reason the server-side conversion step exists), so a HEIC goes to the
  // server first: it's converted to JPEG (through the same Convert Media step as
  // everything else), sent back, and opened in the crop box like any JPEG. The
  // HEIC and the converted copy aren't kept; the crop is what gets saved.
  //
  // file.type alone isn't reliable for this — browsers are known to report
  // HEIC/HEIF as an empty string or 'image/heif' depending on OS/browser, the
  // same reason media-upload.js falls back to extension sniffing.
  function isHeic(file) {
    if (file.type === 'image/heic' || file.type === 'image/heif') return true;
    if (!file.type || file.type === 'application/octet-stream') {
      const ext = (file.name || '').split('.').pop().toLowerCase();
      return ext === 'heic' || ext === 'heif';
    }
    return false;
  }

  async function convertHeicForCrop(file) {
    el.status.textContent = 'Converting your photo so you can crop it…';
    el.uploadBtn.disabled = true;
    try {
      const anglerId = parseInt(getAnglerId(), 10);
      const { blobPath } = await uploadToStorage(anglerId, file);
      const res = await fetch(ANGLER_MEDIA_CONVERT_URL, {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ anglerId, blobPath }),
      });
      let data;
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok || !data.success || !data.data) throw new Error(data.message || `HTTP ${res.status}`);

      const bytes = Uint8Array.from(atob(data.data), c => c.charCodeAt(0));
      const jpegName = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
      el.status.textContent = '';
      openCropModal(new File([bytes], jpegName, { type: 'image/jpeg' }));
    } catch (err) {
      console.error('HEIC conversion for crop failed:', err);
      el.status.textContent = "Couldn't prepare that photo for cropping. Please try again.";
      el.input.value = '';
    } finally {
      el.uploadBtn.disabled = false;
    }
  }

  function openCropModal(file) {
    pendingOriginalFile = file;
    cropObjectUrl = URL.createObjectURL(file);
    el.cropperImage.src = cropObjectUrl;
    el.cropModal.classList.add('open');
    el.cropConfirmBtn.disabled = false;
    // Setting .src via a JS property (rather than a parse-time HTML
    // attribute) doesn't auto-trigger the selection's initial sizing — has
    // to be done explicitly once the new image has actually loaded.
    el.cropperImage.$ready().then(() => el.cropperSelection.$initSelection());
  }

  function closeCropModal() {
    el.cropModal.classList.remove('open');
    if (cropObjectUrl) {
      URL.revokeObjectURL(cropObjectUrl);
      cropObjectUrl = null;
    }
    pendingOriginalFile = null;
    // Reset so picking the same file again still fires 'change'.
    el.input.value = '';
  }

  async function confirmCrop() {
    const originalFile = pendingOriginalFile;
    // $toCanvas() below is async, so without this a fast double-click could
    // start two upload pipelines before either reaches uploadProfilePhoto.
    el.cropConfirmBtn.disabled = true;
    try {
      const canvas = await el.cropperSelection.$toCanvas();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Canvas produced no image data.');
      const croppedName = (originalFile.name || 'photo').replace(/\.[^.]+$/, '') + '-cropped.jpg';
      const croppedFile = new File([blob], croppedName, { type: 'image/jpeg' });
      closeCropModal();
      uploadProfilePhoto(croppedFile);
    } catch (err) {
      console.error('Crop failed:', err);
      closeCropModal();
      el.status.textContent = 'Crop failed. Please try again.';
    }
  }

  el.uploadBtn.addEventListener('click', () => el.input.click());
  el.input.addEventListener('change', () => {
    const file = el.input.files && el.input.files[0];
    if (!file) return;
    const reason = profilePhotoRejectReason(file);
    if (reason) {
      el.status.textContent = reason;
      el.input.value = '';
      return;
    }
    if (isHeic(file)) {
      convertHeicForCrop(file);
    } else {
      openCropModal(file);
    }
  });
  el.removeBtn.addEventListener('click', removeProfilePhoto);

  el.cropModalClose.addEventListener('click', closeCropModal);
  el.cropCancelBtn.addEventListener('click', closeCropModal);
  el.cropConfirmBtn.addEventListener('click', confirmCrop);
  el.cropModal.addEventListener('click', (e) => {
    if (e.target === el.cropModal) closeCropModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.cropModal.classList.contains('open')) closeCropModal();
  });

  return { setPhoto };
}

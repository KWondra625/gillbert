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

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': contentType || file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Azure PUT failed: ${putRes.status}`);

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
      if (!commitRes.ok) throw new Error(`HTTP ${commitRes.status}`);
      const commitData = await commitRes.json();

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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  // same reason the server-side conversion step exists), so cropping only
  // applies to formats the browser can actually render — HEIC skips straight
  // to the upload-as-is flow and lets the server-side conversion handle it.
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

  function openCropModal(file) {
    pendingOriginalFile = file;
    cropObjectUrl = URL.createObjectURL(file);
    el.cropperImage.src = cropObjectUrl;
    el.cropModal.classList.add('open');
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
    if (isHeic(file)) {
      uploadProfilePhoto(file);
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

// Shared form-handling logic for the catch log/edit forms (log-catch.html,
// edit-catch.html). Each page keeps its own `el` DOM-ref object and its own
// list of state-panel ids (the two pages' state divs aren't named
// identically), so both are passed in explicitly rather than assumed global.

function showState(stateId, stateIds) {
  stateIds.forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== stateId);
  });
}
window.showState = showState;

function populateSelect(selectEl, items) {
  // Remove all options after the first placeholder option
  while (selectEl.options.length > 1) selectEl.remove(1);
  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.name;
    selectEl.appendChild(opt);
  });
}
window.populateSelect = populateSelect;

function buildCaughtWhen(el) {
  const date = el.catchDate.value; // YYYY-MM-DD
  if (!date) return null;

  // Default to midnight when no time is given (full datetime string avoids UTC parsing gotcha)
  const time = el.catchTime.value || '00:00';

  // No trailing "Z" → JS parses as local time → .toISOString() converts to UTC
  return new Date(`${date}T${time}:00`).toISOString();
}
window.buildCaughtWhen = buildCaughtWhen;

function validate(el) {
  const errors = {};

  if (!el.anglerId.value)      errors.anglerId      = 'Please select an angler.';
  if (!el.fishSpeciesId.value) errors.fishSpeciesId = 'Please select a fish species.';
  if (!el.bodyOfWaterId.value) errors.bodyOfWaterId = 'Please select a body of water.';
  if (!el.catchDate.value)     errors.catchDate     = 'Please select a date.';

  const length = parseFloat(el.lengthInInches.value);
  if (el.lengthInInches.value !== '' && (isNaN(length) || length <= 0)) {
    errors.lengthInInches = 'Length must be greater than 0.';
  }

  const depth = parseFloat(el.waterDepthInFeet.value);
  if (el.waterDepthInFeet.value !== '' && (isNaN(depth) || depth <= 0)) {
    errors.waterDepthInFeet = 'Water depth must be greater than 0.';
  }

  return errors;
}
window.validate = validate;

function showErrors(errors) {
  ['anglerId', 'fishSpeciesId', 'bodyOfWaterId', 'catchDate', 'lengthInInches', 'waterDepthInFeet'].forEach(id => {
    const errEl = document.getElementById(`${id}Error`);
    if (!errEl) return;
    if (errors[id]) {
      errEl.textContent = errors[id];
      errEl.classList.remove('hidden');
    } else {
      errEl.classList.add('hidden');
    }
  });
}
window.showErrors = showErrors;

function clearErrors(el) {
  document.querySelectorAll('.field-error').forEach(e => e.classList.add('hidden'));
  el.formError.textContent = '';
  el.formError.classList.add('hidden');
}
window.clearErrors = clearErrors;

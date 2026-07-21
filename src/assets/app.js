const askCard = document.getElementById('askGillbertCard');
const toast   = document.getElementById('comingSoonToast');
let toastTimer;

if (askCard && toast) {
  askCard.addEventListener('click', () => {
    clearTimeout(toastTimer);
    toast.classList.remove('hidden');
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
  });
}

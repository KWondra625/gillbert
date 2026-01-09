const out = document.getElementById("out");
document.getElementById("ping").addEventListener("click", () => {
  out.textContent = `Pinged at ${new Date().toLocaleString()}`;
});

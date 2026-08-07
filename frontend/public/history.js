document.addEventListener("DOMContentLoaded", () => {
  function showTab(name) {
    document.querySelectorAll(".tab-panel").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
    document.getElementById("tab-" + name).classList.add("active");
    document.getElementById("tab-btn-" + name).classList.add("active");
  }

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  const COL = { loc: 3, ip: 2, date: 1, status: 8 };

  function applyFilters() {
    const loc    = document.getElementById("f-loc").value.trim().toLowerCase();
    const ip     = document.getElementById("f-ip").value.trim().toLowerCase();
    const date   = document.getElementById("f-date").value.trim().toLowerCase();
    const status = document.getElementById("f-status").value;
    let visible = 0;
    document.querySelectorAll("#tbody tr").forEach(tr => {
      const cells = tr.querySelectorAll("td");
      if (!cells.length) return;
      const match =
        (!loc    || cells[COL.loc]?.textContent.toLowerCase().includes(loc)) &&
        (!ip     || cells[COL.ip]?.textContent.toLowerCase().includes(ip)) &&
        (!date   || cells[COL.date]?.textContent.toLowerCase().includes(date)) &&
        (!status || cells[COL.status]?.textContent.trim() === status);
      tr.classList.toggle("hidden", !match);
      if (match) visible++;
    });
    document.getElementById("count").textContent = (loc || ip || date || status) ? visible + " záznamov" : "";
  }

  function clearFilters() {
    ["f-loc", "f-ip", "f-date"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("f-status").value = "";
    applyFilters();
  }

  document.getElementById("f-loc")?.addEventListener("input", applyFilters);
  document.getElementById("f-ip")?.addEventListener("input", applyFilters);
  document.getElementById("f-date")?.addEventListener("input", applyFilters);
  document.getElementById("f-status")?.addEventListener("change", applyFilters);
  document.getElementById("f-clear")?.addEventListener("click", clearFilters);
});

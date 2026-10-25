/* =========================================================
   dashboard.js: PayNova merchant dashboard (DEMO ONLY).
   - Reads the MOCK rows already in dashboard/index.html.
   - Creates no transactions and contacts no server.
   - Calculates summary cards and the simulated total from the rows.
   - Every number shown is labelled as demo data.
   - Contains no secrets and displays no personal or payment data.
   ========================================================= */
(function () {
  "use strict";

  var PN = window.PayNova;
  var ALLOWED_STATUSES = ["PAID", "PENDING", "FAILED", "CANCELLED"];
  var ALLOWED_FILTERS = ["ALL", "PAID", "PENDING", "FAILED", "CANCELLED"];
  var AMOUNT_RE = /^₹\s?([0-9][0-9,]*)\.([0-9]{2})$/;

  var main = document.querySelector("main");
  var tbody = document.getElementById("txRows");
  var filterGroup = document.querySelector(".filters");
  var statValues = document.querySelectorAll(".summary .stat strong");
  var tableWrap = document.querySelector(".table-wrap");

  // Stop quietly if the page is missing its key parts or the shared helpers failed to load.
  if (!PN || !tbody || !main) {
    showFatal("The dashboard could not start. Please refresh and try again.");
    return;
  }

  var rows = [];
  var emptyRow = null;
  var totalsNote = null;

  /* ---------- Helpers ---------- */

  // Shows a safe message at the top of the page. Uses textContent only.
  function showFatal(message) {
    var box = document.createElement("div");
    box.className = "notice notice-error";
    box.setAttribute("role", "alert");
    box.textContent = message;
    if (main) main.insertBefore(box, main.firstChild);
    else document.body.appendChild(box);
  }

  // Converts text such as "₹1,499.00" into whole paise (149900).
  // Returns null if the text does not match, so bad rows are ignored.
  function parseRupeesToPaise(text) {
    var match = AMOUNT_RE.exec(String(text || "").trim());
    if (!match) return null;
    var rupees = parseInt(match[1].replace(/,/g, ""), 10);
    var paise = rupees * 100 + parseInt(match[2], 10);
    return PN.isValidPaise(paise) ? paise : null;
  }

  // Reads one row. Returns null for rows with a missing or unknown status.
  function readRow(tr) {
    var status = String(tr.getAttribute("data-status") || "").toUpperCase();
    if (ALLOWED_STATUSES.indexOf(status) === -1) return null;
    if (!tr.cells || tr.cells.length < 5) return null;
    return {
      node: tr,
      status: status,
      amountPaise: parseRupeesToPaise(tr.cells[3].textContent)
    };
  }

  function setStat(index, text) {
    if (statValues.length === 3 && statValues[index]) {
      statValues[index].textContent = text;
    }
  }

  /* ---------- Summary ---------- */

  function renderSummary() {
    var total = rows.length;
    var paid = 0;
    var pending = 0;
    var paidTotalPaise = 0;

    rows.forEach(function (row) {
      if (row.status === "PAID") {
        paid += 1;
        if (row.amountPaise !== null) paidTotalPaise += row.amountPaise;
      }
      if (row.status === "PENDING") pending += 1;
    });

    setStat(0, String(total));
    setStat(1, String(paid));
    setStat(2, String(pending));

    if (!totalsNote) {
      totalsNote = document.createElement("p");
      totalsNote.className = "fine";
      totalsNote.style.marginTop = "12px";
      if (tableWrap && tableWrap.parentNode) {
        tableWrap.parentNode.insertBefore(totalsNote, tableWrap.nextSibling);
      }
    }
    totalsNote.textContent =
      "Simulated successful total: " + PN.formatINR(paidTotalPaise) +
      " across " + paid + " demo " + (paid === 1 ? "payment" : "payments") +
      ". No real money was moved.";
  }

  /* ---------- Empty state ---------- */

  function ensureEmptyRow() {
    if (emptyRow) return;
    emptyRow = document.createElement("tr");
    emptyRow.setAttribute("data-empty", "true");
    var cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "muted";
    cell.style.textAlign = "center";
    cell.style.padding = "24px 16px";
    emptyRow.appendChild(cell);
    tbody.appendChild(emptyRow);
  }

  function setEmptyMessage(text) {
    ensureEmptyRow();
    emptyRow.cells[0].textContent = text;
    emptyRow.hidden = false;
  }

  /* ---------- Filtering ---------- */

  function applyFilter(filter) {
    var visible = 0;

    rows.forEach(function (row) {
      var show = filter === "ALL" || row.status === filter;
      row.node.hidden = !show;
      if (show) visible += 1;
    });

    if (rows.length === 0) {
      setEmptyMessage("No demo transactions to show.");
    } else if (visible === 0) {
      setEmptyMessage("No demo transactions match this filter.");
    } else if (emptyRow) {
      emptyRow.hidden = true;
    }
  }

  function setActiveChip(filter) {
    if (!filterGroup) return;
    var chips = filterGroup.querySelectorAll("[data-filter]");
    Array.prototype.forEach.call(chips, function (chip) {
      var on = chip.getAttribute("data-filter") === filter;
      chip.classList.toggle("is-active", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function onFilterClick(event) {
    var chip = event.target.closest ? event.target.closest("[data-filter]") : null;
    if (!chip || !filterGroup.contains(chip)) return;

    var filter = String(chip.getAttribute("data-filter") || "").toUpperCase();
    if (ALLOWED_FILTERS.indexOf(filter) === -1) return;

    setActiveChip(filter);
    applyFilter(filter);
  }

  /* ---------- Start ---------- */

  function init() {
    rows = Array.prototype.map.call(tbody.querySelectorAll("tr[data-status]"), readRow)
      .filter(function (row) { return row !== null; });

    renderSummary();
    applyFilter("ALL");

    if (filterGroup) {
      filterGroup.addEventListener("click", onFilterClick);
    }
  }

  init();
})();

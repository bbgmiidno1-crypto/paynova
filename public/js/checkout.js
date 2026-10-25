/* =========================================================
   checkout.js: PayNova checkout page.
   - DEMO ONLY for now. Simulates a payment. Nothing is charged.
   - Collects NO card numbers, CVVs, UPI PINs or bank passwords.
   - Never marks an order as paid. Only the server can do that (Phase 5).
   - Live payments are not enabled. startLiveCheckout() shows a
     notice and does nothing else.
   ========================================================= */
(function () {
  "use strict";

  var PN = window.PayNova;

  if (!PN) {
    var fatal = document.getElementById("notice");
    if (fatal) {
      fatal.className = "notice notice-error";
      fatal.textContent = "The page could not start. Please refresh and try again.";
      fatal.hidden = false;
    }
    return;
  }

  var DEMO_DELAY_MS = 1200;
  var ORDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var UPI_ID_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

  var METHODS = [
    { value: "UPI", label: "UPI" },
    { value: "CARD", label: "Card" },
    { value: "NETBANKING", label: "Net banking" }
  ];
  // Fictional bank names. These are not real banks.
  var DEMO_BANKS = ["Demo Bank Alpha", "Demo Bank Beta", "Demo Bank Gamma"];
  var DEMO_OUTCOMES = [
    { value: "SUCCESS", label: "Success" },
    { value: "FAILED", label: "Failed" },
    { value: "PENDING", label: "Pending" },
    { value: "CANCELLED", label: "Cancelled" }
  ];

  var params = new URLSearchParams(location.search);
  var isDemo = PN.isDemo;
  var orderId = params.get("order");
  var requestedOutcome = (params.get("sim") || "SUCCESS").toUpperCase();

  var $ = function (id) { return document.getElementById(id); };
  var payBtn = $("payBtn");

  var order = null;
  var busy = false;
  var selectedMethod = null;
  var selectedBank = null;
  var demoOutcome = "SUCCESS";
  var ui = {};

  /* ---------- Small helpers ---------- */

  // Builds an element. Text is set with textContent, never innerHTML.
  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function notice(tone, text) {
    var box = $("notice");
    box.className = "notice notice-" + tone;
    box.textContent = text;
    box.hidden = false;
  }

  function hideNotice() {
    $("notice").hidden = true;
  }

  function showLoadError(message) {
    order = null;
    refreshPayButton();
    notice("error", message);
  }

  function setBusy(on) {
    busy = on;
    refreshPayButton();
  }

  function refreshPayButton() {
    if (!payBtn) return;
    payBtn.disabled = busy || !order;
    if (busy) {
      payBtn.textContent = "Processing…";
    } else if (!order) {
      payBtn.textContent = "Pay now";
    } else {
      payBtn.textContent = (isDemo ? "Simulate payment " : "Pay ") + PN.formatINR(order.amount_paise);
    }
  }

  // Creates a chip button and returns it together with its value.
  function makeChip(value, label, onPick) {
    var btn = el("button", label, "chip");
    btn.type = "button";
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", function () { onPick(value); });
    return { value: value, node: btn };
  }

  // Highlights exactly one chip in a list.
  function setChipState(items, value) {
    items.forEach(function (item) {
      var on = item.value === value;
      item.node.classList.toggle("is-active", on);
      item.node.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  /* ---------- Building the controls ---------- */

  // Adds the method picker and demo fields above the Pay button.
  // checkout.html does not need to change.
  function buildControls() {
    var wrap = el("div");
    wrap.appendChild(el("h3", "Choose a payment method"));

    // Method chips
    var methodRow = el("div", "", "filters");
    methodRow.setAttribute("role", "group");
    methodRow.setAttribute("aria-label", "Payment method");
    ui.methodChips = METHODS.map(function (m) {
      var item = makeChip(m.value, m.label, selectMethod);
      methodRow.appendChild(item.node);
      return item;
    });
    wrap.appendChild(methodRow);

    // UPI: the UPI ID only. No PIN field exists.
    ui.upiSection = el("div");
    ui.upiSection.hidden = true;
    var upiLabel = el("label", "UPI ID");
    var upiInput = document.createElement("input");
    upiInput.type = "text";
    upiInput.id = "upiId";
    upiInput.name = "upiId";
    upiInput.placeholder = "yourname@bank";
    upiInput.autocomplete = "off";
    upiInput.autocapitalize = "none";
    upiInput.spellcheck = false;
    upiInput.inputMode = "email";
    upiLabel.appendChild(upiInput);
    ui.upiInput = upiInput;
    ui.upiSection.appendChild(upiLabel);
    ui.upiSection.appendChild(el(
      "p",
      "Enter your UPI ID only. Never enter your UPI PIN on this page or anywhere outside your UPI app.",
      "fine"
    ));
    wrap.appendChild(ui.upiSection);

    // Card: no fields are collected, even in demo mode.
    ui.cardSection = el("div");
    ui.cardSection.hidden = true;
    ui.cardSection.appendChild(el(
      "p",
      "Card details are not collected in demo mode. In live mode you will enter your card only on our payment partner's secure page, never on this page.",
      "fine"
    ));
    wrap.appendChild(ui.cardSection);

    // Net banking: pick a fictional demo bank. No login is requested.
    ui.bankSection = el("div");
    ui.bankSection.hidden = true;
    ui.bankSection.appendChild(el("p", "Choose your bank. These demo bank names are fictional.", "fine"));
    var bankRow = el("div", "", "filters");
    bankRow.setAttribute("role", "group");
    bankRow.setAttribute("aria-label", "Bank");
    ui.bankChips = DEMO_BANKS.map(function (name) {
      var item = makeChip(name, name, selectBank);
      bankRow.appendChild(item.node);
      return item;
    });
    ui.bankSection.appendChild(bankRow);
    wrap.appendChild(ui.bankSection);

    // Demo outcome selector (demo mode only)
    if (isDemo) {
      wrap.appendChild(el("h3", "Demo outcome (testing only)"));
      var outcomeRow = el("div", "", "filters");
      outcomeRow.setAttribute("role", "group");
      outcomeRow.setAttribute("aria-label", "Demo outcome");
      ui.outcomeChips = DEMO_OUTCOMES.map(function (o) {
        var item = makeChip(o.value, o.label, selectOutcome);
        outcomeRow.appendChild(item.node);
        return item;
      });
      wrap.appendChild(outcomeRow);
      var validOutcome = DEMO_OUTCOMES.some(function (o) { return o.value === requestedOutcome; });
      selectOutcome(validOutcome ? requestedOutcome : "SUCCESS");
    }

    payBtn.parentNode.insertBefore(wrap, payBtn);
  }

  /* ---------- Selections ---------- */

  function selectMethod(value) {
    selectedMethod = value;
    setChipState(ui.methodChips, value);
    ui.upiSection.hidden = value !== "UPI";
    ui.cardSection.hidden = value !== "CARD";
    ui.bankSection.hidden = value !== "NETBANKING";
    if (value !== "NETBANKING") {
      selectedBank = null;
      setChipState(ui.bankChips, null);
    }
    hideNotice();
  }

  function selectBank(name) {
    selectedBank = name;
    setChipState(ui.bankChips, name);
    hideNotice();
  }

  function selectOutcome(value) {
    demoOutcome = value;
    if (ui.outcomeChips) setChipState(ui.outcomeChips, value);
  }

  /* ---------- Validation ---------- */

  // Returns null when valid, or { message, focus } for the first problem found.
  function validate() {
    if (!selectedMethod) {
      return { message: "Choose a payment method to continue.", focus: ui.methodChips[0].node };
    }
    if (selectedMethod === "UPI") {
      var upi = ui.upiInput.value.trim();
      if (!upi) {
        return { message: "Enter your UPI ID to continue.", focus: ui.upiInput };
      }
      if (!UPI_ID_RE.test(upi)) {
        return { message: "That UPI ID does not look right. It should look like name@bank.", focus: ui.upiInput };
      }
    }
    if (selectedMethod === "NETBANKING" && !selectedBank) {
      return { message: "Choose your bank to continue.", focus: ui.bankChips[0].node };
    }
    return null;
  }

  /* ---------- Paying ---------- */

  function onPayClick() {
    if (busy || !order) return;
    hideNotice();

    var problem = validate();
    if (problem) {
      notice("error", problem.message);
      if (problem.focus && typeof problem.focus.focus === "function") problem.focus.focus();
      return;
    }

    if (!isDemo) return startLiveCheckout();
    runDemoPayment();
  }

  function runDemoPayment() {
    setBusy(true);
    notice("info", "Demo payment in progress. Nothing is charged and no bank or UPI app is contacted.");
    setTimeout(finishDemoPayment, DEMO_DELAY_MS);
  }

  function finishDemoPayment() {
    if (demoOutcome === "CANCELLED") {
      setBusy(false);
      notice("warn", "Demo: you closed the payment window. Your order is still open and nothing was charged.");
      return;
    }
    // Success, failed and pending go to the status page, which shows a demo banner.
    location.href = statusUrl(demoOutcome);
  }

  function statusUrl(outcome) {
    return "status.html?order=" + encodeURIComponent(order.id) +
      "&demo=1&result=" + encodeURIComponent(outcome.toLowerCase());
  }

  // LIVE PAYMENTS ARE NOT ENABLED.
  // When the backend is verified (Phases 3 to 5), this function will:
  //   1. Ask the server to create a provider order. The server holds the secret key.
  //   2. Open the provider's official hosted checkout using only the public key
  //      and the provider order ID returned by the server.
  //   3. Send the result to the server, which verifies it before marking the order PAID.
  // This browser code will never mark an order as paid.
  function startLiveCheckout() {
    notice("warn", "Live payments are not switched on yet. This page supports demo mode only for now.");
  }

  /* ---------- Loading the order ---------- */

  function render(o) {
    order = o;
    $("merchantName").textContent = o.merchant_name || "Merchant";
    $("amount").textContent = PN.formatINR(o.amount_paise);
    $("description").textContent = o.description || "";
    $("orderId").textContent = o.id || "—";
    busy = false;
    refreshPayButton();
  }

  function loadOrder() {
    if (!orderId || !ORDER_ID_RE.test(orderId)) {
      return showLoadError("This payment link is not valid. Check the link and try again.");
    }

    if (isDemo) {
      $("demoBanner").hidden = false;
      return render({
        id: orderId,
        merchant_name: "Demo Store",
        description: "Premium plan (monthly)",
        amount_paise: 149900,
        currency: "INR",
        status: "CREATED"
      });
    }

    // Read-only order summary. No payment is started here.
    PN.request("/public/orders/" + encodeURIComponent(orderId))
      .then(function (data) {
        if (!data || typeof data !== "object") {
          throw new Error("The server sent an unexpected response.");
        }
        if (data.status === "PAID") {
          location.replace("status.html?order=" + encodeURIComponent(orderId));
          return;
        }
        render(data);
        notice("warn", "Live payments are not switched on yet. This page supports demo mode only for now.");
      })
      .catch(function (err) {
        showLoadError(
          err && err.status === 404
            ? "This payment link is no longer valid."
            : (err && err.message) || "We could not load your order. Please try again."
        );
      });
  }

  /* ---------- Start ---------- */

  function init() {
    buildControls();
    refreshPayButton();
    payBtn.addEventListener("click", onPayClick);
    loadOrder();
  }

  init();
})();

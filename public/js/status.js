/* =========================================================
   status.js: PayNova payment status page.
   - DEMO (?demo=1): shows a SIMULATED result from the ?result= value.
     Every demo screen is labelled as a simulation. No server is contacted.
   - LIVE (no demo=1): ignores ?result= completely. It asks the server for
     the order and shows only the status the server returns.
     "Success" is shown ONLY when the server says PAID.
   - Never shows success on errors, unknown statuses or mismatched orders.
   - Contains no secrets and displays no personal or payment data.
   ========================================================= */
(function () {
  "use strict";

  var PN = window.PayNova;

  if (!PN) {
    var fatal = document.getElementById("errorBox");
    if (fatal) {
      fatal.textContent = "The page could not start. Please refresh and try again.";
      fatal.hidden = false;
    }
    return;
  }

  var $ = function (id) { return document.getElementById(id); };

  var ORDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var POLL_MS = 3000;
  var MAX_POLLS = 20;
  var DEMO_AMOUNT_PAISE = 149900; // Matches the demo order on checkout.html (₹1,499.00).
  var DEMO_RESULTS = {
    success: "PAID",
    failed: "FAILED",
    pending: "PENDING",
    cancelled: "CANCELLED"
  };
  var KNOWN_STATUSES = ["CREATED", "PENDING", "PAID", "FAILED", "CANCELLED"];

  var params = new URLSearchParams(location.search);
  var orderId = params.get("order");
  var isDemo = PN.isDemo;

  var polls = 0;
  var pollTimer = null;
  var requestSeq = 0; // Ignores replies from older requests.

  // Display text for each status. Demo text always says it is a simulation.
  var VIEWS = {
    PAID: {
      icon: "✓", tone: "ok",
      title: "Payment successful",
      body: "Thank you. Our server has confirmed your payment.",
      demoTitle: "Simulated payment successful",
      demoBody: "This is a demo result. No money was moved."
    },
    FAILED: {
      icon: "!", tone: "err",
      title: "Payment failed",
      body: "The payment did not go through. You can try again.",
      demoTitle: "Simulated payment failed",
      demoBody: "This is a demo result. No money was moved.",
      retryLabel: "Try again"
    },
    PENDING: {
      icon: "…", tone: "warn",
      title: "Payment pending",
      body: "Your bank is still processing this payment. This page updates automatically.",
      demoTitle: "Simulated pending payment",
      demoBody: "This is a demo result. In live mode, this page would keep checking the server."
    },
    CANCELLED: {
      icon: "×", tone: "warn",
      title: "Payment cancelled",
      body: "You closed the payment window. Your order is still open.",
      demoTitle: "Simulated cancelled payment",
      demoBody: "This is a demo result. No money was moved.",
      retryLabel: "Return to payment"
    },
    CREATED: {
      icon: "→", tone: "info",
      title: "Awaiting payment",
      body: "This order has not been paid yet.",
      demoTitle: "Awaiting payment",
      demoBody: "This is a demo result. No money was moved.",
      retryLabel: "Go to payment"
    }
  };

  /* ---------- Display helpers ---------- */

  function showError(message) {
    var box = $("errorBox");
    box.textContent = message;
    box.hidden = false;
  }

  function clearError() {
    $("errorBox").hidden = true;
  }

  function setPollNote(text) {
    var note = $("pollNote");
    if (!text) {
      note.hidden = true;
      return;
    }
    note.textContent = text;
    note.hidden = false;
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  // Only https URLs are allowed as a return link. Anything else falls back to the home page.
  function safeReturnUrl(value) {
    if (typeof value !== "string" || !value) return null;
    try {
      var url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function checkoutLink() {
    var base = "checkout.html?order=" + encodeURIComponent(orderId);
    return isDemo ? base + "&demo=1&sim=SUCCESS" : base;
  }

  // Shows one status layout. Demo layouts use the simulation wording.
  function renderView(status, order) {
    var view = VIEWS[status];
    if (!view) return renderUnavailable("We could not confirm this payment. Tap Check again to retry.");

    var icon = $("statusIcon");
    icon.textContent = view.icon;
    icon.className = "status-icon tone-" + view.tone;

    $("statusTitle").textContent = isDemo ? view.demoTitle : view.title;
    $("statusBody").textContent = isDemo ? view.demoBody : view.body;
    $("amount").textContent = PN.formatINR(order.amount_paise);
    $("orderId").textContent = orderId || "—";
    $("demoBanner").hidden = !isDemo;

    // Main action button
    var primary = $("primaryBtn");
    if (view.retryLabel) {
      primary.href = checkoutLink();
      primary.textContent = view.retryLabel;
      primary.hidden = false;
    } else if (status === "PAID") {
      var returnUrl = isDemo ? null : safeReturnUrl(order.return_url);
      primary.href = returnUrl || "index.html";
      primary.textContent = returnUrl ? "Return to merchant" : "Back to home";
      primary.hidden = false;
    } else {
      primary.hidden = true;
    }

    // "Check again" appears only for live pending payments.
    $("checkAgain").hidden = isDemo || status !== "PENDING";
  }

  // Neutral screen for errors. It never shows success.
  function renderUnavailable(message) {
    $("statusIcon").textContent = "?";
    $("statusIcon").className = "status-icon tone-info";
    $("statusTitle").textContent = "Status unavailable";
    $("statusBody").textContent = message;
    $("amount").textContent = "—";
    $("orderId").textContent = orderId || "—";
    $("primaryBtn").hidden = true;
    $("checkAgain").hidden = isDemo;
    $("demoBanner").hidden = !isDemo;
    setPollNote("");
  }

  /* ---------- Demo mode (simulation only) ---------- */

  function runDemo() {
    var result = (params.get("result") || "").toLowerCase();
    var status = DEMO_RESULTS[result];

    if (!status) {
      return renderUnavailable("This demo link is not valid. Go back to the demo checkout and choose an outcome again.");
    }

    renderView(status, { id: orderId, amount_paise: DEMO_AMOUNT_PAISE });
    setPollNote("");
  }

  /* ---------- Live mode (server is the only source of truth) ---------- */

  function scheduleNextCheck() {
    stopPolling();
    if (polls >= MAX_POLLS) {
      setPollNote("Still processing. Tap Check again to refresh.");
      $("checkAgain").hidden = false;
      return;
    }
    polls += 1;
    pollTimer = setTimeout(checkServer, POLL_MS);
  }

  function checkServer() {
    stopPolling();
    var seq = ++requestSeq;

    PN.request("/public/orders/" + encodeURIComponent(orderId))
      .then(function (data) {
        if (seq !== requestSeq) return; // A newer request has replaced this one.

        if (!data || typeof data !== "object") {
          throw new Error("unexpected");
        }
        // The reply must be for the order in this link.
        if (data.id && String(data.id) !== orderId) {
          throw new Error("mismatch");
        }

        var status = String(data.status || "").toUpperCase();
        if (KNOWN_STATUSES.indexOf(status) === -1) {
          throw new Error("unknown-status");
        }

        clearError();
        renderView(status, data);

        if (status === "PENDING") {
          setPollNote("Checking for updates every few seconds…");
          scheduleNextCheck();
        } else {
          setPollNote("");
        }
      })
      .catch(function (err) {
        if (seq !== requestSeq) return;

        var message;
        if (err && err.status === 404) {
          message = "This order could not be found. Check the link and try again.";
        } else {
          message = "We could not confirm your payment yet. Tap Check again to retry.";
        }

        renderUnavailable(message);
        showError(message);
        setPollNote("");
      });
  }

  function runLive() {
    // ?result= is deliberately ignored here. Only the server can report the status.
    renderUnavailable("Checking your payment…");
    $("checkAgain").hidden = true;
    checkServer();
  }

  /* ---------- Start ---------- */

  function init() {
    if (!orderId || !ORDER_ID_RE.test(orderId)) {
      renderUnavailable("This status link is not valid. Go back to home and try again.");
      showError("We could not find an order in this link.");
      return;
    }

    $("checkAgain").addEventListener("click", function () {
      polls = 0;
      clearError();
      if (isDemo) return; // Demo results do not change.
      checkServer();
    });

    if (isDemo) runDemo();
    else runLive();
  }

  init();
})();

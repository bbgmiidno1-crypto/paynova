/* =========================================================
   api.js: shared helpers for every PayNova page.
   - Contains NO secrets, keys, passwords or tokens.
   - Demo mode only for now: request() never contacts a server
     while ?demo=1 is in the page address.
   - Exposes window.PayNova for checkout.js, status.js and dashboard.js.
   ========================================================= */
(function () {
  "use strict";

  var API_BASE = "/api";
  var REQUEST_TIMEOUT_MS = 15000;
  var MAX_ERROR_LENGTH = 200;
  var ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  var DEMO_LABEL = "Demo mode: no real money is moved and no payment provider is contacted.";

  var MESSAGES = {
    network: "Network problem. Check your connection and try again.",
    timeout: "The request took too long. Please try again.",
    invalid: "The server sent an unexpected response.",
    badPath: "Invalid request.",
    badMethod: "Invalid request method.",
    badBody: "Could not prepare the request.",
    demo: "Live requests are switched off in demo mode.",
    unknown: "Something went wrong. Please try again."
  };

  var STATUS_MESSAGES = {
    400: "Some details were not accepted.",
    401: "Please sign in again.",
    403: "You do not have access to this.",
    404: "We could not find what you asked for.",
    409: "This conflicts with an existing record.",
    429: "Too many requests. Please wait a moment and try again.",
    500: "The server had a problem. Please try again shortly.",
    502: "The server is temporarily unavailable. Please try again shortly.",
    503: "The service is temporarily unavailable. Please try again shortly."
  };

  var params = new URLSearchParams(window.location.search);
  var isDemo = params.get("demo") === "1";

  /* ---------- Errors ---------- */

  // Every failed request is rejected with an ApiError. It has a status (0 when the
  // request never reached the server), a short code and a message safe to display.
  function ApiError(message, status, code) {
    this.name = "ApiError";
    this.message = message;
    this.status = status || 0;
    this.code = code || "UNKNOWN";
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  // Cleans text from the server before it is shown: strips control characters and limits length.
  function safeText(value) {
    if (typeof value !== "string") return null;
    var cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
    if (!cleaned) return null;
    return cleaned.length > MAX_ERROR_LENGTH
      ? cleaned.slice(0, MAX_ERROR_LENGTH - 1) + "…"
      : cleaned;
  }

  function errorFromResponse(status, data) {
    var serverMessage = data && typeof data === "object" ? safeText(data.error) : null;
    var message = serverMessage || STATUS_MESSAGES[status] || MESSAGES.unknown;
    return new ApiError(message, status, "HTTP_" + status);
  }

  /* ---------- Requests ---------- */

  // Reads the body as JSON. Returns null for an empty body and the INVALID marker
  // for a body that is not valid JSON.
  var INVALID = {};
  function readJson(res) {
    return res.text().then(
      function (text) {
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch (_) {
          return INVALID;
        }
      },
      function () {
        return INVALID;
      }
    );
  }

  /**
   * Sends a request to the PayNova API.
   * @param {string} path    Path starting with "/", e.g. "/merchant/orders".
   * @param {object} options { method: "GET" | "POST" | ..., body: any JSON-serialisable value }
   * @returns {Promise<any>} Resolves with the parsed JSON response.
   */
  function request(path, options) {
    options = options || {};
    var method = String(options.method || "GET").toUpperCase();

    if (typeof path !== "string" || path.charAt(0) !== "/" || path.indexOf("//") === 0) {
      return Promise.reject(new ApiError(MESSAGES.badPath, 0, "BAD_PATH"));
    }
    if (ALLOWED_METHODS.indexOf(method) === -1) {
      return Promise.reject(new ApiError(MESSAGES.badMethod, 0, "BAD_METHOD"));
    }
    // Demo pages never reach the server, so demo can never touch a payment provider.
    if (isDemo) {
      return Promise.reject(new ApiError(MESSAGES.demo, 0, "DEMO_MODE"));
    }

    var headers = { Accept: "application/json" };
    var init = {
      method: method,
      headers: headers,
      credentials: "same-origin",
      cache: "no-store"
    };

    if (options.body !== undefined) {
      try {
        init.body = JSON.stringify(options.body);
      } catch (_) {
        return Promise.reject(new ApiError(MESSAGES.badBody, 0, "BAD_BODY"));
      }
      headers["Content-Type"] = "application/json";
    }

    var controller = typeof AbortController === "function" ? new AbortController() : null;
    if (controller) init.signal = controller.signal;
    var timer = controller
      ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS)
      : null;

    function stopTimer() {
      if (timer) clearTimeout(timer);
    }

    return fetch(API_BASE + path, init).then(
      function (res) {
        return readJson(res).then(function (data) {
          stopTimer();
          if (!res.ok) throw errorFromResponse(res.status, data === INVALID ? null : data);
          if (data === INVALID) throw new ApiError(MESSAGES.invalid, res.status, "INVALID_JSON");
          return data;
        });
      },
      function (err) {
        stopTimer();
        if (err && err.name === "AbortError") {
          throw new ApiError(MESSAGES.timeout, 0, "TIMEOUT");
        }
        throw new ApiError(MESSAGES.network, 0, "NETWORK");
      }
    );
  }

  /* ---------- Money and dates ---------- */

  // All money is stored as whole paise (₹1 = 100 paise). Only convert when displaying.
  function isValidPaise(value) {
    return typeof value === "number" && isFinite(value) && Math.floor(value) === value &&
      value >= 0 && value <= 1e12;
  }

  var inrFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2
  });

  function formatINR(paise) {
    if (paise === null || paise === undefined) return "—";
    var value = Number(paise);
    if (!isValidPaise(value)) return "—";
    return inrFormatter.format(value / 100);
  }

  var dateFormatter = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata"
  });

  function formatDate(iso) {
    if (!iso) return "";
    var date = new Date(iso);
    return isNaN(date.getTime()) ? "" : dateFormatter.format(date);
  }

  /* ---------- Safe display helper ---------- */

  // Escapes text for the rare case it must be placed into HTML. Prefer textContent.
  function escapeHtml(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ---------- Public interface ---------- */

  window.PayNova = Object.freeze({
    API_BASE: API_BASE,
    isDemo: isDemo,
    DEMO_LABEL: DEMO_LABEL,
    ApiError: ApiError,
    request: request,
    formatINR: formatINR,
    formatDate: formatDate,
    isValidPaise: isValidPaise,
    escapeHtml: escapeHtml
  });
})();

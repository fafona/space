/* Anonymous contact-card counters. No cookies, IDs in storage, or form values. */
(function () {
  "use strict";
  if (window.top !== window || navigator.doNotTrack === "1" || navigator.globalPrivacyControl || !crypto.randomUUID) return;
  var script = document.currentScript;
  var token = script && script.getAttribute("data-traffic-token");
  if (!token) return;
  var source = "direct_unknown";
  var medium = "unknown";
  var campaign;
  try {
    var media = new URLSearchParams(location.search).getAll("faolla_medium");
    if (media.length === 1 && ["qr", "share", "nfc", "ad"].indexOf(media[0]) !== -1) medium = media[0];
    var campaigns = new URLSearchParams(location.search).getAll("faolla_campaign");
    if (campaigns.length === 1 && campaigns[0].length <= 1024 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(campaigns[0])) campaign = campaigns[0];
  } catch (_) { /* Invalid or ambiguous labels stay unknown. */ }
  try {
    var host = new URL(document.referrer).hostname;
    if (host === location.hostname) source = "internal";
    else if (/(^|\.)google\.(com|es|co\.uk)$/.test(host)) source = "google";
    else {
      source = "other_referral";
      ["bing", "baidu", "facebook", "instagram"].forEach(function (name) {
        if (host === name + ".com" || host.endsWith("." + name + ".com")) source = name;
      });
    }
  } catch (_) { /* No referrer: never assume QR or a particular social source. */ }
  var queue = [], timer;
  function flush() {
    clearTimeout(timer); timer = undefined;
    if (!queue.length) return;
    var events = queue.splice(0, 10);
    fetch("/api/traffic/collect", { method: "POST", credentials: "omit", keepalive: true,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: events }),
      signal: AbortSignal.timeout(4000)
    }).catch(function () {});
    if (queue.length) timer = setTimeout(flush, 1200);
  }
  function track(action) {
    if (queue.length >= 30) return;
    queue.push({ id: crypto.randomUUID(), token: token, action: action, source: source, medium: medium, campaign: campaign });
    if (!timer) timer = setTimeout(flush, 1200);
  }
  var viewed = false;
  function view() {
    if (!viewed && document.visibilityState === "visible") { viewed = true; track("view"); }
  }
  document.addEventListener("visibilitychange", function () { view(); if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
  document.addEventListener("click", function (event) {
    var anchor = event.target instanceof Element && event.target.closest("a");
    if (!anchor) return;
    var action = anchor.getAttribute("data-traffic-action");
    var href = anchor.getAttribute("href") || "";
    if (!action && href.startsWith("tel:")) action = "phone_click";
    if (!action && href.startsWith("mailto:")) action = "email_click";
    if (!action && /^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(href)) action = "whatsapp_click";
    if (action) track(action);
  }, { passive: true, capture: true });
  view();
})();

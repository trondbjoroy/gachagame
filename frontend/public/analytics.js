/* Anonymous usage analytics (PostHog EU).
   No cookies (localStorage only), no session recording, no autocapture,
   and no wallet addresses in any event. */
(function () {
  var s = document.createElement('script');
  s.src = 'https://eu-assets.i.posthog.com/static/array.js';
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.onload = function () {
    window.posthog.init('phc_A4YsHcVkk42FY7cscJiUnddJrvpk4uodDt5iuAx9CW92', {
      api_host: 'https://eu.i.posthog.com',
      persistence: 'localStorage',
      autocapture: false,
      disable_session_recording: true,
      person_profiles: 'identified_only',
    });
  };
  s.onerror = function () {}; // ad-blocked or offline: game runs fine without it
  document.head.appendChild(s);
})();

// safe no-op until (unless) posthog loads
window.track = function (name, props) {
  try {
    if (window.posthog && window.posthog.__loaded) window.posthog.capture(name, props);
  } catch (e) { /* analytics must never break the game */ }
};

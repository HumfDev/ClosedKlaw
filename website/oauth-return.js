/** If Google OAuth lands on the wrong page, forward to waitlist with query/hash intact. */
(function routeOAuthReturnToWaitlist() {
  const path = window.location.pathname.replace(/\/index\.html$/i, "") || "/";
  if (path.endsWith("/waitlist.html") || path.endsWith("/waitlist-success.html")) {
    return;
  }

  const search = window.location.search;
  const hash = window.location.hash;
  const hasQueryCode =
    search.includes("code=") || search.includes("error=") || search.includes("error_description=");
  const hasHashToken =
    hash.includes("access_token=") || hash.includes("code=") || hash.includes("error=");

  if (!hasQueryCode && !hasHashToken) return;

  window.location.replace(`/waitlist.html${search}${hash}`);
})();

(function () {
  if (!location.pathname.endsWith("/terms.html")) return;

  const allowed =
    sessionStorage.getItem("ck_waitlist_flow") === "1" ||
    new URLSearchParams(location.search).get("from") === "waitlist";

  if (!allowed) {
    location.replace("/waitlist.html");
  }
})();

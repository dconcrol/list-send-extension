/* Runs in the Gmail page world so we can read GLOBALS[10] (this tab's mailbox). */
(function () {
  const ATTR = 'data-cv-list-gmail-email';

  function looksLikeEmail(value) {
    return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(value || '').trim());
  }

  function readGlobalsEmail() {
    try {
      if (typeof GLOBALS !== 'undefined' && GLOBALS && looksLikeEmail(GLOBALS[10])) {
        return String(GLOBALS[10]).trim().toLowerCase();
      }
    } catch {
      /* isolated or missing */
    }
    return null;
  }

  function write() {
    const email = readGlobalsEmail();
    if (!email) return;
    const root = document.documentElement;
    if (root.getAttribute(ATTR) !== email) root.setAttribute(ATTR, email);
  }

  write();
  setInterval(write, 2000);
})();

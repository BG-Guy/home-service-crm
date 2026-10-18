/* CRM lead embed (SPEC M04). Source for public/embed.js — run `npm run build:embed`.
 * Usage: <form data-crm-lead …> … </form>
 *        <script src="https://crm.example.com/embed.js" data-key="pk_live_…" defer></script>
 * ES2017, no dependencies, < 3 KB gzipped. Works without it: the form still posts. */
(() => {
  const d = document;
  const s =
    d.currentScript || d.querySelector('script[data-key][src*="embed.js"]');
  if (!s) return;
  const key = s.getAttribute("data-key");
  if (!key) return;
  const endpoint = `${new URL(s.src).origin}/api/v1/leads/f/${key}`;
  const DAY = 864e5;
  const ATTR = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "gbraid",
    "wbraid",
    "fbclid",
    "msclkid",
  ];

  function get(k) {
    try {
      const v = JSON.parse(localStorage.getItem(k) || "null");
      return v && Date.now() - Date.parse(v.at) < 90 * DAY ? v : null;
    } catch (_e) {
      return null;
    }
  }
  function put(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (_e) {}
  }

  // First and last touch (90 days): UTM / click ids / external referrer.
  const q = new URLSearchParams(location.search);
  const t = {};
  let has = 0;
  ATTR.forEach((k) => {
    const v = q.get(k);
    if (v) {
      t[k] = v.slice(0, 300);
      has = 1;
    }
  });
  const ref = d.referrer;
  if (ref && ref.indexOf(location.origin) !== 0) {
    t.referrer = ref.slice(0, 500);
    has = 1;
  }
  let first = get("crm_ft");
  let last = get("crm_lt");
  if (has || !first) {
    t.landing_url = location.href.slice(0, 500);
    t.at = new Date().toISOString();
    if (!first) {
      first = t;
      put("crm_ft", t);
    }
    if (has || !last) {
      last = t;
      put("crm_lt", t);
    }
  }

  const cfg = fetch(endpoint, { credentials: "omit" })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));

  function hidden(f, name, value) {
    if (value == null || value === "") return;
    let i = f.querySelector(`input[type=hidden][name="${name}"]`);
    if (!i) {
      i = d.createElement("input");
      i.type = "hidden";
      i.name = name;
      f.appendChild(i);
    }
    i.value = value;
  }

  function box(f, name, text) {
    if (!text || f.querySelector(`[name="${name}"]`)) return;
    const l = d.createElement("label");
    l.style.cssText =
      "display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:8px 0";
    const c = d.createElement("input");
    c.type = "checkbox"; // never pre-checked, never required (10DLC)
    c.name = name;
    c.value = "yes";
    l.appendChild(c);
    l.appendChild(d.createTextNode(text));
    const b = f.querySelector("[type=submit],button:not([type])");
    b ? b.parentNode.insertBefore(l, b) : f.appendChild(l);
  }

  function enhance(f, c) {
    if (f.__crm) return;
    f.__crm = 1;
    if (!f.getAttribute("action")) f.action = endpoint;
    f.method = "post";
    if (!f.querySelector('[name="company_website"]')) {
      const h = d.createElement("input");
      h.name = "company_website";
      h.tabIndex = -1;
      h.autocomplete = "off";
      h.setAttribute("aria-hidden", "true");
      h.style.cssText = "position:absolute;left:-9999px;height:0;width:0";
      f.appendChild(h);
    }
    hidden(f, "_ts", c.ts);
    hidden(f, "page_url", location.href.slice(0, 500));
    if (first) hidden(f, "first_touch", JSON.stringify(first));
    if (last) hidden(f, "last_touch", JSON.stringify(last));
    ATTR.forEach((k) => {
      hidden(f, k, last?.[k] || first?.[k]);
    });
    box(f, "sms_consent", c.consent);
    box(f, "marketing_consent", c.marketing);
    if (c.consent && !f.querySelector('[name="consent_text"]'))
      hidden(f, "consent_text", c.consent);
    if (c.turnstile && !f.querySelector(".cf-turnstile")) {
      const w = d.createElement("div");
      w.className = "cf-turnstile";
      w.setAttribute("data-sitekey", c.turnstile);
      f.appendChild(w);
      if (!d.querySelector('script[src*="turnstile"]')) {
        const sc = d.createElement("script");
        sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
        sc.async = true;
        d.head.appendChild(sc);
      }
    }
    f.addEventListener("submit", (e) => {
      if (!window.fetch || !window.FormData) return;
      e.preventDefault();
      const btn = f.querySelector("[type=submit],button:not([type])");
      if (btn) btn.disabled = true;
      fetch(f.action, {
        method: "POST",
        body: new FormData(f),
        credentials: "omit",
        headers: {
          "X-Requested-With": "crm-embed",
          Accept: "application/json",
        },
      })
        .then((r) => {
          if (r.status >= 500 || r.status === 404) throw 0;
          if (r.status === 429) {
            if (btn) btn.disabled = false;
            alert("Too many requests. Please call us instead.");
            return;
          }
          const to = f.querySelector('[name="redirect"]');
          if (to?.value) {
            location.href = to.value;
            return;
          }
          const msg =
            f.getAttribute("data-crm-success") ||
            "Thanks! We got your request and will call you shortly.";
          const p = d.createElement("p");
          p.setAttribute("role", "status");
          p.style.cssText = "font-size:17px;padding:16px 0";
          p.textContent = msg;
          f.dispatchEvent(new CustomEvent("crm:lead", { bubbles: true }));
          f.replaceWith(p);
        })
        .catch(() => {
          // Network trouble: fall back to a normal POST so no lead is lost.
          f.submit();
        });
    });
  }

  function run() {
    cfg.then((c) => {
      const forms = d.querySelectorAll("form[data-crm-lead]");
      for (let i = 0; i < forms.length; i++) enhance(forms[i], c || {});
    });
  }
  d.readyState === "loading"
    ? d.addEventListener("DOMContentLoaded", run)
    : run();
})();

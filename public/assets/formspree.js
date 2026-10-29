// Sends a copy of every website form to Formspree (emails + Formspree dashboard).
// Netlify Forms keeps its own copy as a backup, so nothing is lost if one service has a problem.
// To connect: paste the Formspree form ID (the part after formspree.io/f/) below.
window.SF_FORMSPREE_ID = "xqpeyzaz";

window.formToObject = function (form) {
  const o = {};
  for (const [k, v] of new FormData(form)) {
    if (k === 'form-name' || k === '_subject') continue;
    o[k] = o[k] ? o[k] + ', ' + v : v;
  }
  return o;
};

window.sendToFormspree = function (formName, data) {
  if (!window.SF_FORMSPREE_ID || (data && data['bot-field'])) return Promise.resolve();
  const body = Object.assign({}, data, {
    form: formName,
    _subject: 'Sprayberry Fitness: ' + formName + (data.name ? ' from ' + data.name : '')
  });
  delete body['bot-field'];
  if (data.email) body._replyto = data.email;
  return fetch('https://formspree.io/f/' + window.SF_FORMSPREE_ID, {
    method: 'POST', keepalive: true,
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).catch(function () {});
};

// ---- Lead log: copies each lead into the "Sprayberry Fitness — Leads" Google Sheet with where it came from.
// Paste the Apps Script web app URL below to turn it on.
window.SF_LEADLOG_URL = "";

// Remember how the visitor arrived (ad tags or the site that linked here) for the rest of their visit.
(function () {
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('utm_source') || q.get('fbclid')) {
      sessionStorage.setItem('sf_utm', JSON.stringify({
        s: (q.get('utm_source') || (q.get('fbclid') ? 'fb' : '')).toLowerCase(),
        m: (q.get('utm_medium') || '').toLowerCase(),
        c: q.get('utm_campaign') || ''
      }));
    }
    var ref = document.referrer || '';
    if (ref && ref.indexOf(location.hostname) === -1 && !sessionStorage.getItem('sf_ref')) {
      sessionStorage.setItem('sf_ref', ref);
    }
  } catch (e) {}
})();

window.sfLeadSource = function (data) {
  var chosen = {
    'Instagram': 'Instagram', 'TikTok': 'TikTok', 'Instagram/Facebook ad': 'Instagram/Facebook ad',
    'Rack card (in a local business)': 'Rack card', 'A friend or client referred me': 'Referral / people I know',
    'Google search': 'Google search', 'Other': 'Other'
  };
  if (data && data.source && chosen[data.source]) return { source: chosen[data.source], campaign: data.campaign || '' };
  var utm = {}, ref = '';
  try { utm = JSON.parse(sessionStorage.getItem('sf_utm') || '{}'); ref = sessionStorage.getItem('sf_ref') || ''; } catch (e) {}
  var s = utm.s || '', m = utm.m || '';
  var campaign = [utm.s, utm.m, utm.c].filter(Boolean).join(' / ');
  if (/^(meta|ig|fb|facebook|instagram)$/.test(s) && /paid|cpc|ad/.test(m)) return { source: 'Instagram/Facebook ad', campaign: campaign };
  if (s === 'rackcard') return { source: 'Rack card', campaign: campaign };
  if (/instagram\./.test(ref) || s === 'ig' || s === 'instagram') return { source: 'Instagram', campaign: campaign };
  if (/tiktok\./.test(ref) || s === 'tiktok') return { source: 'TikTok', campaign: campaign };
  if (/google\./.test(ref)) return { source: 'Google search', campaign: campaign };
  if (/facebook\.|fb\.com/.test(ref) || s === 'fb') return { source: 'Other', campaign: campaign || 'Facebook' };
  return { source: 'Unknown', campaign: campaign };
};

window.sendToLeadLog = function (formName, data) {
  if (!window.SF_LEADLOG_URL || !data || data['bot-field'] || !data.email) return Promise.resolve();
  var src = window.sfLeadSource(data);
  var notes = [data.goal, data.daily_calories ? data.daily_calories + ' cal' : '', data.plan_details, data.goals, data.message]
    .filter(Boolean).join('. ');
  return fetch(window.SF_LEADLOG_URL, {
    method: 'POST', mode: 'no-cors', keepalive: true,
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ name: data.name || '', email: data.email, phone: data.phone || '',
      form: formName, source: src.source, campaign: src.campaign, notes: notes })
  }).catch(function () {});
};

// Every form that copies to Formspree also goes to the lead log.
(function () {
  var send = window.sendToFormspree;
  window.sendToFormspree = function (formName, data) {
    if (formName !== 'New client onboarding') window.sendToLeadLog(formName, data);
    return send(formName, data);
  };
})();

// Sends a copy of every website form to Formspree (emails + Formspree dashboard).
// Netlify Forms keeps its own copy as a backup, so nothing is lost if one service has a problem.
// To connect: paste the Formspree form ID (the part after formspree.io/f/) below.
window.SF_FORMSPREE_ID = "";

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

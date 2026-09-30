const { getStore } = require('@netlify/blobs');

function store() {
  const opts = { name: 'sprayberry-data', consistency: 'strong' };
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    opts.siteID = process.env.BLOBS_SITE_ID;
    opts.token = process.env.BLOBS_TOKEN;
  }
  return getStore(opts);
}

async function loadClients() {
  const s = store();
  const data = await s.get('clients', { type: 'json' });
  return data || [];
}

async function saveClients(clients) {
  await store().setJSON('clients', clients);
}

async function loadWorkouts(clientId) {
  const data = await store().get('workouts:' + clientId, { type: 'json' });
  return data || [];
}

async function saveWorkouts(clientId, entries) {
  await store().setJSON('workouts:' + clientId, entries);
}

async function loadStats(clientId) {
  const data = await store().get('stats:' + clientId, { type: 'json' });
  return data || [];
}

async function saveStats(clientId, entries) {
  await store().setJSON('stats:' + clientId, entries);
}

async function deleteClientData(clientId) {
  const s = store();
  await s.delete('workouts:' + clientId);
  await s.delete('stats:' + clientId);
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 24) || 'client';
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 6);
}

function genPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function checkPassword(provided) {
  const expected = process.env.COACH_PASSWORD;
  return !!expected && typeof provided === 'string' && provided === expected;
}

module.exports = {
  loadClients, saveClients,
  loadWorkouts, saveWorkouts,
  loadStats, saveStats,
  deleteClientData,
  slugify, randomSuffix, genPin, genId,
  checkPassword,
};

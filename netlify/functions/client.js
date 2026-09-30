const {
  loadClients,
  loadWorkouts, saveWorkouts,
  loadStats, saveStats,
  genId,
} = require('./_lib/store');

async function findClient(clientId, pin) {
  const clients = await loadClients();
  const client = clients.find((c) => c.clientId === clientId);
  if (!client) return null;
  if (String(client.pin) !== String(pin)) return null;
  return client;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { action, clientId, pin } = payload;
  if (!clientId || !pin) return bad('Missing clientId or pin', 400);

  try {
    const client = await findClient(clientId, pin);
    if (!client) return bad('Invalid link or PIN', 401);

    if (action === 'verify') {
      return ok({ ok: true, name: client.name });
    }

    if (action === 'getData') {
      const workouts = await loadWorkouts(clientId);
      const stats = await loadStats(clientId);
      return ok({ name: client.name, workouts, stats });
    }

    if (action === 'addWorkout') {
      const entries = await loadWorkouts(clientId);
      const entry = Object.assign({}, payload.entry, { id: genId() });
      entries.push(entry);
      await saveWorkouts(clientId, entries);
      return ok({ workouts: entries });
    }

    if (action === 'deleteWorkout') {
      const entries = (await loadWorkouts(clientId)).filter((e) => e.id !== payload.entryId);
      await saveWorkouts(clientId, entries);
      return ok({ workouts: entries });
    }

    if (action === 'addStat') {
      const entries = await loadStats(clientId);
      const entry = Object.assign({}, payload.entry, { id: genId() });
      entries.push(entry);
      await saveStats(clientId, entries);
      return ok({ stats: entries });
    }

    if (action === 'deleteStat') {
      const entries = (await loadStats(clientId)).filter((e) => e.id !== payload.entryId);
      await saveStats(clientId, entries);
      return ok({ stats: entries });
    }

    return bad('Unknown action');
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error', detail: String(err) }) };
  }
};

function ok(data) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}
function bad(message, code) {
  return { statusCode: code || 400, body: JSON.stringify({ error: message }) };
}

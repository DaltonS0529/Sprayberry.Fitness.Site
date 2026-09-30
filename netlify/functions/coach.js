const {
  loadClients, saveClients,
  loadWorkouts, loadStats,
  deleteClientData,
  slugify, randomSuffix, genPin, genId,
  checkPassword,
} = require('./_lib/store');

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

  const { action, password } = payload;

  if (!checkPassword(password)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Incorrect password' }) };
  }

  try {
    if (action === 'login') {
      return ok({ ok: true });
    }

    if (action === 'listClients') {
      const clients = await loadClients();
      const summary = clients.map((c) => ({ clientId: c.clientId, name: c.name, createdAt: c.createdAt }));
      return ok({ clients: summary });
    }

    if (action === 'addClient') {
      const name = (payload.name || '').trim();
      if (!name) return bad('Name is required');
      const clients = await loadClients();
      const clientId = slugify(name) + '-' + randomSuffix();
      const pin = genPin();
      clients.push({ clientId, name, pin, createdAt: new Date().toISOString() });
      await saveClients(clients);
      return ok({ clientId, pin, name });
    }

    if (action === 'getClientData') {
      const clientId = payload.clientId;
      if (!clientId) return bad('Missing clientId');
      const clients = await loadClients();
      const client = clients.find((c) => c.clientId === clientId);
      if (!client) return bad('Client not found', 404);
      const workouts = await loadWorkouts(clientId);
      const stats = await loadStats(clientId);
      return ok({ name: client.name, pin: client.pin, workouts, stats });
    }

    if (action === 'deleteClient') {
      const clientId = payload.clientId;
      if (!clientId) return bad('Missing clientId');
      const clients = await loadClients();
      const filtered = clients.filter((c) => c.clientId !== clientId);
      await saveClients(filtered);
      await deleteClientData(clientId);
      return ok({ deleted: clientId });
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

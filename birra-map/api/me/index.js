const S = require('../shared/store');
const L = require('../shared/logic');

module.exports = async function (context, req) {
  try {
    const p = S.principal(req);
    if (!p) return S.err(context, 401, 'No autenticado');

    if (req.method === 'POST') {
      const b = req.body || {};
      const patch = {};
      if (b.nick !== undefined || b.groupId !== undefined) {
        if (!b.nick || !b.groupId) return S.err(context, 400, 'Faltan nick o groupId');
        const g = String(b.groupId).toLowerCase().trim();
        if (!/^[a-z0-9_-]{3,24}$/.test(g)) return S.err(context, 400, 'Grupo: 3-24 caracteres (letras, números, - o _)');
        patch.nick = String(b.nick).slice(0, 20).trim();
        patch.groupId = g;
      }
      /* precio por defecto que pone el usuario, se puede cambiar en cada fichaje */
      if (b.defaultPrice !== undefined) patch.defaultPriceCents = L.toCents(b.defaultPrice);
      if (b.currency !== undefined) patch.currency = String(b.currency).slice(0, 3).toUpperCase() || 'EUR';
      patch.updatedAt = new Date().toISOString();
      await S.saveMember(p.userId, patch);
    }

    const m = (await S.getMember(p.userId)) || {};
    S.ok(context, {
      userId: p.userId, nick: m.nick || null, groupId: m.groupId || null, provider: p.provider,
      hiddenUntil: m.hiddenUntil || 0, homeAt: m.homeAt || 0,
      defaultPriceCents: m.defaultPriceCents || 0, currency: m.currency || 'EUR'
    });
  } catch (e) { S.err(context, 500, e.message); }
};

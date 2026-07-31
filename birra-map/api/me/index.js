const S = require('../shared/store');
module.exports = async function (context, req) {
  try {
    const p = S.principal(req);
    if (!p) return S.err(context, 401, 'No autenticado');
    if (req.method === 'POST') {
      const { nick, groupId } = req.body || {};
      if (!nick || !groupId) return S.err(context, 400, 'Faltan nick o groupId');
      const g = String(groupId).toLowerCase().trim();
      if (!/^[a-z0-9_-]{3,24}$/.test(g)) return S.err(context, 400, 'Grupo: 3-24 caracteres (letras, números, - o _)');
      await S.saveMember(p.userId, { nick:String(nick).slice(0,20).trim(), groupId:g, updatedAt:new Date().toISOString() });
    }
    const m = (await S.getMember(p.userId)) || {};
    S.ok(context, { userId:p.userId, nick:m.nick||null, groupId:m.groupId||null,
      provider:p.provider, hiddenUntil:m.hiddenUntil||0, homeAt:m.homeAt||0 });
  } catch (e) {
    if (e.birramapConfig) return S.err(context, 503, e.message, { diagnostico:'/ayuda.html' });
    S.err(context, 500, `Error al acceder al almacenamiento: ${e.message}`);
  }
};

/* Génesis · reportar, bloquear y eliminar cuenta
   Se carga DESPUÉS del script principal de index.html.
   Para quitarlo: borrá la línea <script src="moderacion.js"></script> de index.html. */
(function () {
  'use strict';

  var REASONS = [
    'Spam o publicidad engañosa',
    'Acoso, odio o amenazas',
    'Contenido sexual o violento',
    'Información falsa',
    'Otro motivo'
  ];
  var blockedSet = new Set();

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function modal(html) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;';
    var box = document.createElement('div');
    box.style.cssText = 'background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:20px;max-width:360px;width:100%;max-height:90vh;overflow:auto;color:var(--paper);';
    box.innerHTML = html;
    ov.appendChild(box);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    return { box: box, close: function () { ov.remove(); } };
  }

  // ---------- bloqueados ----------
  async function loadBlocks() {
    try {
      var rows = await dbSelect('blocks', '?blocker_id=eq.' + currentUser.authId + '&select=blocked_id');
      blockedSet = new Set((rows || []).map(function (r) { return r.blocked_id; }));
    } catch (e) {
      blockedSet = new Set();
    }
  }

  async function doBlock(userId) {
    try {
      await dbInsert('blocks', { blocker_id: currentUser.authId, blocked_id: userId });
    } catch (e) {
      if (!/duplicate|unique|already/i.test(String(e.message))) {
        showToast('No se pudo bloquear');
        return;
      }
    }
    blockedSet.add(userId);
    renderFeed();
    renderPeople();
    renderConversations();
    showToast('Usuario bloqueado');
  }

  function confirmBlock(p) {
    var m = modal(
      '<h3 class="serif" style="margin:0 0 10px;font-size:1.1rem;">¿Bloquear a ' + esc(p.authorName) + '?</h3>' +
      '<p style="margin:0 0 16px;font-size:0.88rem;color:var(--paper-dim);line-height:1.5;">No vas a ver más sus publicaciones y no va a aparecer en tus listas. Podés desbloquearlo desde Mi perfil.</p>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
      '<button class="follow-btn" data-a="no">Cancelar</button>' +
      '<button class="post-btn" data-a="yes">Bloquear</button></div>'
    );
    m.box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      m.close();
      if (b.getAttribute('data-a') === 'yes') doBlock(p.authorId);
    });
  }

  async function showBlocked() {
    var ids = Array.from(blockedSet);
    if (!ids.length) { showToast('No bloqueaste a nadie'); return; }
    var rows = [];
    try {
      rows = await dbSelect('profiles', '?auth_id=in.(' + ids.join(',') + ')&select=auth_id,name,username') || [];
    } catch (e) {}
    function nameOf(id) {
      var r = rows.find(function (x) { return x.auth_id === id; });
      return r ? r.name : 'Usuario';
    }
    var m = modal(
      '<h3 class="serif" style="margin:0 0 12px;font-size:1.1rem;">Usuarios bloqueados</h3>' +
      ids.map(function (id) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);">' +
          '<span style="font-size:0.9rem;">' + esc(nameOf(id)) + '</span>' +
          '<button class="follow-btn" data-unblock="' + esc(id) + '">Desbloquear</button></div>';
      }).join('') +
      '<div style="text-align:right;margin-top:14px;"><button class="follow-btn" data-close="1">Cerrar</button></div>'
    );
    m.box.addEventListener('click', async function (e) {
      if (e.target.closest('[data-close]')) { m.close(); return; }
      var b = e.target.closest('[data-unblock]');
      if (!b) return;
      var id = b.getAttribute('data-unblock');
      b.disabled = true;
      try {
        await dbDelete('blocks', '?blocker_id=eq.' + currentUser.authId + '&blocked_id=eq.' + id);
        blockedSet.delete(id);
        b.closest('div').remove();
        renderFeed();
        renderPeople();
        renderConversations();
        showToast('Usuario desbloqueado');
      } catch (err) {
        b.disabled = false;
        showToast('No se pudo desbloquear');
      }
    });
  }

  // ---------- reportes ----------
  function openReport(p) {
    var opts = REASONS.map(function (r, i) {
      return '<label style="display:flex;align-items:center;gap:10px;margin:8px 0;font-size:0.9rem;color:var(--paper);cursor:pointer;">' +
        '<input type="radio" name="gmod-reason" value="' + esc(r) + '"' + (i === 0 ? ' checked' : '') + ' style="width:auto;"> ' + esc(r) + '</label>';
    }).join('');
    var m = modal(
      '<h3 class="serif" style="margin:0 0 10px;font-size:1.1rem;">Reportar publicación</h3>' +
      '<p style="margin:0 0 6px;font-size:0.85rem;color:var(--paper-dim);">¿Cuál es el problema?</p>' + opts +
      '<textarea id="gmod-details" placeholder="Detalles (opcional)" style="min-height:60px;margin-top:8px;"></textarea>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;">' +
      '<button class="follow-btn" data-a="no">Cancelar</button>' +
      '<button class="post-btn" data-a="send">Enviar reporte</button></div>'
    );
    m.box.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.getAttribute('data-a') === 'no') { m.close(); return; }
      var checked = m.box.querySelector('input[name="gmod-reason"]:checked');
      var reason = checked ? checked.value : 'Otro motivo';
      var details = m.box.querySelector('#gmod-details').value.trim().slice(0, 500);
      b.disabled = true;
      try {
        await dbInsert('reports', {
          reporter_id: currentUser.authId,
          post_id: p.id,
          reported_user_id: p.authorId,
          reason: reason,
          details: details || null
        });
        m.close();
        showToast('Gracias, recibimos tu reporte');
      } catch (err) {
        b.disabled = false;
        showToast('No se pudo enviar el reporte');
      }
    });
  }

  function openMenu(p) {
    var m = modal(
      '<h3 class="serif" style="margin:0 0 14px;font-size:1.1rem;">' + esc(p.authorName) + '</h3>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
      '<button class="follow-btn" data-a="report">⚑ Reportar esta publicación</button>' +
      '<button class="follow-btn" data-a="block" style="color:var(--danger);border-color:var(--danger);">🚫 Bloquear a ' + esc(p.authorName) + '</button>' +
      '<button class="follow-btn" data-a="cancel">Cancelar</button></div>'
    );
    m.box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      var a = b.getAttribute('data-a');
      m.close();
      if (a === 'report') openReport(p);
      if (a === 'block') confirmBlock(p);
    });
  }

  function decoratePosts() {
    document.querySelectorAll('#feed .post').forEach(function (el) {
      var actions = el.querySelector('.post-actions');
      if (!actions || actions.querySelector('.gmod-more')) return;
      var p = posts.find(function (x) { return String(x.id) === el.getAttribute('data-id'); });
      if (!p || p.mine) return;
      var btn = document.createElement('button');
      btn.className = 'gmod-more';
      btn.setAttribute('aria-label', 'Reportar o bloquear');
      btn.style.marginLeft = 'auto';
      btn.textContent = '⋯ Más';
      btn.addEventListener('click', function () { openMenu(p); });
      actions.appendChild(btn);
    });
  }

  // ---------- eliminar cuenta ----------
  async function removeMyFiles() {
    var uid = currentUser.authId;
    var paths = new Set();
    try {
      var res = await fetch(SUPABASE_URL + '/storage/v1/object/list/post-images', {
        method: 'POST',
        headers: restHeaders(),
        body: JSON.stringify({ prefix: uid, limit: 1000, offset: 0 })
      });
      if (res.ok) {
        (await res.json()).forEach(function (o) {
          if (o && o.name && o.id) paths.add(uid + '/' + o.name);
        });
      }
    } catch (e) {}
    var base = SUPABASE_URL + '/storage/v1/object/public/post-images/';
    var urls = posts.filter(function (p) { return p.mine && p.img; }).map(function (p) { return p.img; });
    if (typeof avatarMap !== 'undefined' && avatarMap[uid]) urls.push(avatarMap[uid]);
    urls.forEach(function (u) {
      if (typeof u === 'string' && u.indexOf(base) === 0) {
        paths.add(decodeURIComponent(u.slice(base.length).split('?')[0]));
      }
    });
    var all = Array.from(paths);
    for (var i = 0; i < all.length; i += 100) {
      try {
        await fetch(SUPABASE_URL + '/storage/v1/object/post-images', {
          method: 'DELETE',
          headers: restHeaders(),
          body: JSON.stringify({ prefixes: all.slice(i, i + 100) })
        });
      } catch (e) {}
    }
  }

  function openDeleteAccount() {
    var m = modal(
      '<h3 class="serif" style="margin:0 0 10px;font-size:1.1rem;color:var(--danger);">Eliminar mi cuenta</h3>' +
      '<p style="margin:0 0 12px;font-size:0.88rem;color:var(--paper-dim);line-height:1.5;">Se borran para siempre tu perfil, tus publicaciones y fotos, comentarios, mensajes, seguidores y comunidades que creaste. No se puede deshacer.</p>' +
      '<label style="margin-top:0;">Escribí ELIMINAR para confirmar</label>' +
      '<input type="text" id="gmod-confirm" autocomplete="off">' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">' +
      '<button class="follow-btn" data-a="no">Cancelar</button>' +
      '<button class="post-btn" data-a="del" style="background:var(--danger);color:#fff;">Eliminar</button></div>'
    );
    m.box.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.getAttribute('data-a') === 'no') { m.close(); return; }
      var typed = m.box.querySelector('#gmod-confirm').value.trim().toUpperCase();
      if (typed !== 'ELIMINAR') { showToast('Escribí ELIMINAR para confirmar'); return; }
      b.disabled = true;
      b.textContent = 'Eliminando...';
      try {
        await removeMyFiles();
        var res = await fetch(SUPABASE_URL + '/rest/v1/rpc/delete_my_account', {
          method: 'POST',
          headers: restHeaders(),
          body: '{}'
        });
        if (!res.ok) {
          var err = {};
          try { err = await res.json(); } catch (x) {}
          throw new Error(err.message || 'Error del servidor');
        }
        alert('Tu cuenta fue eliminada.');
        location.reload();
      } catch (err2) {
        b.disabled = false;
        b.textContent = 'Eliminar';
        alert('No se pudo eliminar la cuenta: ' + err2.message);
      }
    });
  }

  function addAccountSection() {
    if (document.getElementById('gmod-account')) return;
    var view = document.getElementById('view-perfil');
    if (!view) return;
    var box = document.createElement('div');
    box.id = 'gmod-account';
    box.style.cssText = 'margin-top:28px;padding-top:16px;border-top:1px solid var(--line);';
    box.innerHTML =
      '<p class="section-title">Privacidad y cuenta</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
      '<button class="follow-btn" id="gmod-blocked-btn">🚫 Usuarios bloqueados</button>' +
      '<button class="follow-btn" id="gmod-delete-btn" style="color:var(--danger);border-color:var(--danger);">Eliminar mi cuenta</button></div>';
    var myPosts = document.getElementById('myPosts');
    var anchor = myPosts ? myPosts.previousElementSibling : null;
    if (anchor && anchor.parentNode === view) view.insertBefore(box, anchor);
    else view.appendChild(box);
    document.getElementById('gmod-blocked-btn').addEventListener('click', showBlocked);
    document.getElementById('gmod-delete-btn').addEventListener('click', openDeleteAccount);
  }

  // ---------- conexión con la app existente (sin modificarla) ----------
  try {
    var origFeed = renderFeed;
    renderFeed = function () {
      var all = posts;
      posts = all.filter(function (p) { return !blockedSet.has(p.authorId); });
      try { origFeed(); } finally { posts = all; }
      decoratePosts();
    };

    function hideBlockedPeople(fn) {
      return function () {
        var all = people;
        people = all.filter(function (p) { return !blockedSet.has(p.id); });
        try { fn(); } finally { people = all; }
      };
    }
    renderPeople = hideBlockedPeople(renderPeople);
    renderConversations = hideBlockedPeople(renderConversations);

    var origStart = startApp;
    startApp = async function () {
      await loadBlocks();
      await origStart();
      addAccountSection();
    };
  } catch (e) {
    console.error('moderacion.js no pudo enlazarse con la app:', e);
  }
})();

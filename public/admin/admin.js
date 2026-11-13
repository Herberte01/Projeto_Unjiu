/* Painel UMJIU. Todo texto vindo do servidor passa por esc() antes de entrar no HTML. */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('#main');
const pad = n => String(n).padStart(2, '0');
const brDate = iso => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const today = () => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ytThumb = id => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;

// ---------- comunicação com o servidor ----------
async function api(method, url, body) {
  const opts = { method, headers: { 'X-Requested-With': 'umjiu-admin' } };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch('/api/admin' + url, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/login') { showLogin(); throw new Error('Sua sessão expirou. Entre de novo.'); }
  if (!res.ok) throw new Error(data.error || 'Não foi possível concluir. Tente de novo.');
  return data;
}
function toast(msg, bad) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), bad ? 5000 : 2800);
}
function confirmBox(msg, yes = 'Excluir') {
  const dlg = $('#confirm');
  $('#confirm-msg').textContent = msg;
  $('#confirm-yes').textContent = yes;
  dlg.showModal();
  return new Promise(resolve => {
    const done = v => { dlg.close(); $('#confirm-yes').onclick = $('#confirm-no').onclick = dlg.oncancel = null; resolve(v); };
    $('#confirm-yes').onclick = () => done(true);
    $('#confirm-no').onclick = () => done(false);
    dlg.oncancel = () => done(false);
  });
}

// Reduz a foto no próprio navegador antes de enviar: o envio fica rápido mesmo no celular.
async function shrink(file, maxSide, quality) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error(`Não consegui abrir "${file.name}". Use JPG, PNG ou WebP.`); }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
  return { blob, w, h };
}

// ---------- login ----------
function showLogin() { $('#shell').hidden = true; $('#login').hidden = false; $('#login-form input').focus(); }
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target), err = $('#login-err');
  err.hidden = true;
  try {
    await api('POST', '/login', { email: fd.get('email'), password: fd.get('password') });
    e.target.reset();
    $('#login').hidden = true; $('#shell').hidden = false;
    route();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});
$('#logout').addEventListener('click', async () => { await api('POST', '/logout').catch(() => {}); showLogin(); });

// ---------- navegação ----------
const I = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const NAV = [
  ['painel', 'Painel', I('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>')],
  ['eventos', 'Eventos', I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>')],
  ['inscricoes', 'Inscrições', I('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.600 3.200-5.500 6.500-5.500s5.900 1.900 6.500 5.500M17 8h5M19.500 5.500v5"/>')],
  ['fotos', 'Fotos', I('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>')],
  ['videos', 'Vídeos', I('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9v6l5-3z"/>')],
  ['mural', 'Mural', I('<path d="M4 5h16v11H9l-5 4z"/>')],
  ['config', 'Configurações', I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.900 4.900l2.100 2.100M17 17l2.100 2.100M4.900 19.100L7 17M17 7l2.100-2.100"/>')]
];
$('#side-nav').innerHTML = NAV.map(([id, label, icon]) => `<a href="#${id}" data-nav="${id}">${icon}${label}</a>`).join('');

const VIEWS = {};
async function route() {
  const [name = 'painel', arg] = (location.hash.slice(1) || 'painel').split('/');
  const view = VIEWS[name] || VIEWS.painel;
  $$('#side-nav a').forEach(a => (a.dataset.nav === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  try { await view(arg); } catch (e) { toast(e.message, true); }
}
addEventListener('hashchange', route);
const show = html => { main.innerHTML = `<div class="view">${html}</div>`; };
const head = (title, sub, actions = '') => `<div class="head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="row-act">${actions}</div></div>`;

// =====================================================================
// Gaveta de formulário (usada por eventos, vídeos, álbuns e mural)
// =====================================================================
let drawerSave = null;
function fieldHtml(f, v) {
  const val = v ?? f.default ?? '';
  const cls = `f ${f.full === false ? '' : 'full'}`;
  const hint = f.hint ? `<small>${f.hint}</small>` : '';
  const req = f.required ? 'required' : '';
  if (f.type === 'switch') return `<label class="switch full"><input type="checkbox" name="${f.key}" ${val ? 'checked' : ''}><span>${f.label}${hint}</span></label>`;
  if (f.type === 'textarea') return `<label class="${cls}">${f.label}<textarea name="${f.key}" ${req} rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>${hint}</label>`;
  if (f.type === 'money') return `<label class="${cls}">${f.label}<input name="${f.key}" inputmode="decimal" placeholder="0,00" value="${val ? (val / 100).toFixed(2).replace('.', ',') : ''}">${hint}</label>`;
  if (f.type === 'image') return `<div class="f full">${f.label}
    <label class="img-field" data-img>${val ? `<img src="/uploads/${esc(val)}" alt="">` : ''}<span>Clique ou arraste uma imagem aqui</span>
      <input type="file" accept="image/jpeg,image/png,image/webp"><input type="hidden" name="${f.key}" value="${esc(val)}"></label>
    <button type="button" class="b b-sm b-text red" data-act="img-clear" style="align-self:flex-start" ${val ? '' : 'hidden'}>Remover imagem</button>${hint}</div>`;
  if (f.type === 'youtube') return `<label class="f full">${f.label}<input name="${f.key}" data-yt value="${val ? 'https://youtu.be/' + esc(val) : ''}" placeholder="Cole aqui o link do vídeo no YouTube">${hint}</label>
    <div class="yt-prev full" id="yt-prev">${val ? `<img src="${ytThumb(val)}" alt="">` : 'A capa do vídeo aparece aqui'}</div>`;
  return `<label class="${cls}">${f.label}<input type="${f.type || 'text'}" name="${f.key}" value="${esc(val)}" ${req} ${f.attrs || ''} placeholder="${esc(f.placeholder || '')}">${hint}</label>`;
}
function openForm({ title, fields, values = {}, save }) {
  $('#drawer-title').textContent = title;
  $('#drawer-body').innerHTML = `<div class="form-grid">${fields.map(f => fieldHtml(f, values[f.key])).join('')}</div>`;
  $('#drawer-err').hidden = true;
  $('#drawer-bg').hidden = false;
  drawerSave = async () => {
    const form = $('#drawer'), data = {};
    for (const f of fields) {
      const el = form.elements[f.key];
      if (f.type === 'switch') data[f.key] = el.checked;
      else if (f.type === 'money') data[f.key] = Math.round((parseFloat(el.value.replace(/\./g, '').replace(',', '.')) || 0) * 100);
      else if (f.type === 'number') data[f.key] = Number(el.value) || 0;
      else data[f.key] = el.value.trim();
      if (f.required && !data[f.key]) throw new Error(`Preencha "${f.label.replace(/<[^>]+>/g, '')}".`);
    }
    await save(data);
  };
  $('#drawer-body').querySelector('input:not([type=hidden]):not([type=file]), textarea')?.focus();
}
function closeDrawer() { $('#drawer-bg').hidden = true; drawerSave = null; }
$('#drawer').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#drawer-save'), err = $('#drawer-err');
  btn.disabled = true; err.hidden = true;
  try { await drawerSave(); closeDrawer(); toast('Salvo.'); route(); }
  catch (ex) { err.textContent = ex.message; err.hidden = false; }
  btn.disabled = false;
});
$('#drawer-bg').addEventListener('mousedown', e => { if (e.target.id === 'drawer-bg') closeDrawer(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#drawer-bg').hidden) closeDrawer(); });

async function setCover(label, file) {
  if (!file) return;
  const span = $('span', label);
  span.textContent = 'Enviando…';
  try {
    const { blob } = await shrink(file, 1800, 0.86);
    const fd = new FormData();
    fd.append('file', blob, 'capa.jpg');
    const r = await api('POST', '/upload', fd);
    $('input[type=hidden]', label).value = r.file;
    $('img', label)?.remove();
    label.insertAdjacentHTML('afterbegin', `<img src="/uploads/${esc(r.file)}" alt="">`);
    label.parentElement.querySelector('[data-act="img-clear"]').hidden = false;
  } catch (ex) { toast(ex.message, true); }
  span.textContent = 'Clique ou arraste uma imagem aqui';
}
$('#drawer').addEventListener('change', async e => {
  if (e.target.type === 'file') { await setCover(e.target.closest('[data-img]'), e.target.files[0]); e.target.value = ''; }
  if (e.target.matches('[data-yt]')) lookupYoutube(e.target);
});
$('#drawer').addEventListener('paste', e => { if (e.target.matches('[data-yt]')) setTimeout(() => lookupYoutube(e.target), 0); });
async function lookupYoutube(input) {
  const prev = $('#yt-prev');
  if (!input.value.trim()) { prev.textContent = 'A capa do vídeo aparece aqui'; return; }
  try {
    const r = await api('GET', '/youtube?url=' + encodeURIComponent(input.value.trim()));
    prev.innerHTML = `<img src="${ytThumb(r.id)}" alt="">`;
    const title = $('#drawer').elements.title;
    if (r.title && !title.value.trim()) title.value = r.title;
  } catch (ex) { prev.textContent = ex.message; }
}

// arrastar e soltar (capa do evento e fotos do álbum)
document.addEventListener('dragover', e => { const z = e.target.closest?.('[data-img], .drop'); if (z) { e.preventDefault(); z.classList.add('over'); } });
document.addEventListener('dragleave', e => e.target.closest?.('[data-img], .drop')?.classList.remove('over'));
document.addEventListener('drop', e => {
  const z = e.target.closest?.('[data-img], .drop');
  if (!z) return;
  e.preventDefault(); z.classList.remove('over');
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  if (z.matches('[data-img]')) setCover(z, files[0]);
  else uploadPhotos(files);
});

// =====================================================================
// Painel
// =====================================================================
VIEWS.painel = async () => {
  const s = await api('GET', '/stats');
  show(`
    ${head('Painel', 'O que você quer publicar hoje?')}
    <div class="quick">
      <button data-act="new-event"><i>+</i><b>Novo evento</b><span>Data, local, valor e inscrições</span></button>
      <button data-act="new-album"><i>+</i><b>Publicar fotos</b><span>Crie um álbum e arraste as fotos</span></button>
      <button data-act="new-video"><i>+</i><b>Adicionar vídeo</b><span>Basta colar o link do YouTube</span></button>
      <button data-act="new-post"><i>+</i><b>Novo aviso</b><span>Recado no mural da página inicial</span></button>
    </div>
    <div class="stats">
      <a class="stat" href="#eventos"><b>${s.events}</b><span>eventos publicados</span></a>
      <a class="stat" href="#inscricoes"><b>${s.registrations}</b><span>inscrições</span></a>
      <a class="stat" href="#inscricoes"><b>${s.pending}</b><span>pagamentos pendentes</span></a>
      <a class="stat" href="#fotos"><b>${s.photos}</b><span>fotos</span></a>
      <a class="stat" href="#videos"><b>${s.videos}</b><span>vídeos</span></a>
      <a class="stat" href="#mural"><b>${s.posts}</b><span>avisos</span></a>
    </div>
    <div class="card"><h2>Últimas inscrições</h2>
      ${s.latest.length ? `<div class="table-wrap" style="border:0"><table><tbody>${s.latest.map(r => `
        <tr><td><b>${esc(r.name)}</b><small>${esc(r.event)}</small></td><td><span class="chip ${r.status === 'pago' ? 'on' : r.status === 'pendente' ? 'gold' : 'red'}">${esc(r.status)}</span></td><td class="muted">${brDate(r.created_at)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">As inscrições feitas pelo site aparecem aqui.</p>'}
    </div>`);
};

// =====================================================================
// Eventos
// =====================================================================
const EVENT_FIELDS = [
  { key: 'title', label: 'Nome do evento', required: true, placeholder: 'Acampamento de Jovens 2027' },
  { key: 'starts_on', label: 'Começa em', type: 'date', required: true, full: false },
  { key: 'ends_on', label: 'Termina em', type: 'date', full: false, hint: 'Deixe vazio se for um dia só.' },
  { key: 'location', label: 'Local', placeholder: 'Nome do local e cidade' },
  { key: 'audience', label: 'Para quem é', placeholder: 'Jovens de 15 a 29 anos' },
  { key: 'description', label: 'Resumo', type: 'textarea', rows: 2, hint: 'Uma ou duas frases que aparecem no cartão do evento.' },
  { key: 'details', label: 'Informações completas', type: 'textarea', rows: 6, hint: 'Programação, o que levar, o que está incluso…' },
  { key: 'cover', label: 'Foto de capa', type: 'image' },
  { key: 'price_cents', label: 'Valor da inscrição (R$)', type: 'money', full: false, hint: 'Deixe vazio para evento gratuito.' },
  { key: 'max_installments', label: 'Parcelas no Pix (máx.)', type: 'number', attrs: 'min="1" max="12"', default: 1, full: false },
  { key: 'capacity', label: 'Número de vagas', type: 'number', attrs: 'min="0"', hint: 'Deixe 0 para não limitar.', full: false },
  { key: 'registration_open', label: 'Inscrições abertas', type: 'switch', default: true },
  { key: 'featured', label: 'Destacar na página inicial', type: 'switch' },
  { key: 'published', label: 'Publicado no site', type: 'switch', default: true, hint: 'Desligue para guardar como rascunho.' }
];
let events = [];
const eventForm = ev => openForm({
  title: ev ? 'Editar evento' : 'Novo evento', fields: EVENT_FIELDS, values: ev || {},
  save: data => (ev ? api('PUT', `/events/${ev.id}`, data) : api('POST', '/events', data))
});
VIEWS.eventos = async () => {
  events = await api('GET', '/events');
  const now = today();
  show(`
    ${head('Eventos', 'Crie eventos e acompanhe as inscrições.', '<button class="b b-gold" data-act="new-event">+ Novo evento</button>')}
    ${events.length ? `<div class="rows">${events.map(e => `
      <div class="row">
        <div class="thumb">${e.cover ? `<img src="/uploads/${esc(e.cover)}" alt="">` : brDate(e.starts_on).slice(0, 5)}</div>
        <div class="row-main"><b>${esc(e.title)}</b>
          <small>${brDate(e.starts_on)}${e.ends_on ? ' a ' + brDate(e.ends_on) : ''}${e.location ? ' · ' + esc(e.location) : ''} · ${e.price_cents ? money(e.price_cents) : 'Gratuito'}</small>
          <div class="chips">
            <span class="chip ${e.published ? 'on' : ''}">${e.published ? 'Publicado' : 'Rascunho'}</span>
            ${(e.ends_on || e.starts_on) < now ? '<span class="chip">Realizado</span>' : `<span class="chip ${e.registration_open ? 'on' : 'red'}">${e.registration_open ? 'Inscrições abertas' : 'Inscrições encerradas'}</span>`}
            ${e.featured ? '<span class="chip gold">Destaque</span>' : ''}
            <span class="chip">${e.registrations}${e.capacity ? ' de ' + e.capacity : ''} inscritos</span>
          </div></div>
        <div class="row-act">
          <a class="b b-sm" href="#inscricoes/${e.id}">Inscrições</a>
          <button class="b b-sm" data-act="edit-event" data-id="${e.id}">Editar</button>
          <button class="b b-sm b-text red" data-act="del" data-res="events" data-id="${e.id}" data-name="${esc(e.title)}">Excluir</button>
        </div>
      </div>`).join('')}</div>`
    : '<div class="empty"><p>Nenhum evento ainda.</p><button class="b b-gold" data-act="new-event">Criar o primeiro evento</button></div>'}`);
};

// =====================================================================
// Inscrições
// =====================================================================
let regs = [], regFilter = { event: '', status: '', q: '' };
function regTable() {
  const q = regFilter.q.trim().toLowerCase();
  const list = q ? regs.filter(r => `${r.name} ${r.email} ${r.cpf} ${r.code} ${r.church} ${r.city}`.toLowerCase().includes(q)) : regs;
  const paid = list.filter(r => r.status === 'pago'), pend = list.filter(r => r.status === 'pendente');
  const sum = arr => money(arr.reduce((t, r) => t + r.price_cents, 0));
  $('#reg-sum').textContent = `${list.length} inscrições · ${paid.length} pagas (${sum(paid)}) · ${pend.length} pendentes (${sum(pend)})`;
  $('#reg-body').innerHTML = list.length ? list.map(r => {
    const wa = r.phone.replace(/\D/g, '');
    return `<tr>
      <td><b>${esc(r.name)}</b><small>${esc(r.code)} · CPF ${esc(r.cpf)}</small><small>${esc([r.church, r.city].filter(Boolean).join(' · '))}</small>${r.notes ? `<small>Obs.: ${esc(r.notes)}</small>` : ''}</td>
      <td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a><small><a href="https://wa.me/55${esc(wa)}" target="_blank" rel="noopener">${esc(r.phone)}</a></small>${r.shirt ? `<small>Camiseta ${esc(r.shirt)}</small>` : ''}</td>
      <td>${esc(r.event)}<small>${r.price_cents ? `${money(r.price_cents)} · ${r.installments}x no Pix` : 'Gratuito'}</small><small>${brDate(r.created_at)}</small></td>
      <td><select class="${esc(r.status)}" data-act="reg-status" data-id="${r.id}" aria-label="Situação de ${esc(r.name)}">${['pendente', 'pago', 'cancelada'].map(s => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td><button class="b b-sm b-text red" data-act="del" data-res="registrations" data-id="${r.id}" data-name="a inscrição de ${esc(r.name)}">Excluir</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" class="muted" style="text-align:center;padding:36px">Nenhuma inscrição encontrada.</td></tr>';
}
VIEWS.inscricoes = async arg => {
  if (arg !== undefined) regFilter.event = arg;
  const qs = new URLSearchParams();
  if (regFilter.event) qs.set('event', regFilter.event);
  if (regFilter.status) qs.set('status', regFilter.status);
  [events, regs] = await Promise.all([api('GET', '/events'), api('GET', '/registrations?' + qs)]);
  show(`
    ${head('Inscrições', 'Marque como pago quando identificar o Pix.', `<a class="b" href="/api/admin/registrations.csv?${esc(qs.toString())}">Baixar planilha (CSV)</a>`)}
    <div class="filters">
      <select id="reg-event" aria-label="Evento"><option value="">Todos os eventos</option>${events.map(e => `<option value="${e.id}" ${String(e.id) === String(regFilter.event) ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</select>
      <select id="reg-status" aria-label="Situação"><option value="">Todas as situações</option>${['pendente', 'pago', 'cancelada'].map(s => `<option ${regFilter.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <input id="reg-q" type="search" placeholder="Buscar por nome, CPF, e-mail, igreja…" value="${esc(regFilter.q)}" aria-label="Buscar">
    </div>
    <p class="muted" id="reg-sum"></p>
    <div class="table-wrap"><table><thead><tr><th>Participante</th><th>Contato</th><th>Evento</th><th>Situação</th><th></th></tr></thead><tbody id="reg-body"></tbody></table></div>`);
  regTable();
};

// =====================================================================
// Fotos
// =====================================================================
const ALBUM_FIELDS = [
  { key: 'title', label: 'Nome do álbum', required: true, placeholder: 'Acampamento de Jovens 2026' },
  { key: 'event_date', label: 'Data do evento', type: 'date', full: false },
  { key: 'description', label: 'Descrição (opcional)', type: 'textarea', rows: 2 },
  { key: 'published', label: 'Publicado no site', type: 'switch', default: true }
];
let albums = [], album = null;
const albumForm = a => openForm({
  title: a ? 'Editar álbum' : 'Novo álbum', fields: ALBUM_FIELDS, values: a || {},
  save: async data => {
    if (a) return api('PUT', `/albums/${a.id}`, data);
    const r = await api('POST', '/albums', data);
    location.hash = `fotos/${r.id}`;
  }
});
const photoTile = p => `
  <div class="photo" data-photo="${p.id}">
    <img src="/uploads/${esc(p.thumb)}" alt="" loading="lazy">
    ${album.cover_photo_id === p.id ? '<span class="star">Capa</span>' : ''}
    <div class="ov"><button data-act="photo-cover" data-id="${p.id}">Usar de capa</button><button class="del" data-act="photo-del" data-id="${p.id}" aria-label="Excluir foto">Excluir</button></div>
  </div>`;
VIEWS.fotos = async arg => {
  albums = await api('GET', '/albums');
  album = arg ? albums.find(a => String(a.id) === arg) : null;
  if (arg && !album) { location.hash = 'fotos'; return; }
  if (!album) {
    return show(`
      ${head('Fotos', 'Cada álbum reúne as fotos de um evento.', '<button class="b b-gold" data-act="new-album">+ Novo álbum</button>')}
      ${albums.length ? `<div class="albums">${albums.map(a => `
        <a class="album" href="#fotos/${a.id}">
          <div class="cover">${a.cover ? `<img src="/uploads/${esc(a.cover)}" alt="" loading="lazy">` : 'Sem fotos ainda'}</div>
          <div><b>${esc(a.title)}</b><small>${a.count} fotos${a.event_date ? ' · ' + brDate(a.event_date) : ''}</small>
            <span class="chip ${a.published ? 'on' : ''}" style="align-self:flex-start">${a.published ? 'Publicado' : 'Rascunho'}</span></div>
        </a>`).join('')}</div>`
      : '<div class="empty"><p>Nenhum álbum ainda. Crie um e arraste as fotos do evento.</p><button class="b b-gold" data-act="new-album">Criar o primeiro álbum</button></div>'}`);
  }
  const photos = await api('GET', `/albums/${album.id}/photos`);
  show(`
    <a class="crumb" href="#fotos">&larr; Todos os álbuns</a>
    ${head(esc(album.title), `${album.event_date ? brDate(album.event_date) + ' · ' : ''}<span id="photo-count">${photos.length}</span> fotos · ${album.published ? 'publicado no site' : 'rascunho'}`,
      `<button class="b b-sm" data-act="edit-album">Editar álbum</button><button class="b b-sm b-text red" data-act="del" data-res="albums" data-id="${album.id}" data-name="o álbum ${esc(album.title)} e todas as fotos">Excluir álbum</button>`)}
    <label class="drop" id="drop"><i>+</i><b>Arraste as fotos para cá</b><span>ou clique para escolher. Pode selecionar várias de uma vez (JPG, PNG ou WebP).</span>
      <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" multiple></label>
    <div id="up" hidden><p class="muted" id="up-text" style="margin-bottom:8px"></p><div class="progress"><i id="up-bar" style="width:0"></i></div></div>
    <div class="photos" id="photos">${photos.map(photoTile).join('')}</div>`);
};
let uploading = false;
async function uploadPhotos(files) {
  if (!album || !files.length) return;
  if (uploading) return toast('Aguarde o envio atual terminar.', true);
  uploading = true;
  const grid = $('#photos'), up = $('#up'), bar = $('#up-bar'), text = $('#up-text');
  up.hidden = false;
  let done = 0, failed = 0;
  const queue = files.map(file => {
    const ph = document.createElement('div');
    ph.className = 'photo busy';
    grid.prepend(ph);
    return { file, ph };
  });
  const update = () => { text.textContent = `Enviando ${Math.min(done + failed + 1, queue.length)} de ${queue.length}…`; bar.style.width = `${((done + failed) / queue.length) * 100}%`; };
  update();
  const worker = async () => {
    for (let job; (job = queue.shift());) {
      try {
        const full = await shrink(job.file, 2000, 0.86);
        const thumb = await shrink(job.file, 640, 0.8);
        const fd = new FormData();
        fd.append('file', full.blob, 'foto.jpg');
        fd.append('thumb', thumb.blob, 'mini.jpg');
        fd.append('width', full.w); fd.append('height', full.h);
        const p = await api('POST', `/albums/${album.id}/photos`, fd);
        job.ph.outerHTML = photoTile(p);
        done++;
      } catch (ex) { job.ph.remove(); failed++; toast(ex.message, true); }
      text.textContent = `Enviando… ${done + failed} concluídas`;
      bar.style.width = `${((done + failed) / (done + failed + queue.length)) * 100}%`;
    }
  };
  await Promise.all([worker(), worker()]);
  uploading = false;
  up.hidden = true;
  const count = $('#photo-count');
  if (count) count.textContent = $$('#photos [data-photo]').length;
  toast(failed ? `${done} fotos publicadas, ${failed} com erro.` : `${done} ${done === 1 ? 'foto publicada' : 'fotos publicadas'}.`, failed > 0);
}

// =====================================================================
// Vídeos
// =====================================================================
const VIDEO_FIELDS = [
  { key: 'youtube_id', label: 'Link do YouTube', type: 'youtube', hint: 'O título e a capa são preenchidos sozinhos.' },
  { key: 'title', label: 'Título', required: true },
  { key: 'preacher', label: 'Pregador(a)', full: false, placeholder: 'Pr. Nome' },
  { key: 'series', label: 'Série (opcional)', full: false },
  { key: 'preached_on', label: 'Data da mensagem', type: 'date', full: false, default: today() },
  { key: 'duration', label: 'Duração (opcional)', full: false, placeholder: '48:12' },
  { key: 'featured', label: 'Destaque no topo da página inicial', type: 'switch', hint: 'Sem destaque, o topo mostra a mensagem mais recente.' },
  { key: 'published', label: 'Publicado no site', type: 'switch', default: true }
];
let videos = [];
const videoForm = v => openForm({
  title: v ? 'Editar vídeo' : 'Adicionar vídeo', fields: VIDEO_FIELDS, values: v || {},
  save: data => (v ? api('PUT', `/videos/${v.id}`, data) : api('POST', '/videos', data))
});
VIEWS.videos = async () => {
  videos = await api('GET', '/videos');
  show(`
    ${head('Vídeos', 'Mensagens publicadas no YouTube.', '<button class="b b-gold" data-act="new-video">+ Adicionar vídeo</button>')}
    ${videos.length ? `<div class="rows">${videos.map(v => `
      <div class="row">
        <div class="thumb">${v.youtube_id ? `<img src="${ytThumb(v.youtube_id)}" alt="">` : 'Sem link'}</div>
        <div class="row-main"><b>${esc(v.title)}</b><small>${esc([v.preacher, v.series && 'Série ' + v.series, brDate(v.preached_on)].filter(Boolean).join(' · '))}</small>
          <div class="chips"><span class="chip ${v.published ? 'on' : ''}">${v.published ? 'Publicado' : 'Rascunho'}</span>${v.featured ? '<span class="chip gold">Destaque</span>' : ''}${v.youtube_id ? '' : '<span class="chip red">Falta o link do YouTube</span>'}</div></div>
        <div class="row-act">
          ${v.featured ? '' : `<button class="b b-sm" data-act="feature-video" data-id="${v.id}">Destacar</button>`}
          <button class="b b-sm" data-act="edit-video" data-id="${v.id}">Editar</button>
          <button class="b b-sm b-text red" data-act="del" data-res="videos" data-id="${v.id}" data-name="${esc(v.title)}">Excluir</button>
        </div>
      </div>`).join('')}</div>`
    : '<div class="empty"><p>Nenhum vídeo ainda.</p><button class="b b-gold" data-act="new-video">Adicionar o primeiro vídeo</button></div>'}`);
};

// =====================================================================
// Mural
// =====================================================================
const POST_FIELDS = [
  { key: 'title', label: 'Título', required: true },
  { key: 'body', label: 'Texto', type: 'textarea', rows: 6 },
  { key: 'tag', label: 'Tipo', full: false, default: 'Aviso', attrs: 'list="tags"', hint: 'Ex.: Aviso, Palavra da semana, Evento.' },
  { key: 'author', label: 'Assinatura', full: false, default: 'Diretoria UMJIU' },
  { key: 'published_on', label: 'Data', type: 'date', full: false, default: today() },
  { key: 'published', label: 'Publicado no site', type: 'switch', default: true }
];
let posts = [];
const postForm = p => openForm({
  title: p ? 'Editar aviso' : 'Novo aviso', fields: POST_FIELDS, values: p || {},
  save: data => (p ? api('PUT', `/posts/${p.id}`, data) : api('POST', '/posts', data))
});
VIEWS.mural = async () => {
  posts = await api('GET', '/posts');
  show(`
    ${head('Mural', 'Avisos e recados que aparecem na página inicial.', '<button class="b b-gold" data-act="new-post">+ Novo aviso</button>')}
    <datalist id="tags"><option>Aviso</option><option>Palavra da semana</option><option>Evento</option></datalist>
    ${posts.length ? `<div class="rows">${posts.map(p => `
      <div class="row">
        <div class="row-main"><b>${esc(p.title)}</b><small>${esc([p.tag, p.author, brDate(p.published_on)].filter(Boolean).join(' · '))}</small><p>${esc(p.body)}</p>
          <div class="chips"><span class="chip ${p.published ? 'on' : ''}">${p.published ? 'Publicado' : 'Rascunho'}</span></div></div>
        <div class="row-act">
          <button class="b b-sm" data-act="edit-post" data-id="${p.id}">Editar</button>
          <button class="b b-sm b-text red" data-act="del" data-res="posts" data-id="${p.id}" data-name="${esc(p.title)}">Excluir</button>
        </div>
      </div>`).join('')}</div>`
    : '<div class="empty"><p>Nenhum aviso ainda.</p><button class="b b-gold" data-act="new-post">Escrever o primeiro aviso</button></div>'}`);
};

// =====================================================================
// Configurações
// =====================================================================
const SETTINGS = [
  ['Página inicial', [['hero_eyebrow', 'Chamada pequena'], ['hero_title', 'Título principal'], ['hero_text', 'Texto de boas-vindas', 'textarea'], ['announcement', 'Aviso dourado no topo (opcional)', '', 'Ex.: Inscrições abertas para o acampamento!']]],
  ['Identidade', [['org_short', 'Sigla'], ['org_name', 'Nome completo']]],
  ['Contato e redes', [['email', 'E-mail', 'email'], ['whatsapp', 'WhatsApp da diretoria', '', '(31) 90000-0000'], ['city', 'Cidade', '', 'Belo Horizonte – MG'], ['instagram', 'Link do Instagram', 'url', 'https://instagram.com/…'], ['youtube', 'Link do canal no YouTube', 'url', 'https://youtube.com/@…']]],
  ['Pagamento por Pix', [['pix_key', 'Chave Pix', '', 'Aparece para o participante ao concluir a inscrição'], ['pix_holder', 'Nome do recebedor']]]
];
VIEWS.config = async () => {
  const s = await api('GET', '/settings');
  show(`
    ${head('Configurações', 'Textos do site, contatos e chave Pix.')}
    <form id="settings-form" class="rows" novalidate>
      ${SETTINGS.map(([title, fields]) => `<div class="card"><h2>${title}</h2><div class="form-grid">${fields.map(([key, label, type, ph]) =>
        type === 'textarea' ? `<label class="f full">${label}<textarea name="${key}" rows="3">${esc(s[key])}</textarea></label>`
        : `<label class="f ${key.startsWith('hero_title') || key === 'announcement' || key === 'org_name' ? 'full' : ''}">${label}<input type="${type || 'text'}" name="${key}" value="${esc(s[key])}" placeholder="${esc(ph || '')}"></label>`).join('')}</div></div>`).join('')}
      <div><button class="b b-primary" type="submit">Salvar configurações</button></div>
    </form>
    <form id="pass-form" class="card" novalidate><h2>Trocar senha</h2>
      <div class="form-grid">
        <label class="f">Senha atual<input type="password" name="current" autocomplete="current-password" required></label>
        <label class="f">Nova senha (mínimo 8 caracteres)<input type="password" name="next" autocomplete="new-password" minlength="8" required></label>
      </div>
      <button class="b" type="submit" style="margin-top:16px">Trocar senha</button>
    </form>`);
};
main.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  try {
    if (e.target.id === 'settings-form') { await api('PUT', '/settings', fd); toast('Configurações salvas.'); }
    if (e.target.id === 'pass-form') { await api('POST', '/password', fd); e.target.reset(); toast('Senha alterada.'); }
  } catch (ex) { toast(ex.message, true); }
});

// =====================================================================
// Cliques e mudanças (delegados)
// =====================================================================
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act, id = Number(t.dataset.id);
  try {
    if (act === 'drawer-close') closeDrawer();
    else if (act === 'new-event') eventForm();
    else if (act === 'edit-event') eventForm(events.find(x => x.id === id));
    else if (act === 'new-album') albumForm();
    else if (act === 'edit-album') albumForm(album);
    else if (act === 'new-video') videoForm();
    else if (act === 'edit-video') videoForm(videos.find(x => x.id === id));
    else if (act === 'feature-video') { await api('PUT', `/videos/${id}`, { featured: true }); toast('Vídeo em destaque na página inicial.'); route(); }
    else if (act === 'new-post') postForm();
    else if (act === 'edit-post') postForm(posts.find(x => x.id === id));
    else if (act === 'img-clear') {
      const box = t.parentElement;
      $('input[type=hidden]', box).value = '';
      $('img', box)?.remove();
      t.hidden = true;
    }
    else if (act === 'photo-cover') { await api('PUT', `/photos/${id}`, { cover: true }); toast('Capa do álbum atualizada.'); route(); }
    else if (act === 'photo-del') {
      if (!(await confirmBox('Excluir esta foto? Não dá para desfazer.'))) return;
      await api('DELETE', `/photos/${id}`);
      t.closest('.photo').remove();
      $('#photo-count').textContent = $$('#photos [data-photo]').length;
    }
    else if (act === 'del') {
      if (!(await confirmBox(`Excluir ${t.dataset.name}? Não dá para desfazer.`))) return;
      await api('DELETE', `/${t.dataset.res}/${id}`);
      toast('Excluído.');
      if (t.dataset.res === 'albums') location.hash = 'fotos'; else route();
    }
  } catch (ex) { toast(ex.message, true); }
});
document.addEventListener('change', async e => {
  const t = e.target;
  try {
    if (t.id === 'photo-input') { const files = [...t.files]; t.value = ''; await uploadPhotos(files); }
    else if (t.id === 'reg-event') { regFilter.event = t.value; location.hash === '#inscricoes' ? route() : (location.hash = 'inscricoes'); }
    else if (t.id === 'reg-status') { regFilter.status = t.value; VIEWS.inscricoes(); }
    else if (t.dataset.act === 'reg-status') {
      await api('PUT', `/registrations/${t.dataset.id}`, { status: t.value });
      regs.find(r => r.id === Number(t.dataset.id)).status = t.value;
      t.className = t.value;
      regTable();
      toast('Situação atualizada.');
    }
  } catch (ex) { toast(ex.message, true); }
});
document.addEventListener('input', e => { if (e.target.id === 'reg-q') { regFilter.q = e.target.value; regTable(); } });

// ---------- início ----------
(async () => {
  try { await api('GET', '/me'); $('#shell').hidden = false; route(); }
  catch { showLogin(); }
})();
})();

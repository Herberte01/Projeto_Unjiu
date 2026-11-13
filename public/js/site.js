/* UMJIU — site público. Todo texto vindo do servidor passa por esc() antes de entrar no HTML. */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
let SITE = null;

// ---------- datas e valores ----------
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES3 = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const parts = iso => { const [y, m, d] = String(iso).split('-').map(Number); return { y, m, d }; };
const pad = n => String(n).padStart(2, '0');
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
const fmtDate = iso => { if (!iso) return ''; const p = parts(iso); return `${p.d} de ${MESES[p.m - 1]} de ${p.y}`; };
const fmtShort = iso => { if (!iso) return ''; const p = parts(iso); return `${p.d} ${MES3[p.m - 1].toLowerCase()} ${p.y}`; };
const fmtBr = iso => { const p = parts(iso); return `${pad(p.d)}/${pad(p.m)}/${p.y}`; };
function fmtRange(a, b) {
  if (!b || b === a) return fmtDate(a);
  const s = parts(a), e = parts(b);
  if (s.y === e.y && s.m === e.m) return `${s.d} a ${e.d} de ${MESES[e.m - 1]} de ${e.y}`;
  if (s.y === e.y) return `${s.d} de ${MESES[s.m - 1]} a ${e.d} de ${MESES[e.m - 1]} de ${e.y}`;
  return `${fmtDate(a)} a ${fmtDate(b)}`;
}
const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const isUpcoming = e => (e.ends_on || e.starts_on) >= todayIso();
const upcoming = () => SITE.events.filter(isUpcoming);

// Parcelas: a primeira vence hoje, as demais no dia 10 dos meses seguintes, sempre antes do evento.
function schedule(ev, n) {
  const now = new Date();
  const per = Math.floor(ev.price_cents / n);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 10);
    const iso = i === 0 ? todayIso() : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-10`;
    return { n: i + 1, iso, label: i === 0 ? 'hoje' : fmtBr(iso), cents: i === 0 ? ev.price_cents - per * (n - 1) : per };
  });
}
function installmentOptions(ev) {
  const out = [1];
  for (let n = 2; n <= ev.max_installments; n++) {
    if (schedule(ev, n)[n - 1].iso < ev.starts_on) out.push(n);
  }
  return out;
}
function priceLine(ev) {
  if (!ev.price_cents) return 'Entrada gratuita';
  const max = Math.max(...installmentOptions(ev));
  return max > 1 ? `Até ${max}x de ${money(Math.floor(ev.price_cents / max))} no Pix, sem juros` : 'Pix à vista';
}

const ytThumb = id => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
const GRAD = ['linear-gradient(135deg,#2E4A7A,#142038)', 'linear-gradient(135deg,#3D5A8A,#1B2A4A)', 'linear-gradient(160deg,#24375C,#2E3D5C)', 'linear-gradient(135deg,#8A6A1F,#1B2A4A)'];
const ICON = {
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  ppl: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.900 1.900 6.500 5.500M16 4.800a3.500 3.500 0 0 1 0 6.400M18 14.800c1.900.700 3.100 2.400 3.500 5.200"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.500v13l11-6.500z"/></svg>'
};

// ---------- utilidades de interface ----------
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
async function api(url, body) {
  const res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Não foi possível concluir. Tente de novo.');
  return data;
}
const maskCpf = v => {
  const d = String(v).replace(/\D/g, '').slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
};
const maskPhone = v => {
  const d = String(v).replace(/\D/g, '').slice(0, 11);
  if (d.length < 3) return d;
  if (d.length < 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  const cut = d.length === 11 ? 7 : 6;
  return `(${d.slice(0, 2)}) ${d.slice(2, cut)}-${d.slice(cut)}`;
};

// ---------- animações de entrada ----------
const io = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
  : null;
function animate(root) {
  $$('.words', root).forEach(el => {
    const words = el.textContent.trim().split(/\s+/);
    el.innerHTML = words.map((w, i) => `<span class="w"><span style="--i:${i}">${esc(w)}</span></span>`).join(' ');
  });
  $$('[data-stagger]', root).forEach(group => {
    [...group.children].forEach((child, i) => { child.classList.add('rv'); child.style.setProperty('--d', `${Math.min(i, 8) * 0.08}s`); });
  });
  $$('.rv, .words', root).forEach(el => (io && !REDUCED ? io.observe(el) : el.classList.add('in')));
}

// ---------- cabeçalho: encolhe, some ao descer e volta ao subir ----------
const top = $('#top');
const burger = $('#burger');
const menu = $('#menu');
let lastY = 0, ticking = false, bandBg = null;
function onScroll() {
  const y = scrollY;
  top.classList.toggle('is-scrolled', y > 40);
  if (!menu.classList.contains('open')) top.classList.toggle('is-hidden', y > 420 && y > lastY + 4);
  if (y < lastY - 4) top.classList.remove('is-hidden');
  lastY = y;
  if (bandBg && !REDUCED) {
    const r = bandBg.parentElement.getBoundingClientRect();
    if (r.bottom > 0 && r.top < innerHeight) bandBg.style.transform = `translate3d(0, ${((r.top + r.height / 2 - innerHeight / 2) * -0.12).toFixed(1)}px, 0)`;
  }
  ticking = false;
}
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });

function setMenu(open) {
  menu.classList.toggle('open', open);
  menu.setAttribute('aria-hidden', String(!open));
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  document.body.classList.toggle('lock', open);
  if (open) top.classList.remove('is-hidden');
}
burger.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
menu.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });

// ---------- partes fixas (faixa do topo, menu, rodapé) ----------
function renderChrome() {
  const s = SITE.settings;
  const next = upcoming()[0];
  const pillNext = $('#pill-next'), pillNews = $('#pill-news');
  if (next) {
    const p = parts(next.starts_on);
    pillNext.textContent = `Próximo: ${next.title} · ${p.d} de ${MESES[p.m - 1]}`;
    pillNext.href = `#/evento/${next.id}`;
    pillNext.hidden = false;
  }
  if (s.announcement) { pillNews.textContent = s.announcement; pillNews.hidden = false; }

  const wa = s.whatsapp.replace(/\D/g, '');
  const web = u => /^https:\/\//i.test(u);
  const social = [
    web(s.instagram) && `<a href="${esc(s.instagram)}" target="_blank" rel="noopener">Instagram</a>`,
    web(s.youtube) && `<a href="${esc(s.youtube)}" target="_blank" rel="noopener">YouTube</a>`
  ].filter(Boolean);
  const contact = [
    s.email && `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>`,
    wa && `<a href="https://wa.me/55${esc(wa)}" target="_blank" rel="noopener">WhatsApp ${esc(s.whatsapp)}</a>`,
    s.city && `<span>${esc(s.city)}</span>`
  ].filter(Boolean);
  $('#menu-foot').innerHTML = [...contact, ...social].join('');
  $('#foot').innerHTML = `
    <div class="wrap">
      <div class="foot-grid">
        <div class="foot-col" style="flex:1 1 260px">
          <img class="foot-logo" src="/img/logo-claro.png" alt="${esc(s.org_short)}" width="392" height="179" style="align-self:flex-start">
          <p style="max-width:280px">${esc(s.org_name)}</p>
        </div>
        <div class="foot-col"><h2>LINKS RÁPIDOS</h2>
          <a href="#/eventos">Eventos e inscrições</a><a href="#/mensagens">Mensagens</a><a href="#/galeria">Galeria de fotos</a><a href="#/mural">Mural</a>
        </div>
        ${contact.length ? `<div class="foot-col"><h2>CONTATO</h2>${contact.join('')}</div>` : ''}
        ${social.length ? `<div class="foot-col"><h2>REDES</h2>${social.join('')}</div>` : ''}
      </div>
      <div class="foot-base"><span>© ${new Date().getFullYear()} ${esc(s.org_short)}</span><a href="/admin">Área administrativa</a></div>
    </div>`;
}

// =====================================================================
// Páginas
// =====================================================================
function videoThumb(v, i) {
  return v.youtube_id
    ? `<img src="${ytThumb(v.youtube_id)}" alt="" loading="lazy">`
    : `<span class="fill" style="position:absolute;inset:0;background:${GRAD[i % GRAD.length]}"></span>`;
}
const videoMeta = v => [v.preacher, v.preached_on && fmtShort(v.preached_on)].filter(Boolean).map(esc).join(' · ');

function eventCard(e) {
  const p = parts(e.starts_on);
  const open = isUpcoming(e) && e.registration_open && e.spots_left !== 0;
  const badge = !isUpcoming(e) ? '<span class="badge off">Realizado</span>'
    : e.spots_left === 0 ? '<span class="badge off">Esgotado</span>'
    : !e.registration_open ? '<span class="badge off">Inscrições encerradas</span>'
    : e.spots_left !== null && e.spots_left <= 20 ? `<span class="badge gold">Últimas ${e.spots_left} vagas</span>` : '';
  return `
  <a class="card ev" href="#/evento/${e.id}">
    <div class="ev-cover">
      ${e.cover ? `<img src="/uploads/${esc(e.cover)}" alt="" loading="lazy">` : ''}
      <div class="date-chip"><small>${MES3[p.m - 1]}</small><b>${pad(p.d)}</b></div>${badge}
    </div>
    <div class="ev-body">
      ${e.audience ? `<span class="eyebrow">${esc(e.audience)}</span>` : ''}
      <h2>${esc(e.title)}</h2>
      <p>${esc(e.description)}</p>
      <div class="meta"><span>${ICON.cal}${esc(fmtRange(e.starts_on, e.ends_on))}</span>${e.location ? `<span>${ICON.pin}${esc(e.location)}</span>` : ''}</div>
      <div class="ev-foot">
        <div class="price"><b>${e.price_cents ? money(e.price_cents) : 'Gratuito'}</b><small>${esc(priceLine(e))}</small></div>
        <span class="btn btn-sm ${open ? 'btn-dark' : 'btn-outline'}">${open ? 'Inscrever-se' : 'Ver detalhes'}</span>
      </div>
    </div>
  </a>`;
}

function videoCard(v, i) {
  return `
  <button class="card vcard" data-act="play" data-yt="${esc(v.youtube_id)}">
    <div class="vthumb">${videoThumb(v, i)}<span class="play">${ICON.play}</span>${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ''}</div>
    <div class="vinfo"><b>${esc(v.title)}</b><small>${videoMeta(v)}</small></div>
  </button>`;
}

const postHtml = p => `
  <article class="post">
    <span class="post-meta">${[p.tag, p.author, p.published_on && fmtShort(p.published_on)].filter(Boolean).map(esc).join(' · ')}</span>
    <h3>${esc(p.title)}</h3>
    <p>${esc(p.body)}</p>
  </article>`;

// ----- início -----
function viewHome() {
  const s = SITE.settings;
  const next = upcoming();
  const hero = SITE.videos.find(v => v.featured) || SITE.videos[0];
  const tiles = [
    ...next.slice(0, 5).map((e, i) => {
      const p = parts(e.starts_on);
      return { href: `#/evento/${e.id}`, tag: `${pad(p.d)} ${MES3[p.m - 1]}`, title: e.title, img: e.cover && `/uploads/${e.cover}`, grad: GRAD[i % GRAD.length], cta: 'Inscreva-se' };
    }),
    ...SITE.albums.slice(0, 3).map(a => ({ href: `#/galeria/${a.id}`, tag: 'FOTOS', title: a.title, img: `/uploads/${a.cover}`, cta: `${a.count} fotos` })),
    SITE.videos.length ? { href: '#/mensagens', tag: 'YOUTUBE', title: 'Mensagens', img: hero.youtube_id && ytThumb(hero.youtube_id), grad: GRAD[2], cta: 'Assistir' } : null
  ].filter(Boolean);
  const strip = SITE.preview.length >= 4 ? SITE.preview : [];
  const stripItems = strip.map(p => `<a href="#/galeria/${p.album_id}" tabindex="-1"><img src="/uploads/${esc(p.thumb)}" alt="" loading="lazy" ${p.width ? `width="${Math.round(230 * p.width / p.height)}" height="230"` : ''}></a>`).join('');
  const bandCover = next.find(e => e.cover);

  return `
  ${hero ? `
  <section class="hero on-dark" aria-labelledby="hero-t">
    <div class="wrap hero-grid">
      <button class="video-hero rv" data-act="play" data-yt="${esc(hero.youtube_id)}" aria-label="Assistir à última mensagem">
        ${videoThumb(hero, 0)}<span class="play">${ICON.play}</span>${hero.duration ? `<span class="dur">${esc(hero.duration)}</span>` : ''}
      </button>
      <div class="hero-copy">
        <span class="eyebrow gold rv">Última mensagem</span>
        <h1 id="hero-t" class="t-lg words">${esc(hero.title)}</h1>
        <span class="sub rv" style="--d:.25s">${[hero.series && `Série ${hero.series}`, hero.preacher].filter(Boolean).map(esc).join(' · ')}</span>
        <div class="btn-row rv" style="--d:.35s">
          <button class="btn btn-light" data-act="play" data-yt="${esc(hero.youtube_id)}">Assistir agora</button>
          <a class="btn btn-ghost" href="#/mensagens">Mensagens anteriores</a>
        </div>
      </div>
    </div>
  </section>` : '<div style="height:120px;background:var(--navy)"></div>'}

  <section class="panel bg-white">
    <div class="wrap wrap-narrow welcome">
      <span class="eyebrow rv">${esc(s.hero_eyebrow)}</span>
      <h2 class="t-xl words">${esc(s.hero_title)}</h2>
      <p class="lead rv" style="--d:.2s">${esc(s.hero_text)}</p>
      <a class="btn btn-gold rv" style="--d:.3s" href="#/eventos">Participe de um evento</a>
    </div>
  </section>

  <section class="panel bg-cream" aria-labelledby="caminhos-t">
    <div class="wrap">
      <div class="sec-head center"><span class="eyebrow rv">Para a sua mocidade</span><h2 id="caminhos-t" class="t-lg words">Caminhos para participar</h2></div>
      <div class="grid-3" data-stagger>
        <a class="card path" href="#/eventos"><span class="num">01</span><h3 class="t-md">Eventos</h3><p>Acampamentos, retiros e encontros regionais com inscrição on-line e pagamento parcelado no Pix.</p><span class="link-u">Saiba mais</span></a>
        <a class="card path" href="#/mensagens"><span class="num">02</span><h3 class="t-md">Mensagens</h3><p>Assista às pregações dos encontros e compartilhe com a sua mocidade.</p><span class="link-u">Saiba mais</span></a>
        <a class="card path" href="#/galeria"><span class="num">03</span><h3 class="t-md">Galeria</h3><p>Reviva os melhores momentos: fotos dos acampamentos, retiros e encontros.</p><span class="link-u">Saiba mais</span></a>
      </div>
    </div>
  </section>

  ${tiles.length ? `
  <section class="panel bg-white" aria-labelledby="destaques-t">
    <div class="wrap"><div class="sec-head row">
      <div><span class="eyebrow rv">Acontece na UMJIU</span><h2 id="destaques-t" class="t-lg words">Em destaque</h2></div>
      <div class="rail-ctl"><button class="rail-btn" data-act="rail-prev" aria-label="Anteriores">&#8592;</button><button class="rail-btn" data-act="rail-next" aria-label="Próximos">&#8594;</button></div>
    </div></div>
    <div class="rail" id="rail" data-stagger>
      ${tiles.map(t => `
      <a class="tile" href="${t.href}" draggable="false">
        ${t.img ? `<img src="${esc(t.img)}" alt="" loading="lazy" draggable="false">` : `<span class="fill" style="background:${t.grad}"></span>`}
        <span class="tile-label"><small>${esc(t.tag)}</small><strong>${esc(t.title)}</strong><em>${esc(t.cta)} &rarr;</em></span>
      </a>`).join('')}
    </div>
    <div class="rail-bar"><i id="rail-bar"></i></div>
  </section>` : ''}

  ${strip.length ? `
  <section class="panel bg-cream" aria-labelledby="fotos-t">
    <div class="wrap"><div class="sec-head row">
      <div><span class="eyebrow rv">Galeria</span><h2 id="fotos-t" class="t-lg words">Momentos que marcaram</h2></div>
      <a class="link-u rv" href="#/galeria">Ver todas as fotos</a>
    </div></div>
    <div class="strip rv"><div class="strip-track" style="--t:${strip.length * 7}s">${stripItems}${stripItems}</div></div>
  </section>` : ''}

  ${SITE.posts.length ? `
  <section class="panel ${strip.length ? 'bg-white' : 'bg-cream'}" aria-labelledby="mural-t">
    <div class="wrap split">
      <div class="split-side">
        <span class="eyebrow rv">Fique por dentro</span>
        <h2 id="mural-t" class="t-lg words">Mural da UMJIU</h2>
        <p class="muted rv">Avisos e palavras da diretoria para as mocidades.</p>
        ${SITE.posts.length > 3 ? '<a class="link-u rv" href="#/mural">Ver todos os avisos</a>' : ''}
      </div>
      <div data-stagger>${SITE.posts.slice(0, 3).map(postHtml).join('')}</div>
    </div>
  </section>` : ''}

  <section class="panel band bg-deep on-dark" aria-labelledby="band-t">
    ${bandCover ? `<div class="band-bg" id="band-bg" style="background-image:url('/uploads/${esc(bandCover.cover)}')"></div>` : ''}
    <div class="wrap wrap-narrow">
      <span class="eyebrow gold rv">Próximos eventos</span>
      ${next.length ? `
        <h2 id="band-t" class="t-xl words">${esc(next[0].title)}</h2>
        <p class="rv" style="color:var(--mist)">${esc(fmtRange(next[0].starts_on, next[0].ends_on))}${next[0].location ? ' · ' + esc(next[0].location) : ''}</p>
        <div class="count rv" id="count" data-date="${esc(next[0].starts_on)}" aria-label="Contagem regressiva">
          <div><b data-u="d">--</b><span>dias</span></div><div><b data-u="h">--</b><span>horas</span></div><div><b data-u="m">--</b><span>min</span></div><div><b data-u="s">--</b><span>seg</span></div>
        </div>
        <div class="btn-row rv" style="justify-content:center">
          <a class="btn btn-gold" href="#/evento/${next[0].id}">Garantir minha vaga</a>
          <a class="btn btn-ghost" href="#/eventos">Ver todos os eventos</a>
        </div>` : `
        <h2 id="band-t" class="t-xl words">Acampamento, retiro e encontros regionais</h2>
        <a class="btn btn-gold rv" href="#/eventos">Ver todos os eventos</a>`}
    </div>
  </section>`;
}

// ----- eventos -----
let evTab = 'proximos';
function viewEvents() {
  const list = evTab === 'proximos' ? upcoming() : SITE.events.filter(e => !isUpcoming(e)).reverse();
  return `
  <div class="page"><div class="wrap">
    <div class="page-head"><span class="eyebrow rv">Agenda</span><h1 class="t-xl words">Eventos</h1>
      <p class="lead rv">Escolha um evento e faça sua inscrição em poucos minutos.</p></div>
    <div class="tabs">
      <button class="tab" data-act="ev-tab" data-tab="proximos" aria-pressed="${evTab === 'proximos'}">Próximos</button>
      <button class="tab" data-act="ev-tab" data-tab="realizados" aria-pressed="${evTab === 'realizados'}">Realizados</button>
    </div>
    ${list.length ? `<div class="ev-grid" data-stagger>${list.map(eventCard).join('')}</div>`
      : `<div class="empty">${evTab === 'proximos' ? 'Nenhum evento com data marcada no momento. Volte em breve!' : 'Ainda não há eventos realizados por aqui.'}</div>`}
  </div></div>`;
}

function viewEvent(id) {
  const e = SITE.events.find(x => x.id === id);
  if (!e) return notFound('Evento não encontrado.', '#/eventos', 'Ver eventos');
  const open = isUpcoming(e) && e.registration_open && e.spots_left !== 0;
  const why = !isUpcoming(e) ? 'Este evento já aconteceu.' : e.spots_left === 0 ? 'As vagas se esgotaram.' : 'As inscrições estão encerradas.';
  return `
  <div class="page"><div class="wrap">
    <a class="crumb" href="#/eventos">Todos os eventos</a>
    <div class="page-head">${e.audience ? `<span class="eyebrow rv">${esc(e.audience)}</span>` : ''}<h1 class="t-xl words">${esc(e.title)}</h1></div>
    ${e.cover ? `<div class="ev-hero rv"><img src="/uploads/${esc(e.cover)}" alt=""></div>` : ''}
    <div class="two">
      <div class="box rv">
        <p class="lead">${esc(e.description)}</p>
        ${e.details ? `<div class="prose">${esc(e.details)}</div>` : ''}
        <div class="meta" style="font-size:16px;gap:10px">
          <span>${ICON.cal}${esc(fmtRange(e.starts_on, e.ends_on))}</span>
          ${e.location ? `<span>${ICON.pin}${esc(e.location)}</span>` : ''}
          ${e.audience ? `<span>${ICON.ppl}${esc(e.audience)}</span>` : ''}
        </div>
      </div>
      <aside class="box sticky rv" style="--d:.12s">
        <div class="price"><b style="font-size:32px">${e.price_cents ? money(e.price_cents) : 'Gratuito'}</b><small>${esc(priceLine(e))}</small></div>
        ${open && e.spots_left !== null ? `<span class="badge gold" style="align-self:flex-start">${e.spots_left} ${e.spots_left === 1 ? 'vaga restante' : 'vagas restantes'}</span>` : ''}
        ${open ? `<a class="btn btn-gold" href="#/inscricao/${e.id}">Inscrever-se</a>` : `<div class="note warn">${why}</div>`}
        <p class="muted" style="font-size:14px">Já participou de um evento da UMJIU? Seus dados aparecem preenchidos com CPF e data de nascimento.</p>
      </aside>
    </div>
  </div></div>`;
}

// ----- mensagens -----
let vQuery = '';
const filterVideos = () => {
  const q = vQuery.trim().toLowerCase();
  return q ? SITE.videos.filter(v => `${v.title} ${v.preacher} ${v.series}`.toLowerCase().includes(q)) : SITE.videos;
};
const videoGrid = () => {
  const list = filterVideos();
  return list.length ? list.map(videoCard).join('') : '<div class="empty" style="grid-column:1/-1">Nenhuma mensagem encontrada.</div>';
};
function viewVideos() {
  return `
  <div class="page"><div class="wrap">
    <div class="page-head"><span class="eyebrow rv">YouTube</span><h1 class="t-xl words">Mensagens</h1>
      <p class="lead rv">Pregações dos encontros da UMJIU para assistir e compartilhar.</p></div>
    ${SITE.videos.length ? `
      <div class="tabs"><input class="search" id="v-search" type="search" placeholder="Buscar por título ou pregador" aria-label="Buscar mensagens" value="${esc(vQuery)}"></div>
      <div class="v-grid" id="v-grid" data-stagger>${videoGrid()}</div>` : '<div class="empty">As mensagens serão publicadas aqui em breve.</div>'}
  </div></div>`;
}

// ----- galeria -----
function viewGallery() {
  return `
  <div class="page"><div class="wrap">
    <div class="page-head"><span class="eyebrow rv">Fotos</span><h1 class="t-xl words">Galeria</h1>
      <p class="lead rv">Os melhores momentos dos nossos encontros.</p></div>
    ${SITE.albums.length ? `<div class="al-grid" data-stagger>${SITE.albums.map(a => `
      <a class="album" href="#/galeria/${a.id}">
        <img src="/uploads/${esc(a.cover)}" alt="" loading="lazy">
        <span class="album-label"><strong>${esc(a.title)}</strong><small>${[a.event_date && fmtDate(a.event_date), `${a.count} fotos`].filter(Boolean).map(esc).join(' · ')}</small></span>
      </a>`).join('')}</div>` : '<div class="empty">As fotos dos eventos serão publicadas aqui em breve.</div>'}
  </div></div>`;
}

let lbPhotos = [], lbIndex = 0;
async function viewAlbum(id) {
  let album;
  try { album = await api(`/api/albums/${id}`); } catch { return notFound('Álbum não encontrado.', '#/galeria', 'Ver galeria'); }
  lbPhotos = album.photos;
  return `
  <div class="page"><div class="wrap">
    <a class="crumb" href="#/galeria">Todos os álbuns</a>
    <div class="page-head"><span class="eyebrow rv">${esc([album.event_date && fmtDate(album.event_date), `${album.photos.length} fotos`].filter(Boolean).join(' · '))}</span>
      <h1 class="t-xl words">${esc(album.title)}</h1>${album.description ? `<p class="lead rv">${esc(album.description)}</p>` : ''}</div>
    <div class="masonry" data-stagger>${album.photos.map((p, i) => `
      <button data-act="lb-open" data-i="${i}" aria-label="Ampliar foto ${i + 1}">
        <img src="/uploads/${esc(p.thumb)}" alt="${esc(p.caption)}" loading="lazy" ${p.width ? `width="${p.width}" height="${p.height}"` : ''}>
      </button>`).join('')}</div>
  </div></div>`;
}

// ----- mural -----
let postTag = '';
function viewPosts() {
  const tags = [...new Set(SITE.posts.map(p => p.tag).filter(Boolean))];
  const list = postTag ? SITE.posts.filter(p => p.tag === postTag) : SITE.posts;
  return `
  <div class="page"><div class="wrap wrap-narrow">
    <div class="page-head"><span class="eyebrow rv">Fique por dentro</span><h1 class="t-xl words">Mural</h1>
      <p class="lead rv">Avisos e palavras da diretoria para as mocidades.</p></div>
    ${tags.length > 1 ? `<div class="tabs"><button class="tab" data-act="post-tag" data-tag="" aria-pressed="${!postTag}">Tudo</button>${tags.map(t => `<button class="tab" data-act="post-tag" data-tag="${esc(t)}" aria-pressed="${postTag === t}">${esc(t)}</button>`).join('')}</div>` : ''}
    ${list.length ? `<div data-stagger>${list.map(postHtml).join('')}</div>` : '<div class="empty">Nenhum aviso publicado ainda.</div>'}
  </div></div>`;
}

const notFound = (msg, href, label) => `<div class="page"><div class="wrap"><div class="empty"><p style="margin-bottom:18px">${esc(msg)}</p><a class="btn btn-dark" href="${href}">${esc(label)}</a></div></div></div>`;

// =====================================================================
// Inscrição em 3 passos
// =====================================================================
const EMPTY_FORM = { cpf: '', birth: '', name: '', email: '', phone: '', city: '', church: '', shirt: '', notes: '' };
let flow = null;
function startFlow(eventId) {
  if (!flow || flow.eventId !== eventId) {
    flow = { eventId, step: 1, form: { ...EMPTY_FORM }, consent: true, parcelas: 1, mode: 'pix', lookup: null, origem: '', error: '', bad: [], busy: false, result: null };
  }
}
function viewFlow(id) {
  const ev = SITE.events.find(x => x.id === id);
  if (!ev) return notFound('Evento não encontrado.', '#/eventos', 'Ver eventos');
  if (!(isUpcoming(ev) && ev.registration_open && ev.spots_left !== 0)) return viewEvent(id);
  startFlow(id);
  const f = flow.form;
  const free = !ev.price_cents;
  const labels = free ? ['Seus dados', 'Confirmação'] : ['Seus dados', 'Pagamento', 'Confirmação'];
  const cur = free && flow.step === 3 ? 2 : flow.step;
  const steps = labels.map((l, i) => {
    const n = i + 1, cls = n < cur || flow.step === 3 ? 'done' : n === cur ? 'current' : '';
    return `<li class="${cls}" ${cls === 'current' ? 'aria-current="step"' : ''}><i>${cls === 'done' ? '✓' : n}</i>${l}</li>`;
  }).join('');
  const field = (key, label, attrs = '', cls = '') => `
    <label class="field ${cls} ${flow.bad.includes(key) ? 'bad' : ''}">${label}<input data-f="${key}" value="${esc(f[key])}" ${attrs}></label>`;

  let body = '';
  if (flow.step === 1) {
    body = `
    <section class="box">
      <div><h1 style="font:800 28px/1.15 var(--display)">Seus dados</h1>
        <p class="muted">Já participou de um evento da UMJIU? Informe CPF e data de nascimento e preenchemos o restante com os dados da sua última inscrição.</p></div>
      <div class="inline">
        ${field('cpf', 'CPF', 'inputmode="numeric" placeholder="000.000.000-00" autocomplete="off"')}
        ${field('birth', 'Data de nascimento', 'type="date" max="' + todayIso() + '"')}
        <button class="btn btn-dark" data-act="lookup" style="border-radius:12px" ${flow.busy ? 'disabled' : ''}>Buscar cadastro</button>
      </div>
      ${flow.lookup === 'found' ? `<div class="note" role="status">Encontramos seu cadastro do <strong>&nbsp;${esc(flow.origem)}</strong>. Confira os dados e atualize o que tiver mudado.</div>` : ''}
      ${flow.lookup === 'none' ? '<div class="note warn" role="status">Não encontramos um cadastro com esses dados. Preencha abaixo: eles ficam salvos para a próxima inscrição.</div>' : ''}
      <div class="form-grid">
        ${field('name', 'Nome completo', 'autocomplete="name"', 'full')}
        ${field('email', 'E-mail', 'type="email" autocomplete="email" placeholder="voce@email.com"')}
        ${field('phone', 'WhatsApp', 'inputmode="tel" autocomplete="tel" placeholder="(31) 90000-0000"')}
        ${field('city', 'Cidade', 'placeholder="Belo Horizonte – MG"')}
        ${field('church', 'Igreja', '')}
        <label class="field">Tamanho da camiseta<select data-f="shirt"><option value="">Selecione</option>${['PP', 'P', 'M', 'G', 'GG', 'XG'].map(t => `<option ${f.shirt === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field full">Observações (alergias, restrições alimentares…)<textarea data-f="notes" maxlength="500">${esc(f.notes)}</textarea></label>
      </div>
      <label class="check"><input type="checkbox" data-act="consent" ${flow.consent ? 'checked' : ''}><span>Autorizo a UMJIU a guardar meus dados para preencher inscrições futuras, conforme a LGPD.</span></label>
      ${flow.error ? `<div class="note err" role="alert">${esc(flow.error)}</div>` : ''}
      <div class="actions"><a class="btn btn-outline" href="#/evento/${ev.id}">Voltar ao evento</a>
        <button class="btn btn-gold" data-act="flow-next" ${flow.busy ? 'disabled' : ''}>${free ? 'Confirmar inscrição' : 'Continuar para pagamento'}</button></div>
    </section>`;
  } else if (flow.step === 2) {
    const opts = installmentOptions(ev);
    const canSplit = opts.length > 1;
    const plan = schedule(ev, flow.mode === 'parc' ? flow.parcelas : 1);
    body = `
    <section class="box">
      <div><h1 style="font:800 28px/1.15 var(--display)">Forma de pagamento</h1><p class="muted">Sua vaga fica reservada e é confirmada quando a diretoria identificar o pagamento.</p></div>
      <div class="opts" role="group" aria-label="Forma de pagamento">
        <button class="opt" data-act="pay" data-mode="pix" aria-pressed="${flow.mode === 'pix'}"><i></i><span><b>Pix à vista</b><small>${money(ev.price_cents)} em um único pagamento.</small></span></button>
        ${canSplit ? `<button class="opt" data-act="pay" data-mode="parc" aria-pressed="${flow.mode === 'parc'}"><i></i><span><b>Pix parcelado, sem juros</b><small>Até ${Math.max(...opts)}x. A última parcela vence antes do evento.</small></span></button>` : ''}
        <button class="opt" disabled aria-pressed="false"><i></i><span><b>Cartão ou boleto</b><small>Em breve.</small></span></button>
      </div>
      ${flow.mode === 'parc' ? `
        <div style="display:flex;flex-direction:column;gap:14px;border-top:1px solid var(--line);padding-top:20px">
          <b>Em quantas parcelas?</b>
          <div class="chips" role="group" aria-label="Número de parcelas">${opts.filter(n => n > 1).map(n => `<button class="chip" data-act="parc" data-n="${n}" aria-pressed="${flow.parcelas === n}">${n}x de ${money(Math.floor(ev.price_cents / n))}</button>`).join('')}</div>
          <div class="sched">${plan.map(p => `<div><b>${p.n}ª parcela</b><span class="muted">Vence ${p.label}</span><b>${money(p.cents)}</b></div>`).join('')}</div>
        </div>` : ''}
      ${flow.error ? `<div class="note err" role="alert">${esc(flow.error)}</div>` : ''}
      <div class="actions"><button class="btn btn-outline" data-act="flow-back">Voltar aos dados</button>
        <button class="btn btn-gold" data-act="flow-submit" ${flow.busy ? 'disabled' : ''}>${flow.busy ? 'Enviando…' : 'Confirmar inscrição'}</button></div>
    </section>`;
  } else {
    const s = SITE.settings, r = flow.result;
    const plan = schedule(ev, r.installments);
    const wa = s.whatsapp.replace(/\D/g, '');
    const waText = encodeURIComponent(`Olá! Fiz minha inscrição no ${ev.title} (código ${r.code}) e envio o comprovante do Pix.`);
    body = `
    <section class="box">
      <div style="display:flex;gap:16px;align-items:center"><span class="ok-ring"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7.500"/></svg></span>
        <div><h1 style="font:800 26px/1.15 var(--display)">Inscrição registrada</h1><span class="muted">Código <strong>${esc(r.code)}</strong> · ${esc(f.name)}</span></div></div>
      ${r.free ? '<div class="note">Sua vaga está confirmada. É só comparecer!</div>' : `
        <div><b style="font-size:18px">${r.installments > 1 ? `1ª parcela: ${money(plan[0].cents)}` : `Valor: ${money(ev.price_cents)}`}</b></div>
        ${s.pix_key ? `
          <label class="field">Chave Pix${s.pix_holder ? ` · ${esc(s.pix_holder)}` : ''}
            <span class="copy-row"><input readonly id="pix-key" value="${esc(s.pix_key)}"><button class="btn btn-dark btn-sm" data-act="copy-pix" style="border-radius:10px">Copiar chave</button></span></label>
          <p class="muted" style="font-size:14px">Faça o Pix e envie o comprovante com o código da inscrição. A confirmação é feita pela diretoria.</p>
          ${wa ? `<a class="btn btn-outline" style="align-self:flex-start" target="_blank" rel="noopener" href="https://wa.me/55${esc(wa)}?text=${waText}">Enviar comprovante pelo WhatsApp</a>` : ''}`
        : '<div class="note">A diretoria vai enviar os dados do Pix para o seu e-mail e WhatsApp. Guarde o código da inscrição.</div>'}
        ${r.installments > 1 ? `<div><b>Parcelas</b><div class="sched" style="margin-top:10px">${plan.map(p => `<div><b>${p.n}ª parcela</b><span class="muted">Vence ${p.label}</span><b>${money(p.cents)}</b></div>`).join('')}</div></div>` : ''}`}
      <a class="btn btn-outline" style="align-self:flex-start" href="#/">Voltar ao início</a>
    </section>`;
  }

  return `
  <div class="page"><div class="wrap">
    <ol class="steps" aria-label="Etapas da inscrição">${steps}</ol>
    <div class="two">
      <div>${body}</div>
      <aside class="box sticky summary" aria-label="Resumo da inscrição">
        <span class="eyebrow">Resumo</span>
        <h2>${esc(ev.title)}</h2>
        <div class="meta"><span>${ICON.cal}${esc(fmtRange(ev.starts_on, ev.ends_on))}</span>${ev.location ? `<span>${ICON.pin}${esc(ev.location)}</span>` : ''}</div>
        <div class="line"><span class="muted">Valor</span><b style="font:800 22px/1 var(--display)">${free ? 'Gratuito' : money(ev.price_cents)}</b></div>
        <span class="muted" style="font-size:13px">${esc(priceLine(ev))}</span>
        ${f.name.trim() ? `<div class="line" style="flex-direction:column;gap:2px"><span class="muted" style="font-size:14px">Participante</span><b>${esc(f.name)}</b></div>` : ''}
      </aside>
    </div>
  </div></div>`;
}
function rerenderFlow() {
  app.innerHTML = viewFlow(flow.eventId);
  $$('.rv, .words', app).forEach(el => el.classList.add('in'));
  scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
}
function validateStep1() {
  const f = flow.form, bad = [];
  if (f.cpf.replace(/\D/g, '').length !== 11) bad.push('cpf');
  if (f.name.trim().length < 3) bad.push('name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) bad.push('email');
  if (f.phone.replace(/\D/g, '').length < 10) bad.push('phone');
  flow.bad = bad;
  flow.error = bad.length ? 'Confira CPF, nome, e-mail e WhatsApp para continuar.' : '';
  return !bad.length;
}
async function submitFlow() {
  const ev = SITE.events.find(x => x.id === flow.eventId);
  flow.busy = true; flow.error = '';
  rerenderFlow();
  try {
    flow.result = await api('/api/registrations', { event_id: ev.id, ...flow.form, consent: flow.consent, installments: flow.mode === 'parc' ? flow.parcelas : 1 });
    flow.step = 3;
    if (ev.spots_left !== null) ev.spots_left = Math.max(0, ev.spots_left - 1);
  } catch (e) {
    flow.error = e.message;
    if (!ev.price_cents) flow.step = 1;
  }
  flow.busy = false;
  rerenderFlow();
}

// =====================================================================
// Carrossel, contagem regressiva, vídeo e fotos
// =====================================================================
function setupRail() {
  const rail = $('#rail');
  if (!rail) return;
  const bar = $('#rail-bar'), prev = $('[data-act="rail-prev"]'), nextBtn = $('[data-act="rail-next"]');
  const sync = () => {
    const max = rail.scrollWidth - rail.clientWidth;
    const ratio = rail.clientWidth / rail.scrollWidth;
    bar.parentElement.hidden = max <= 4;
    bar.style.width = `${Math.max(ratio * 100, 12)}%`;
    bar.style.transform = `translateX(${max > 0 ? (rail.scrollLeft / max) * (100 / Math.max(ratio, 0.12) - 100) : 0}%)`;
    if (prev) { prev.disabled = rail.scrollLeft <= 4; nextBtn.disabled = rail.scrollLeft >= max - 4; }
  };
  rail.addEventListener('scroll', sync, { passive: true });
  addEventListener('resize', sync);
  sync();
  // arrastar com o mouse
  let down = false, startX = 0, startLeft = 0, moved = false;
  rail.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') return; down = true; moved = false; startX = e.clientX; startLeft = rail.scrollLeft; });
  addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 6) { moved = true; rail.classList.add('drag'); }
    if (moved) rail.scrollLeft = startLeft - dx;
  });
  addEventListener('pointerup', () => { if (!down) return; down = false; setTimeout(() => rail.classList.remove('drag'), 0); });
  rail.addEventListener('click', e => { if (moved) { e.preventDefault(); moved = false; } }, true);
  rail.addEventListener('dragstart', e => e.preventDefault());
}
const railStep = dir => { const rail = $('#rail'); if (rail) rail.scrollBy({ left: dir * rail.clientWidth * 0.8, behavior: 'smooth' }); };

let countTimer;
function setupCount() {
  clearInterval(countTimer);
  const el = $('#count');
  if (!el) return;
  const p = parts(el.dataset.date);
  const target = new Date(p.y, p.m - 1, p.d).getTime();
  const tick = () => {
    const diff = Math.max(0, target - Date.now());
    const v = { d: Math.floor(diff / 864e5), h: Math.floor(diff / 36e5) % 24, m: Math.floor(diff / 6e4) % 60, s: Math.floor(diff / 1e3) % 60 };
    for (const k in v) $(`[data-u="${k}"]`, el).textContent = pad(v[k]);
  };
  tick();
  countTimer = setInterval(tick, 1000);
}

let lastFocus = null;
function openPlayer(id) {
  if (!/^[\w-]{11}$/.test(id)) return toast('Este vídeo ainda não foi publicado no YouTube.');
  lastFocus = document.activeElement;
  $('#player-frame').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0" title="Vídeo" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
  $('#player').hidden = false;
  document.body.classList.add('lock');
  $('#player .modal-x').focus();
}
function closePlayer() {
  $('#player').hidden = true;
  $('#player-frame').innerHTML = '';
  document.body.classList.remove('lock');
  lastFocus?.focus();
}
function showPhoto(i) {
  lbIndex = (i + lbPhotos.length) % lbPhotos.length;
  const p = lbPhotos[lbIndex], img = $('#lb-img');
  img.style.animation = 'none'; void img.offsetWidth; img.style.animation = '';
  img.src = `/uploads/${p.file}`;
  img.alt = p.caption || `Foto ${lbIndex + 1}`;
  $('#lb-cap').textContent = `${p.caption ? p.caption + ' · ' : ''}${lbIndex + 1} de ${lbPhotos.length}`;
  const nextP = lbPhotos[(lbIndex + 1) % lbPhotos.length];
  if (nextP) new Image().src = `/uploads/${nextP.file}`;
}
function openLightbox(i) {
  lastFocus = document.activeElement;
  $('#lightbox').hidden = false;
  document.body.classList.add('lock');
  showPhoto(i);
  $('#lightbox .modal-x').focus();
}
function closeLightbox() { $('#lightbox').hidden = true; document.body.classList.remove('lock'); lastFocus?.focus(); }
let touchX = null;
$('#lightbox').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
$('#lightbox').addEventListener('touchend', e => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) showPhoto(lbIndex + (dx < 0 ? 1 : -1));
  touchX = null;
});
$$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) (m.id === 'player' ? closePlayer : closeLightbox)(); }));
addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('#player').hidden) closePlayer();
    else if (!$('#lightbox').hidden) closeLightbox();
    else if (menu.classList.contains('open')) { setMenu(false); burger.focus(); }
  }
  if (!$('#lightbox').hidden) {
    if (e.key === 'ArrowRight') showPhoto(lbIndex + 1);
    if (e.key === 'ArrowLeft') showPhoto(lbIndex - 1);
  }
});

// =====================================================================
// Eventos de clique e digitação (delegados)
// =====================================================================
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'play') openPlayer(t.dataset.yt);
  else if (act === 'close-player') closePlayer();
  else if (act === 'lb-open') openLightbox(Number(t.dataset.i));
  else if (act === 'lb-close') closeLightbox();
  else if (act === 'lb-prev') showPhoto(lbIndex - 1);
  else if (act === 'lb-next') showPhoto(lbIndex + 1);
  else if (act === 'rail-prev') railStep(-1);
  else if (act === 'rail-next') railStep(1);
  else if (act === 'ev-tab') { evTab = t.dataset.tab; render(false); }
  else if (act === 'post-tag') { postTag = t.dataset.tag; render(false); }
  else if (act === 'consent') flow.consent = t.checked;
  else if (act === 'pay') { flow.mode = t.dataset.mode; if (flow.mode === 'parc' && flow.parcelas < 2) flow.parcelas = Math.max(...installmentOptions(SITE.events.find(x => x.id === flow.eventId))); rerenderFlow(); }
  else if (act === 'parc') { flow.parcelas = Number(t.dataset.n); rerenderFlow(); }
  else if (act === 'flow-back') { flow.step = 1; flow.error = ''; rerenderFlow(); }
  else if (act === 'flow-next') {
    if (!validateStep1()) return rerenderFlow();
    const ev = SITE.events.find(x => x.id === flow.eventId);
    if (!ev.price_cents) return submitFlow();
    flow.step = 2; rerenderFlow();
  }
  else if (act === 'flow-submit') submitFlow();
  else if (act === 'lookup') {
    const f = flow.form;
    if (f.cpf.replace(/\D/g, '').length !== 11 || !f.birth) { flow.error = 'Informe CPF e data de nascimento para buscar o cadastro.'; flow.bad = ['cpf', 'birth']; return rerenderFlow(); }
    flow.busy = true; flow.error = ''; flow.bad = [];
    try {
      const r = await api('/api/lookup', { cpf: f.cpf, birth: f.birth });
      if (r.found) {
        Object.assign(f, { name: r.data.name, email: r.data.email, phone: r.data.phone, city: r.data.city, church: r.data.church, shirt: r.data.shirt });
        flow.lookup = 'found'; flow.origem = r.data.origem;
      } else flow.lookup = 'none';
    } catch (err) { flow.error = err.message; }
    flow.busy = false;
    rerenderFlow();
  }
  else if (act === 'copy-pix') {
    const input = $('#pix-key');
    try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
    toast('Chave Pix copiada.');
  }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.f && flow) {
    if (t.dataset.f === 'cpf') t.value = maskCpf(t.value);
    if (t.dataset.f === 'phone') t.value = maskPhone(t.value);
    flow.form[t.dataset.f] = t.value;
  } else if (t.id === 'v-search') {
    vQuery = t.value;
    const grid = $('#v-grid');
    grid.innerHTML = videoGrid();
  }
});

// =====================================================================
// Rotas
// =====================================================================
let renderToken = 0;
async function render(scroll = true) {
  const token = ++renderToken;
  const [name = '', arg] = location.hash.replace(/^#\/?/, '').split('/');
  const id = Number(arg) || 0;
  const routes = {
    '': [viewHome, 'inicio', 'Início'], eventos: [viewEvents, 'eventos', 'Eventos'], evento: [() => viewEvent(id), 'eventos', 'Evento'],
    inscricao: [() => viewFlow(id), 'eventos', 'Inscrição'], mensagens: [viewVideos, 'mensagens', 'Mensagens'],
    galeria: [() => (id ? viewAlbum(id) : viewGallery()), 'galeria', 'Galeria'], mural: [viewPosts, 'mural', 'Mural']
  };
  const [view, nav, title] = routes[name] || [() => notFound('Página não encontrada.', '#/', 'Ir para o início'), '', 'Página não encontrada'];
  if (flow?.step === 3) flow = null; // inscrição concluída: a próxima começa do zero
  if (!$('#lightbox').hidden) closeLightbox();
  if (!$('#player').hidden) closePlayer();
  const html = await view();
  if (token !== renderToken) return;
  app.innerHTML = `<div class="view">${html}</div>`;
  document.title = `${title} — ${SITE.settings.org_short}`;
  $$('.nav a').forEach(a => (a.dataset.nav === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  animate(app);
  setupRail();
  setupCount();
  bandBg = $('#band-bg');
  if (scroll) { scrollTo(0, 0); top.classList.remove('is-hidden'); }
  onScroll();
}
addEventListener('hashchange', () => { setMenu(false); render(); });

(async () => {
  try {
    SITE = await api('/api/site');
  } catch {
    app.innerHTML = '<div class="page"><div class="wrap"><div class="empty">Não foi possível carregar o site. Atualize a página em instantes.</div></div></div>';
    return;
  }
  renderChrome();
  render();
})();
})();

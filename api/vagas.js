// Vercel Serverless Function — /api/vagas
// Busca ao vivo vagas de TI (Python & JavaScript / Júnior & Estágio) em:
// 1. Gupy Portal Oficial (Empresas do Brasil - link direto da vaga)
// 2. Vagas.com.br (Portal Nacional - link direto vagas.com.br)
// 3. Comunidades Tech BR (Extração de E-mails Diretos de RH @empresa + links diretos das empresas)

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const LINKEDIN_RE = /https?:\/\/(?:www\.|br\.)?linkedin\.com\/(?:in|company|jobs)\/[^\s)"'>\]]+/gi;
const URL_EXTERNA_RE = /https?:\/\/(?!(?:www\.)?github\.com|avatars\.githubusercontent\.com|user-images\.githubusercontent\.com)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\/[^\s)"'>\]]*/gi;

function extrairEmails(texto) {
  if (!texto) return [];
  const matches = texto.match(EMAIL_RE) || [];
  const ignorados = ['example.com', 'email.com', 'dominio.com', 'empresa.com', 'users.noreply.github.com', 'sede.com'];
  const unicos = [];
  for (const m of matches) {
    const clean = m.toLowerCase().replace(/[.,;:!)\]]+$/, '');
    const dom = clean.split('@')[1] || '';
    if (!ignorados.includes(dom) && !/\.(png|jpg|jpeg|svg|gif|webp|js|css|py)$/i.test(clean) && !unicos.includes(clean)) {
      unicos.push(clean);
    }
  }
  return unicos;
}

function extrairLinkedins(texto) {
  if (!texto) return [];
  const matches = texto.match(LINKEDIN_RE) || [];
  return [...new Set(matches.map(m => m.replace(/[.,;:!)\]]+$/, '')))];
}

function extrairLinkEmpresa(texto) {
  if (!texto) return '';
  const matches = texto.match(URL_EXTERNA_RE) || [];
  for (const raw of matches) {
    const clean = raw.replace(/[.,;:!)\]]+$/, '');
    if (!/\.(png|jpg|jpeg|svg|gif|webp)$/i.test(clean)) {
      return clean;
    }
  }
  return '';
}

function detectarNivel(titulo, labels, corpo) {
  const pri = `${titulo} ${(labels || []).join(' ')}`.toLowerCase();
  if (/\b(est[aá]gio|estagi[aá]ri[oa]|intern|internship|trainee)\b/.test(pri)) return 'Estágio / Trainee';
  if (/\b(j[uú]nior|jr)\b/.test(pri)) return 'Júnior';
  if (/\b(pleno|mid)\b/.test(pri)) return 'Pleno';
  if (/\b(s[eê]nior|sr|tech lead|especialista)\b/.test(pri)) return 'Sênior';
  const ini = (corpo || '').slice(0, 350).toLowerCase();
  if (/\b(est[aá]gio|estagi[aá]ri[oa]|trainee)\b/.test(ini)) return 'Estágio / Trainee';
  if (/\b(j[uú]nior|jr)\b/.test(ini)) return 'Júnior';
  return 'Júnior / Pleno';
}

function detectarModalidade(titulo, labels, corpo) {
  const txt = `${titulo} ${(labels || []).join(' ')} ${(corpo || '').slice(0, 500)}`.toLowerCase();
  const isRemoto = /\b(remoto|home office|home-office|remote)\b/.test(txt);
  const isHibrido = /\b(h[ií]brido|hybrid)\b/.test(txt);
  const isPresencial = /\b(presencial|on-site)\b/.test(txt);
  if (isRemoto && isHibrido) return 'Híbrido / Remoto';
  if (isRemoto) return 'Remoto';
  if (isHibrido) return 'Híbrido';
  if (isPresencial) return 'Presencial';
  return 'A consultar';
}

function stripHtml(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

async function buscarGupy() {
  const termos = ['desenvolvedor junior', 'estagio desenvolvimento', 'python junior', 'javascript junior'];
  const resultados = [];
  const vistos = new Set();

  await Promise.all(
    termos.map(async termo => {
      try {
        const r = await fetch(`https://portal.api.gupy.io/api/v1/jobs?jobName=${encodeURIComponent(termo)}&limit=15`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (!r.ok) return;
        const json = await r.json();
        for (const job of json.data || []) {
          if (!job.jobUrl || vistos.has(job.jobUrl)) continue;
          vistos.add(job.jobUrl);

          const descLimpa = stripHtml(job.description || '');
          const txtAll = `${job.name || ''} ${descLimpa}`.toLowerCase();
          const temJs = /\b(javascript|typescript|react|node|nodejs|vue|next|front-end|frontend|fullstack|web)\b/.test(txtAll);
          const temPy = /\b(python|django|fastapi|flask|pandas|dados|data|ia)\b/.test(txtAll);
          const localStr = [job.city, job.state].filter(Boolean).join(' - ') || 'Brasil';
          const modGupy = job.workplaceType === 'remote' ? 'Remoto' : job.workplaceType === 'hybrid' ? 'Híbrido' : 'Presencial';

          resultados.push({
            titulo: `${job.name} — ${job.careerPageName || 'Empresa Parceira'}`,
            empresa: job.careerPageName || 'Portal Gupy',
            local: localStr,
            corpo: `${descLimpa}\n\nLocalidade: ${localStr}\nEmpresa: ${job.careerPageName || ''}`,
            labels: [localStr, job.careerPageName].filter(Boolean),
            emails: extrairEmails(descLimpa),
            linkedins: [],
            temJs: temJs || termo.includes('javascript'),
            temPy: temPy || termo.includes('python'),
            nivel: detectarNivel(job.name || '', [], descLimpa),
            modalidade: modGupy,
            url: job.jobUrl,
            urlEmpresa: job.jobUrl,
            data: (job.publishedDate || '').slice(0, 10),
            fonte: `Gupy · ${job.careerPageName || 'Oficial'}`
          });
        }
      } catch (_) {}
    })
  );
  return resultados;
}

async function buscarCatho() {
  const urls = [
    'https://www.catho.com.br/vagas/desenvolvedor-junior/',
    'https://www.catho.com.br/vagas/estagio-ti/',
    'https://www.catho.com.br/vagas/programador-python/'
  ];
  const resultados = [];
  const vistos = new Set();

  await Promise.all(
    urls.map(async u => {
      try {
        const r = await fetch(u, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0' }
        });
        if (!r.ok) return;
        const html = await r.text();
        const regexLink = /<a[^>]*href="(https:\/\/www\.catho\.com\.br\/vagas\/[a-z0-9\-]+\/\d+\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = regexLink.exec(html)) !== null) {
          const link = m[1].trim();
          const titulo = stripHtml(m[2]);
          if (!titulo || titulo.length < 4 || vistos.has(link)) continue;
          vistos.add(link);

          const txtAll = `${titulo} ${u}`.toLowerCase();
          resultados.push({
            titulo: `${titulo} — Catho Oficial`,
            empresa: 'Empresa na Catho',
            local: 'Brasil',
            corpo: `Vaga oficial capturada diretamente da Catho (${titulo}). Clique em "Abrir Vaga Oficial" para se candidatar direto no portal da Catho.`,
            labels: ['Catho.com.br', 'Portal Oficial'],
            emails: [],
            linkedins: [],
            temJs: /\b(javascript|typescript|react|node|front|web|full|ti)\b/.test(txtAll),
            temPy: /\b(python|dados|data|back|ti)\b/.test(txtAll),
            nivel: detectarNivel(titulo, [], u),
            modalidade: detectarModalidade(titulo, [], ''),
            url: link,
            urlEmpresa: link,
            data: new Date().toISOString().slice(0, 10),
            fonte: 'Catho.com.br Oficial'
          });
        }
      } catch (_) {}
    })
  );
  return resultados;
}

async function buscarVagasComBr() {
  const urls = [
    'https://www.vagas.com.br/vagas-de-desenvolvedor-junior',
    'https://www.vagas.com.br/vagas-de-estagio-desenvolvimento',
    'https://www.vagas.com.br/vagas-de-programador-python'
  ];
  const resultados = [];
  const vistos = new Set();

  await Promise.all(
    urls.map(async u => {
      try {
        const r = await fetch(u, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0' }
        });
        if (!r.ok) return;
        const html = await r.text();
        const regexBloco = /<a[^>]*class="link-detalhes-vaga"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,1200}?<span[^>]*class="emprVaga"[^>]*>([\s\S]*?)<\/span>[\s\S]{0,1500}?<div[^>]*class="detalhes"[^>]*>([\s\S]*?)<\/div>/gi;
        let m;
        while ((m = regexBloco.exec(html)) !== null) {
          const link = 'https://www.vagas.com.br' + m[1].trim();
          if (vistos.has(link)) continue;
          vistos.add(link);

          const titulo = stripHtml(m[2]);
          const empresa = stripHtml(m[3]) || 'Confidencial';
          const resumo = stripHtml(m[4]);
          const txtAll = `${titulo} ${resumo}`.toLowerCase();

          resultados.push({
            titulo: `${titulo} — ${empresa}`,
            empresa,
            local: 'Brasil',
            corpo: `${resumo}\n\nVaga oficial publicada diretamente no portal Vagas.com.br pela empresa ${empresa}.`,
            labels: ['Vagas.com.br', empresa],
            emails: extrairEmails(resumo),
            linkedins: [],
            temJs: /\b(javascript|typescript|react|node|front|web|full)\b/.test(txtAll),
            temPy: /\b(python|dados|data|back)\b/.test(txtAll),
            nivel: detectarNivel(titulo, [], resumo),
            modalidade: detectarModalidade(titulo, [], resumo),
            url: link,
            urlEmpresa: link,
            data: new Date().toISOString().slice(0, 10),
            fonte: 'Vagas.com.br Oficial'
          });
        }
      } catch (_) {}
    })
  );
  return resultados;
}

async function buscarMuraisComEmailRH() {
  const queries = [
    'repo:backend-br/vagas repo:frontendbr/vagas repo:react-brasil/vagas repo:pybr/vagas repo:qa-brasil/vagas state:open',
    'repo:backend-br/vagas repo:frontendbr/vagas repo:react-brasil/vagas state:open junior OR estagio OR júnior OR estágio'
  ];
  const mapa = new Map();

  await Promise.all(
    queries.map(async q => {
      try {
        const r = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=65`, {
          headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'CathoDev-Radar-Vercel'
          }
        });
        if (!r.ok) return;
        const dados = await r.json();
        for (const item of dados.items || []) {
          if (mapa.has(item.html_url)) continue;
          const titulo = item.title || '';
          const corpo = item.body || '';
          const labels = (item.labels || []).map(l => l.name);
          const emails = extrairEmails(corpo);
          const linkedins = extrairLinkedins(corpo);
          const linkExterno = extrairLinkEmpresa(corpo) || linkedins[0] || '';
          const txtAll = `${titulo} ${labels.join(' ')} ${corpo}`.toLowerCase();
          const temJs = /\b(javascript|typescript|react|node|nodejs|vue|next\.js|nextjs|front-end|frontend|fullstack|full-stack)\b/.test(txtAll);
          const temPy = /\b(python|django|fastapi|flask|pandas|dados|data)\b/.test(txtAll);

          mapa.set(item.html_url, {
            titulo,
            empresa: 'Contato Direto RH / Tech',
            local: labels.find(l => /sp|rj|mg|pr|sc|rs|remoto|paulo|horizonte|curitiba/i.test(l)) || 'Brasil',
            corpo,
            labels,
            emails,
            linkedins,
            temJs,
            temPy,
            nivel: detectarNivel(titulo, labels, corpo),
            modalidade: detectarModalidade(titulo, labels, corpo),
            url: linkExterno || item.html_url,
            urlEmpresa: linkExterno,
            data: (item.created_at || '').slice(0, 10),
            fonte: emails.length > 0 ? 'RH Direto (E-mail Verificado)' : 'Comunidade Tech BR'
          });
        }
      } catch (_) {}
    })
  );
  return Array.from(mapa.values());
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const [cathoVagas, vagasComBr, muraisRH, gupyVagas] = await Promise.all([
      buscarCatho(),
      buscarVagasComBr(),
      buscarMuraisComEmailRH(),
      buscarGupy()
    ]);

    const todas = [...muraisRH, ...cathoVagas, ...vagasComBr, ...gupyVagas];
    return res.status(200).json({
      ok: true,
      total: todas.length,
      fontes: {
        rh_direto_comunidades: muraisRH.length,
        catho_oficial: cathoVagas.length,
        vagas_com_br: vagasComBr.length,
        gupy_empresas: gupyVagas.length
      },
      items: todas
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, items: [] });
  }
};

// Vercel Serverless Function — /api/vagas
// Busca ao vivo vagas de TI (Python & JavaScript / Júnior & Estágio) em:
// 1. Catho.com.br Oficial (link direto catho.com.br/vagas/...)
// 2. Vagas.com.br Oficial (link direto vagas.com.br/vagas/...)
// 3. Programathor Oficial (vagas Python & JavaScript no Brasil)
// 4. Comunidades Tech BR (Extração de E-mails Diretos de RH @empresa + links diretos das empresas)

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const LINKEDIN_RE = /https?:\/\/(?:www\.|br\.)?linkedin\.com\/(?:in|company|jobs)\/[^\s)"'>\]]+/gi;
const URL_EXTERNA_RE = /https?:\/\/(?!(?:www\.)?github\.com|avatars\.githubusercontent\.com|user-images\.githubusercontent\.com)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\/[^\s)"'>\]]*/gi;

function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(html) {
  return decodeEntities(
    (html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .trim();
}

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
  return 'Júnior / Estágio';
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
  return 'Presencial / Híbrido';
}

async function buscarCatho() {
  const urls = [
    'https://www.catho.com.br/vagas/desenvolvedor-junior/',
    'https://www.catho.com.br/vagas/estagio-ti/',
    'https://www.catho.com.br/vagas/programador-python/',
    'https://www.catho.com.br/vagas/desenvolvedor-javascript/'
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
        const regexArtigo = /<article[\s\S]*?<h2[^>]*class="title_offer"[^>]*>\s*<a[^>]*href="(\/vagas\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/article>/gi;
        let m;
        while ((m = regexArtigo.exec(html)) !== null) {
          const bloco = m[0];
          const pathUrl = m[1].trim();
          const link = pathUrl.startsWith('http') ? pathUrl : `https://www.catho.com.br${pathUrl}`;
          if (vistos.has(link)) continue;
          vistos.add(link);

          const titulo = stripHtml(m[2]);
          const locMatch = bloco.match(/i_job_location[\s\S]{0,180}?-\s*([^<\n]+)/i);
          const cidade = locMatch ? stripHtml(locMatch[1]) : 'Brasil';
          const salMatch = bloco.match(/i_salary[\s\S]{0,150}?<strong>([\s\S]*?)<\/strong>/i);
          const salario = salMatch ? stripHtml(salMatch[1]) : 'A Combinar';

          const txtAll = `${titulo} ${cidade} ${u}`.toLowerCase();
          resultados.push({
            titulo: `${titulo} (${cidade})`,
            empresa: 'Catho Oficial',
            local: cidade,
            corpo: `Vaga Oficial na Catho.com.br\n\nCargo: ${titulo}\nLocalidade: ${cidade}\nSalário: ${salario}\n\nClique no botão "Abrir no Portal Oficial" abaixo para enviar seu currículo diretamente na página desta vaga na Catho.`,
            labels: ['Catho.com.br', cidade, `Salário: ${salario}`].filter(Boolean),
            emails: [],
            linkedins: [],
            temJs: /\b(javascript|typescript|react|node|front|web|full|ti|sistemas|software)\b/.test(txtAll),
            temPy: /\b(python|dados|data|back|ti|sistemas|software)\b/.test(txtAll),
            nivel: detectarNivel(titulo, [u.includes('estagio') ? 'Estágio' : 'Júnior'], ''),
            modalidade: detectarModalidade(titulo, [cidade], ''),
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
          const txtAll = `${titulo} ${resumo} ${u}`.toLowerCase();

          resultados.push({
            titulo: `${titulo} — ${empresa}`,
            empresa,
            local: 'Brasil',
            corpo: `${resumo}\n\nVaga oficial publicada diretamente no portal Vagas.com.br pela empresa ${empresa}.`,
            labels: ['Vagas.com.br', empresa],
            emails: extrairEmails(resumo),
            linkedins: [],
            temJs: /\b(javascript|typescript|react|node|front|web|full|desenvolvedor|estagio|estágio)\b/.test(txtAll),
            temPy: /\b(python|dados|data|back|desenvolvedor|estagio|estágio)\b/.test(txtAll),
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

async function buscarProgramathor() {
  const urls = [
    'https://programathor.com.br/jobs-python',
    'https://programathor.com.br/jobs-javascript'
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
        const regexLink = /<a[^>]*href="(\/jobs\/\d+-[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = regexLink.exec(html)) !== null) {
          const link = `https://programathor.com.br${m[1].trim()}`;
          if (vistos.has(link)) continue;
          const textoBruto = stripHtml(m[2]);
          if (!textoBruto || textoBruto.length < 8) continue;
          vistos.add(link);

          const tituloLimpo = textoBruto.split('Vaga vencida')[0].trim().slice(0, 110);
          if (!tituloLimpo) continue;

          resultados.push({
            titulo: tituloLimpo,
            empresa: 'Programathor Tech',
            local: 'Brasil / Remoto',
            corpo: `${textoBruto}\n\nVaga publicada no portal Programathor (${link}).`,
            labels: ['Programathor', u.includes('python') ? 'Python' : 'JavaScript'],
            emails: [],
            linkedins: [],
            temJs: u.includes('javascript') || /javascript|react|node|front/i.test(textoBruto),
            temPy: u.includes('python') || /python|django|dados|data/i.test(textoBruto),
            nivel: detectarNivel(tituloLimpo, [], textoBruto),
            modalidade: detectarModalidade(tituloLimpo, [], textoBruto),
            url: link,
            urlEmpresa: link,
            data: new Date().toISOString().slice(0, 10),
            fonte: 'Programathor Oficial'
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
    const [cathoVagas, vagasComBr, muraisRH, progVagas] = await Promise.all([
      buscarCatho(),
      buscarVagasComBr(),
      buscarMuraisComEmailRH(),
      buscarProgramathor()
    ]);

    const todas = [...muraisRH, ...cathoVagas, ...vagasComBr, ...progVagas];
    return res.status(200).json({
      ok: true,
      total: todas.length,
      fontes: {
        rh_direto_comunidades: muraisRH.length,
        catho_oficial: cathoVagas.length,
        vagas_com_br: vagasComBr.length,
        programathor_oficial: progVagas.length
      },
      items: todas
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, items: [] });
  }
};

// --- SERVIDOR ASSINATURAS GIF 635x215 — compatível com o front atual ---
// Layout 2 colunas, logo/GIF à esquerda (contain, sem upscaling), divisor azul,
// textos à direita; QR somente na rota Trilha.

const express = require('express');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const gifFrames = require('gif-frames');
const GifEncoder = require('gif-encoder-2');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080;
const BUILD = '2025-10-23-r7';

const corsOptions = {
  origin: 'https://octopushelpdesk.com.br',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---------- helpers ----------
const streamToBuffer = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });

const pick = (obj, keys, fallback = '') => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) {
      const v = String(obj[k]).trim();
      if (v !== '') return v;
    }
  }
  return fallback;
};

// Desenha imagem contida na caixa, sem upscaling (mantém nitidez; evita halo/borda)
function drawContainNoUpscale(ctx, img, boxX, boxY, boxW, boxH) {
  const s = Math.min(1, Math.min(boxW / img.width, boxH / img.height));
  const dw = Math.round(img.width * s);
  const dh = Math.round(img.height * s);
  const dx = Math.round(boxX + (boxW - dw) / 2);
  const dy = Math.round(boxY + (boxH - dh) / 2);

  const prevEnabled = ctx.imageSmoothingEnabled;
  const prevQual = ctx.imageSmoothingQuality;
  ctx.imageSmoothingEnabled = false;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.imageSmoothingEnabled = prevEnabled;
  ctx.imageSmoothingQuality = prevQual || 'high';
}

// wrap manual (não usamos o parâmetro maxWidth do fillText para evitar “sumir” texto)
function drawWrapped(ctx, text, x, y, maxW, lineH) {
  if (!text) return y;
  const words = String(text).split(/\s+/);
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxW && i > 0) {
      ctx.fillText(line, x, y);
      line = words[i];
      y += lineH;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y);
  return y;
}

async function makeSignature(req, res, isTrilha) {
  const body = req.body || {};

  // compatível com seu front atual
  const name   = pick(body, ['name', 'nome'], 'Seu Nome');
  const title  = pick(body, ['title', 'cargo'], 'Seu Cargo');
  const phone  = pick(body, ['phone', 'telefone'], 'Seu Telefone');
  const gifUrl = pick(body, ['gifUrl', 'gif_url', 'gif']);

  // opcionais (o front não envia hoje, mas suportamos)
  const department = pick(body, ['department', 'departamento'], '');
  const address = pick(
    body,
    ['address', 'endereco', 'endereço'],
    'Setor SRPN - Estadio Mané Garrincha Raio 46/47 Cep: 70070-701 - Camarote Vip 09. Brasilia - DF. Brasil'
  );
  const email = pick(body, ['email', 'e-mail'], '');

  const qrCodeData = body.qrCodeData; // somente Trilha
  const outW = Number(body.outWidth) || 635;
  const outH = Number(body.outHeight) || 215;

  if (!gifUrl || !name || !title || !phone) {
    return res.status(400).send('Erro: envie name, title, phone e gifUrl.');
  }
  if (isTrilha && !qrCodeData) {
    return res.status(400).send('Erro: qrCodeData é obrigatório para Trilha.');
  }

  // log curto para confirmar que os campos chegaram
  const short = (s) => (s ? String(s).slice(0, 80) : s);
  console.log('[REQ]', {
    build: BUILD,
    trilha: isTrilha,
    out: `${outW}x${outH}`,
    name: short(name),
    title: short(title),
    phone: short(phone),
    department: short(department),
    email: short(email),
    address: short(address),
    gifUrl: short(gifUrl)
  });

  try {
    // 1) baixa GIF
    const r = await fetch(gifUrl);
    if (!r.ok) throw new Error(`Falha ao buscar GIF (${r.status} ${r.statusText})`);
    const gifBuffer = await r.buffer();

    // 2) extrai frames como PNG (evita 'document is not defined')
    const frames = await gifFrames({ url: gifBuffer, frames: 'all', outputType: 'png' });
    if (!frames || frames.length === 0) throw new Error('Nenhum frame encontrado no GIF.');

    // 3) encoder/canvas
    res.setHeader('Content-Type', 'image/gif');
    const encoder = new GifEncoder(outW, outH, 'neuquant', true);
    encoder.createReadStream().pipe(res);
    encoder.start();
    encoder.setRepeat(0);
    encoder.setQuality(1); // melhor qualidade

    const canvas = createCanvas(outW, outH);
    const ctx = canvas.getContext('2d');

    // paleta/typography (coerente com o preview)
    const nameColor   = isTrilha ? '#0E2923' : '#003366';
    const normalColor = isTrilha ? '#0E2923' : '#555555';
    const subtleColor = '#777777';

    const nameSize  = 16; // preview usa ~16px
    const subSize   = 13;
    const boldSub   = 13;
    const lineH     = 19;
    const smallSize = 11;
    const smallLH   = 15;

    // layout
    const padding = 16;
    const leftColW = 220;
    const dividerX = leftColW;
    const textLeft = dividerX + 12;
    const textAreaRightBase = outW - padding;

    // carrega QR se Trilha
    let qrImage = null;
    if (isTrilha && qrCodeData) {
      qrImage = await loadImage(qrCodeData);
    }

    for (const f of frames) {
      const delayMs = (f.frameInfo?.delay ?? 10) * 10;
      encoder.setDelay(delayMs);

      const frameBuf = await streamToBuffer(f.getImage());
      const frameImg = await loadImage(frameBuf);

      // fundo
      ctx.clearRect(0, 0, outW, outH);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, outW, outH);

      // logo à esquerda
      drawContainNoUpscale(ctx, frameImg, padding, padding, leftColW - padding * 2, outH - padding * 2);

      // divisor
      ctx.fillStyle = '#005A9C';
      ctx.fillRect(dividerX, padding, 2, outH - padding * 2);

      // área de texto (pode reduzir por causa do QR)
      let textRight = textAreaRightBase;

      // QR (Trilha)
      if (isTrilha && qrImage) {
        const qrSize = Math.min(110, outH - padding * 2);
        const qrX = outW - padding - qrSize;
        const qrY = Math.round((outH - qrSize) / 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12);
        ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
        textRight = qrX - 12;
      }

      const maxW = Math.max(40, textRight - textLeft);
      let y = padding;

      // Nome
      ctx.fillStyle = nameColor;
      ctx.textBaseline = 'top';
      ctx.font = `bold ${nameSize}px Arial, sans-serif`;
      y = drawWrapped(ctx, name, textLeft, y, maxW, lineH) + 6;

      // Departamento (opcional)
      if (department) {
        ctx.fillStyle = normalColor;
        ctx.font = `${subSize}px Arial, sans-serif`;
        y = drawWrapped(ctx, department, textLeft, y, maxW, lineH);
      }

      // Cargo
      ctx.fillStyle = normalColor;
      ctx.font = `${subSize}px Arial, sans-serif`;
      y = drawWrapped(ctx, title, textLeft, y, maxW, lineH);

      // Telefone
      ctx.fillStyle = normalColor;
      ctx.font = `bold ${boldSub}px Arial, sans-serif`;
      y = drawWrapped(ctx, phone, textLeft, y + 2, maxW, lineH);

      // Email (se vier)
      if (email) {
        ctx.fillStyle = normalColor;
        ctx.font = `${subSize}px Arial, sans-serif`;
        y = drawWrapped(ctx, email, textLeft, y + 2, maxW, lineH);
      }

      // Endereço (opcional)
      if (address) {
        ctx.fillStyle = subtleColor;
        ctx.font = `${smallSize}px Arial, sans-serif`;
        drawWrapped(ctx, address, textLeft, y + 6, maxW, smallLH);
      }

      encoder.addFrame(ctx);
    }

    encoder.finish();
    console.log('[ASSINATURA] OK', BUILD);
  } catch (e) {
    console.error('ERRO', e);
    if (!res.headersSent) {
      res.status(500).send(`Erro interno ao processar o GIF. Detalhe: ${e.message}`);
    }
  }
}

// ---------- rotas ----------
app.post('/generate-gif-signature', (req, res) => makeSignature(req, res, false));
app.post('/generate-trilha-signature', (req, res) => makeSignature(req, res, true));

app.get('/version', (_req, res) => res.json({ build: BUILD }));
app.get('/', (_req, res) => res.send(`Servidor no ar | build=${BUILD}`));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT} | build=${BUILD}`);
});

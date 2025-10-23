// --- SERVIDOR PARA GERAR ASSINATURAS GIF (COMPATÍVEL COM O FRONT ATUAL) ---
// Saída padrão: 635x215 | layout em 2 colunas | GIF/Logo à esquerda (contain sem upscaling)

const express = require('express');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const gifFrames = require('gif-frames');
const GifEncoder = require('gif-encoder-2');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const BUILD_VERSION = '2025-10-22-front-sync';

const corsOptions = {
  origin: 'https://octopushelpdesk.com.br', // mantenha restrito ao seu domínio
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

// desenha imagem contida na caixa, sem upscaling (mantém nitidez; evita "borda")
function drawContainNoUpscale(ctx, img, boxX, boxY, boxW, boxH) {
  const scaleW = boxW / img.width;
  const scaleH = boxH / img.height;
  const s = Math.min(1, Math.min(scaleW, scaleH)); // nunca > 1
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

// ---------- core ----------
async function generateSignature(req, res, isTrilha) {
  const body = req.body || {};

  // Compatível com o seu front **atual**
  const name    = pick(body, ['name', 'nome'],           'Seu Nome');
  const title   = pick(body, ['title', 'cargo'],         'Seu Cargo');
  const phone   = pick(body, ['phone', 'telefone'],      'Seu Telefone');
  const gifUrl  = pick(body, ['gifUrl', 'gif_url', 'gif']);

  // Campos opcionais (não enviados pelo front atual, mas suportados):
  const department = pick(body, ['department', 'departamento'], '');
  const address    = pick(
    body,
    ['address', 'endereco', 'endereço'],
    'Setor SRPN - Estadio Mané Garrincha Raio 46/47 Cep: 70070-701 - Camarote Vip 09. Brasilia - DF. Brasil'
  );
  const email      = pick(body, ['email', 'e-mail'], '');

  // QR somente para Trilha
  const qrCodeData = body.qrCodeData;

  // Tamanho final (default 635x215) — pode ser sobrescrito pelo front no futuro
  const outW = Number(body.outWidth)  || 635;
  const outH = Number(body.outHeight) || 215;

  // Validação mínima
  if (!gifUrl || !name || !title || !phone) {
    return res.status(400).send('Erro: envie ao menos name, title, phone e gifUrl.');
  }
  if (isTrilha && !qrCodeData) {
    return res.status(400).send('Erro: qrCodeData é obrigatório para a assinatura Trilha.');
  }

  try {
    // 1) baixa gif fonte
    const r = await fetch(gifUrl);
    if (!r.ok) throw new Error(`Falha ao buscar GIF (${r.status} ${r.statusText})`);
    const gifBuffer = await r.buffer();

    // 2) extrai frames como PNG (evita uso de DOM/document)
    const frames = await gifFrames({ url: gifBuffer, frames: 'all', outputType: 'png' });
    if (!frames || frames.length === 0) throw new Error('Nenhum frame encontrado no GIF.');

    // 3) encoder/canvas no tamanho final
    res.setHeader('Content-Type', 'image/gif');
    const encoder = new GifEncoder(outW, outH, 'neuquant', true);
    encoder.createReadStream().pipe(res);
    encoder.start();
    encoder.setRepeat(0);
    encoder.setQuality(1); // melhor qualidade

    const canvas = createCanvas(outW, outH);
    const ctx = canvas.getContext('2d');

    // 4) carrega QR se for Trilha
    let qrImage = null;
    if (isTrilha && qrCodeData) {
      qrImage = await loadImage(qrCodeData);
    }

    // 5) layout base (duas colunas)
    const padding = 16;
    const leftColW = 220;       // área do GIF/Logo
    const dividerX = leftColW;  // divisória azul
    const textLeft = dividerX + 12;
    const textAreaRightBase = outW - padding;

    // paleta/typography
    const nameColor   = isTrilha ? '#0E2923' : '#003366';
    const normalColor = isTrilha ? '#0E2923' : '#555555';
    const subtleColor = '#777777';

    const nameSize  = 16; // combinar com preview do HTML
    const subSize   = 13;
    const boldSub   = 13;
    const lineH     = 19;
    const smallSize = 11;
    const smallLH   = 15;

    for (const f of frames) {
      const delayMs = (f.frameInfo?.delay ?? 10) * 10;
      encoder.setDelay(delayMs);

      const frameBuf = await streamToBuffer(f.getImage());
      const frameImg = await loadImage(frameBuf);

      // fundo branco
      ctx.clearRect(0, 0, outW, outH);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, outW, outH);

      // GIF/Logo à esquerda (sem upscaling)
      drawContainNoUpscale(ctx, frameImg, padding, padding, leftColW - padding * 2, outH - padding * 2);

      // divisória azul
      ctx.fillStyle = '#005A9C';
      ctx.fillRect(dividerX, padding, 2, outH - padding * 2);

      // área de texto (pode encolher se houver QR)
      let textAreaRight = textAreaRightBase;

      // QR na direita (somente Trilha)
      if (isTrilha && qrImage) {
        const qrSize = Math.min(110, outH - padding * 2);
        const qrX = outW - padding - qrSize;
        const qrY = Math.round((outH - qrSize) / 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12);
        ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
        textAreaRight = qrX - 12;
      }

      // textos à direita
      const maxW = Math.max(40, textAreaRight - textLeft);
      let y = padding;

      // Nome (bold, 16px, #003366 no preview)
      ctx.fillStyle = nameColor;
      ctx.textBaseline = 'top';
      ctx.font = `bold ${nameSize}px Arial, sans-serif`;
      ctx.fillText(name, textLeft, y, maxW);
      y += lineH;

      // Departamento (13px cinza, se vier)
      if (department) {
        ctx.fillStyle = normalColor;
        ctx.font = `${subSize}px Arial, sans-serif`;
        ctx.fillText(department, textLeft, y, maxW);
        y += lineH;
      }

      // Cargo (13px cinza)
      ctx.fillStyle = normalColor;
      ctx.font = `${subSize}px Arial, sans-serif`;
      ctx.fillText(title, textLeft, y, maxW);
      y += lineH;

      // Telefone (13px bold)
      ctx.font = `bold ${boldSub}px Arial, sans-serif`;
      ctx.fillText(phone, textLeft, y, maxW);
      y += lineH;

      // Email (opcional)
      if (email) {
        ctx.font = `${subSize}px Arial, sans-serif`;
        ctx.fillText(email, textLeft, y, maxW);
        y += lineH;
      }

      // Endereço (11px cinza claro multi-linha — mesmo texto do preview se não vier no body)
      if (address) {
        ctx.fillStyle = subtleColor;
        ctx.font = `${smallSize}px Arial, sans-serif`;
        // wrap simples
        const words = address.split(/\s+/);
        let line = '';
        for (const w of words) {
          const test = line ? `${line} ${w}` : w;
          if (ctx.measureText(test).width > maxW) {
            ctx.fillText(line, textLeft, y, maxW);
            line = w;
            y += smallLH;
          } else {
            line = test;
          }
        }
        if (line) ctx.fillText(line, textLeft, y, maxW);
      }

      encoder.addFrame(ctx);
    }

    encoder.finish();
    console.log(`[ASSINATURA] OK ${BUILD_VERSION}`);
  } catch (err) {
    console.error('[ASSINATURA] ERRO:', err);
    if (!res.headersSent) {
      res.status(500).send(`Erro interno ao processar o GIF. Detalhe: ${err.message}`);
    }
  }
}

// ---------- rotas ----------
app.post('/generate-gif-signature', (req, res) => generateSignature(req, res, false));
app.post('/generate-trilha-signature', (req, res) => generateSignature(req, res, true));
app.get('/version', (_req, res) => res.json({ version: BUILD_VERSION }));
app.get('/', (_req, res) => res.send(`Servidor no ar! build=${BUILD_VERSION}`));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT} | build=${BUILD_VERSION}`);
});

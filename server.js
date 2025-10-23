// servidor de assinaturas GIF (635x215) — base gifuct-js + @napi-rs/canvas
// - Compatível com o payload do seu front:
//   { name, title, phone, gifUrl, (qrCodeData se Trilha), department?, address?, email?, outWidth?, outHeight? }
// - Layout: logo/GIF à esquerda, divisor azul, textos à direita; QR à direita (Trilha)

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { createCanvas, loadImage, ImageData, registerFont } = require('@napi-rs/canvas');
const GifEncoder = require('gif-encoder-2');
const { parseGIF, decompressFrames } = require('gifuct-js');

const app = express();
const PORT = process.env.PORT || 8080;
const BUILD = '2025-10-23-final-gifuct';

// --- CORS (restrito ao seu domínio) ---
const corsOptions = {
  origin: 'https://octopushelpdesk.com.br',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- Fonte (melhor compatibilidade em containers) ---
try {
  registerFont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', { family: 'DejaVuSans' });
  console.log('[FONT] DejaVuSans registrada');
} catch {
  console.log('[FONT] DejaVuSans não disponível; usando sans-serif padrão');
}

// ----------------- helpers -----------------
const pick = (obj, keys, fallback = '') => {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]).trim();
  }
  return fallback;
};

// Desenha imagem contida na caixa, sem upscaling (evita halo/borda)
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

// Wrap manual (não usamos maxWidth direto no fillText)
function drawWrapped(ctx, text, x, y, maxW, lineH) {
  if (!text) return y;
  const words = String(text).split(/\s+/);
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxW && i > 0) {
      ctx.fillText(line, x, y); ctx.strokeText(line, x, y);
      line = words[i];
      y += lineH;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y); ctx.strokeText(line, x, y);
  return y;
}

// Aplica o patch RGBA do frame (gifuct-js) na tela composta de origem
function blitFramePatch(ctx, frame) {
  const { dims, patch } = frame; // dims: {left, top, width, height}
  const imageData = new ImageData(Uint8ClampedArray.from(patch), dims.width, dims.height);
  ctx.putImageData(imageData, dims.left, dims.top);
}

// Trata descarte entre frames
function handleDisposal(ctx, prevFrame) {
  if (!prevFrame) return;
  const disposal = prevFrame.disposalType || 0;
  if (disposal === 2) {
    const { dims } = prevFrame;
    ctx.clearRect(dims.left, dims.top, dims.width, dims.height);
  } else if (disposal === 3) {
    // Fallback simples: limpa tudo (suficiente para a maioria dos GIFs)
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}

// ----------------- core -----------------
async function buildSignature(req, res, isTrilha) {
  const body = req.body || {};

  // Campos do seu front (obrigatórios)
  const name   = pick(body, ['name', 'nome'], 'Seu Nome');
  const title  = pick(body, ['title', 'cargo'], 'Seu Cargo');
  const phone  = pick(body, ['phone', 'telefone'], 'Seu Telefone');
  const gifUrl = pick(body, ['gifUrl', 'gif_url', 'gif']);

  // Opcionais (preview tem; front pode enviar depois)
  const department = pick(body, ['department', 'departamento'], '');
  const email      = pick(body, ['email', 'e-mail'], '');
  const address    = pick(
    body,
    ['address', 'endereco', 'endereço'],
    'Setor SRPN - Estadio Mané Garrincha Raio 46/47 Cep: 70070-701 - Camarote Vip 09. Brasilia - DF. Brasil'
  );

  const qrCodeData = body.qrCodeData; // somente Trilha
  const outW = Number(body.outWidth)  || 635;
  const outH = Number(body.outHeight) || 215;

  if (!gifUrl || !name || !title || !phone) {
    return res.status(400).send('Erro: envie name, title, phone e gifUrl.');
  }
  if (isTrilha && !qrCodeData) {
    return res.status(400).send('Erro: qrCodeData é obrigatório para Trilha.');
  }

  const short = (s) => (s ? String(s).slice(0, 90) : s);
  console.log('[REQ]', {
    build: BUILD, trilha: isTrilha, out: `${outW}x${outH}`,
    name: short(name), title: short(title), phone: short(phone),
    department: short(department), email: short(email), address: short(address),
    gifUrl: short(gifUrl)
  });

  try {
    // 1) baixa GIF como ArrayBuffer
    const r = await fetch(gifUrl);
    if (!r.ok) throw new Error(`Falha ao buscar GIF (${r.status} ${r.statusText})`);
    const buf = Buffer.from(await r.arrayBuffer());

    // 2) parse/decodificação
    const parsed = parseGIF(buf);
    const frames = decompressFrames(parsed, true); // true => gera patch RGBA
    const gifW = parsed.lsd.width;
    const gifH = parsed.lsd.height;

    // 3) encoder final
    res.setHeader('Content-Type', 'image/gif');
    const encoder = new GifEncoder(outW, outH, 'neuquant', true);
    encoder.createReadStream().pipe(res);
    encoder.start();
    encoder.setRepeat(0);
    encoder.setQuality(1); // melhor qualidade

    // 4) canvas
    //    - srcCanvas no tamanho do GIF de origem (onde compomos frame por frame)
    //    - outCanvas no tamanho final (layout 635x215)
    const srcCanvas = createCanvas(gifW, gifH);
    const srcCtx = srcCanvas.getContext('2d');

    const outCanvas = createCanvas(outW, outH);
    const outCtx = outCanvas.getContext('2d');

    // 5) layout do cartão
    const padding = 16;
    const leftColW = 220;
    const dividerX = leftColW;
    const textLeft = dividerX + 12;

    const nameColor   = isTrilha ? '#0E2923' : '#003366';
    const normalColor = isTrilha ? '#0E2923' : '#555555';
    const subtleColor = '#777777';

    const nameSize  = 16;
    const subSize   = 13;
    const boldSub   = 13;
    const lineH     = 19;
    const smallSize = 11;
    const smallLH   = 15;

    const fontFamily = 'DejaVuSans, sans-serif';
    const useStroke = () => { outCtx.lineWidth = 0.8; outCtx.strokeStyle = 'rgba(0,0,0,0.25)'; };

    // QR (Trilha)
    let qrImage = null;
    if (isTrilha && qrCodeData) {
      qrImage = await loadImage(qrCodeData);
    }

    let prevFrame = null;

    for (const f of frames) {
      // compõe frame de origem
      handleDisposal(srcCtx, prevFrame);
      blitFramePatch(srcCtx, f);

      // fundo do cartão
      outCtx.clearRect(0, 0, outW, outH);
      outCtx.fillStyle = '#FFFFFF';
      outCtx.fillRect(0, 0, outW, outH);

      // desenha logo animado na coluna esquerda
      const logoImg = await loadImage(srcCanvas.toBuffer('image/png'));
      drawContainNoUpscale(outCtx, logoImg, padding, padding, leftColW - padding * 2, outH - padding * 2);

      // divisor azul
      outCtx.fillStyle = '#005A9C';
      outCtx.fillRect(dividerX, padding, 2, outH - padding * 2);

      // área de texto (ajusta se tiver QR)
      let textRight = outW - padding;
      if (isTrilha && qrImage) {
        const qrSize = Math.min(110, outH - padding * 2);
        const qrX = outW - padding - qrSize;
        const qrY = Math.round((outH - qrSize) / 2);
        outCtx.fillStyle = '#FFFFFF';
        outCtx.fillRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12);
        outCtx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
        textRight = qrX - 12;
      }

      const maxW = Math.max(40, textRight - textLeft);
      let y = padding;

      // NOME
      outCtx.fillStyle = nameColor;
      outCtx.textBaseline = 'top';
      outCtx.font = `bold ${nameSize}px ${fontFamily}`;
      useStroke();
      y = drawWrapped(outCtx, name, textLeft, y, maxW, lineH) + 6;

      // DEPARTAMENTO (opcional)
      if (department) {
        outCtx.fillStyle = normalColor;
        outCtx.font = `${subSize}px ${fontFamily}`;
        useStroke();
        y = drawWrapped(outCtx, department, textLeft, y, maxW, lineH);
      }

      // CARGO
      outCtx.fillStyle = normalColor;
      outCtx.font = `${subSize}px ${fontFamily}`;
      useStroke();
      y = drawWrapped(outCtx, title, textLeft, y, maxW, lineH);

      // TELEFONE
      outCtx.fillStyle = normalColor;
      outCtx.font = `bold ${boldSub}px ${fontFamily}`;
      useStroke();
      y = drawWrapped(outCtx, phone, textLeft, y + 2, maxW, lineH);

      // EMAIL (opcional)
      if (email) {
        outCtx.fillStyle = normalColor;
        outCtx.font = `${subSize}px ${fontFamily}`;
        useStroke();
        y = drawWrapped(outCtx, email, textLeft, y + 2, maxW, lineH);
      }

      // ENDEREÇO (opcional ou padrão)
      if (address) {
        outCtx.fillStyle = subtleColor;
        outCtx.font = `${smallSize}px ${fontFamily}`;
        useStroke();
        drawWrapped(outCtx, address, textLeft, y + 6, maxW, smallLH);
      }

      // adiciona frame ao encoder
      const delayMs = (f.delay || 10) * 10; // delay em ms (gifuct usa centésimos)
      encoder.setDelay(delayMs);
      encoder.addFrame(outCtx);

      prevFrame = f;
    }

    encoder.finish();
    console.log('[ASSINATURA] OK', BUILD);
  } catch (e) {
    console.error('[ASSINATURA] ERRO', e);
    if (!res.headersSent) {
      res.status(500).send(`Erro interno ao processar o GIF. Detalhe: ${e.message}`);
    }
  }
}

// ----------------- rotas -----------------
app.post('/generate-gif-signature', (req, res) => buildSignature(req, res, false));
app.post('/generate-trilha-signature', (req, res) => buildSignature(req, res, true));

app.get('/version', (_req, res) => res.json({ build: BUILD }));
app.get('/', (_req, res) => res.send(`Servidor no ar | build=${BUILD}`));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT} | build=${BUILD}`);
});

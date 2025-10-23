// --- SERVIDOR ASSINATURAS GIF — r10 DIAG (Diagnóstico de Desenho) ---

const express = require('express');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const gifFrames = require('gif-frames');
const GifEncoder = require('gif-encoder-2');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080; // Railway define a porta via env
const BUILD = '2025-10-23-r10-DIAG'; // Nova versão de build

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

function drawContainNoUpscale(ctx, img, boxX, boxY, boxW, boxH) {
  const imgW = img.width || 1;
  const imgH = img.height || 1;
  if (boxW <= 0 || boxH <= 0 || imgW <= 0 || imgH <= 0) return;
  const s = Math.min(1, Math.min(boxW / imgW, boxH / imgH));
  const dw = Math.round(imgW * s);
  const dh = Math.round(imgH * s);
  const dx = Math.round(boxX + (boxW - dw) / 2);
  const dy = Math.round(boxY + (boxH - dh) / 2);
  try {
    ctx.imageSmoothingEnabled = false;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(img, dx, dy, dw, dh);
  } catch (e) { console.error("Erro em drawImage:", e.message); }
}

// ---------- Lógica Principal ----------
async function makeSignature(req, res, isTrilha) {
  const body = req.body || {};

  // Extrai dados
  const name   = pick(body, ['name', 'nome'], 'Nome Teste'); // Fallback mais visível
  const title  = pick(body, ['title', 'cargo'], 'Cargo Teste');
  const phone  = pick(body, ['phone', 'telefone'], '(00) 00000-0000');
  const gifUrl = pick(body, ['gifUrl', 'gif_url', 'gif']);
  // Ignora department, address, email por agora para simplificar
  const qrCodeData = body.qrCodeData;

  // Tamanho de Saída Fixo
  const outW = 635;
  const outH = 215;

  // Validações
  if (!gifUrl || !name || !title || !phone) {
    return res.status(400).send('Erro: envie name, title, phone e gifUrl.');
  }
  if (isTrilha && !qrCodeData) {
    return res.status(400).send('Erro: qrCodeData é obrigatório para Trilha.');
  }

  const short = (s) => (s ? String(s).slice(0, 80) : s);
  console.log('[REQ DIAG]', { build: BUILD, trilha: isTrilha, name: short(name), gifUrl: short(gifUrl) });

  try {
    // 1. Baixa GIF
    console.log('[DIAG] Baixando GIF...');
    const r = await fetch(gifUrl);
    if (!r.ok) throw new Error(`Falha ao buscar GIF (${r.status} ${r.statusText})`);
    const gifBuffer = await r.buffer();
    console.log('[DIAG] GIF baixado.');

    // 2. Extrai Frames (como PNG)
    console.log('[DIAG] Extraindo frames...');
    const frames = await gifFrames({ url: gifBuffer, frames: 'all', outputType: 'png' });
    if (!frames || frames.length === 0) throw new Error('Nenhum frame encontrado no GIF.');
    console.log(`[DIAG] ${frames.length} frames extraídos.`);

    // 3. Configura Encoder e Resposta
    res.setHeader('Content-Type', 'image/gif');
    const encoder = new GifEncoder(outW, outH, 'neuquant', true);
    encoder.createReadStream().pipe(res);
    encoder.start();
    encoder.setRepeat(0);
    encoder.setQuality(10);

    const canvas = createCanvas(outW, outH);
    const ctx = canvas.getContext('2d');
    console.log('[DIAG] Canvas e Encoder configurados.');

    // 4. Layout Fixo Simplificado (Ajustado para 635x215)
    const padding = 20;
    const leftColW = 240;
    const dividerX = leftColW;
    const textLeft = dividerX + 30; // Posição X inicial do texto (mais para a direita)
    let textAreaRight = outW - padding;

    // Fontes Grandes Fixas
    const nameSize  = 30; // Bem grande
    const subSize   = 24; // Grande
    const lineH     = 35; // Espaço grande

    // Cores Contraste
    const textColor = '#000000'; // Preto para garantir visibilidade

    // QR Code (Trilha)
    let qrImage = null;
    let qrSize = 0, qrX = 0, qrY = 0;
    if (isTrilha && qrCodeData) {
      try {
        console.log('[DIAG] Carregando QR Code...');
        qrImage = await loadImage(qrCodeData);
        qrSize = 130; // Tamanho fixo grande
        qrX = outW - padding - qrSize;
        qrY = (outH - qrSize) / 2;
        textAreaRight = qrX - 20;
        console.log('[DIAG] QR Code carregado.');
      } catch(e) { console.error("[DIAG] Erro ao carregar QR Code:", e.message); }
    }

    const maxTextWidth = Math.max(50, textAreaRight - textLeft);

    // 5. Processa cada Frame
    console.log('[DIAG] Iniciando processamento de frames...');
    let frameCount = 0;
    for (const f of frames) {
      frameCount++;
      const delayMs = (f.frameInfo?.delay ?? 10) * 10;
      encoder.setDelay(delayMs > 10 ? delayMs : 100);

      const frameBuf = await streamToBuffer(f.getImage());
      const frameImg = await loadImage(frameBuf);

      // Limpa e desenha fundo (branco)
      ctx.clearRect(0, 0, outW, outH);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, outW, outH);

      // Desenha Logo (Frame do GIF original) na área esquerda
      drawContainNoUpscale(ctx, frameImg, padding, padding, leftColW - padding * 2, outH - padding * 2);

      // Divisor Vertical (se não for Trilha)
      if (!isTrilha) {
        ctx.fillStyle = '#005A9C';
        ctx.fillRect(dividerX, padding, 2, outH - padding * 2);
      }

      // Desenha QR (se Trilha)
      if (isTrilha && qrImage) {
        console.log(`[DIAG Frame ${frameCount}] Desenhando QR...`);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(qrX - 5, qrY - 5, qrSize + 10, qrSize + 10);
        ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
      }

      // --- DESENHO DE TEXTO SIMPLIFICADO ---
      let currentY = 50; // Começa fixo em Y=50
      ctx.fillStyle = textColor;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';

      // Nome
      try {
          ctx.font = `bold ${nameSize}px sans-serif`;
          console.log(`[DIAG Frame ${frameCount}] Desenhando Nome: ${name} em ${textLeft},${currentY} (Fonte: ${ctx.font})`);
          ctx.fillText(name, textLeft, currentY, maxTextWidth);
          currentY += lineH; // Próxima linha
      } catch (e) { console.error(`[DIAG Frame ${frameCount}] Erro ao desenhar Nome:`, e.message); }

      // Cargo
      try {
          ctx.font = `${subSize}px sans-serif`;
          console.log(`[DIAG Frame ${frameCount}] Desenhando Cargo: ${title} em ${textLeft},${currentY} (Fonte: ${ctx.font})`);
          ctx.fillText(title, textLeft, currentY, maxTextWidth);
          currentY += lineH; // Próxima linha
      } catch (e) { console.error(`[DIAG Frame ${frameCount}] Erro ao desenhar Cargo:`, e.message); }

      // Telefone
      try {
          ctx.font = `bold ${subSize}px sans-serif`;
          console.log(`[DIAG Frame ${frameCount}] Desenhando Telefone: ${phone} em ${textLeft},${currentY} (Fonte: ${ctx.font})`);
          ctx.fillText(phone, textLeft, currentY, maxTextWidth);
      } catch (e) { console.error(`[DIAG Frame ${frameCount}] Erro ao desenhar Telefone:`, e.message); }
      // --- FIM DESENHO DE TEXTO SIMPLIFICADO ---

      // Adiciona frame ao encoder
      encoder.addFrame(ctx);
    }
    console.log(`[DIAG] ${frameCount} frames processados.`);

    // 6. Finaliza
    console.log('[DIAG] Finalizando GIF...');
    encoder.finish();
    console.log('[DIAG] Processamento concluído.');

  } catch (e) {
    console.error('[DIAG] ERRO GERAL:', e.message, e.stack);
    if (!res.headersSent) {
      res.status(500).send(`Erro interno (DIAG). Detalhe: ${e.message}`);
    } else {
       console.error('[DIAG] Erro após início do stream.');
       if (!res.writableEnded) res.end();
    }
  }
}

// ---------- rotas ----------
app.post('/generate-gif-signature', (req, res) => makeSignature(req, res, false));
app.post('/generate-trilha-signature', (req, res) => makeSignature(req, res, true));

app.get('/version', (_req, res) => res.json({ build: BUILD }));
// Root (vRAILWAY-DRAWDIAG) - Nova versão para prova
app.get('/', (_req, res) => res.send(`PROVA: Servidor vRAILWAY-DRAWDIAG está no ar!`));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT} | build=${BUILD}`);
});


// --- SERVIDOR NODE.JS PARA GERAÇÃO DE ASSINATURAS (SAÍDA FIXA 635x215, LAYOUT 2 COLUNAS) ---

const express = require('express');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const gifFrames = require('gif-frames');
const GifEncoder = require('gif-encoder-2');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const BUILD_VERSION = '2025-10-22-r3';

/* =========================
   C O R S   R E S T R I T O
   ========================= */
const corsOptions = {
  origin: 'https://octopushelpdesk.com.br', // ajuste se precisar
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* ============================================
   H E L P E R S
   ============================================ */

// Converte um stream (do gif-frames em PNG) para Buffer
const streamToBuffer = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });

// Desenha a imagem "contida" em uma caixa (sem cortar nem distorcer)
function drawContain(ctx, img, boxX, boxY, boxW, boxH) {
  const s = Math.min(boxW / img.width, boxH / img.height);
  const dw = Math.round(img.width * s);
  const dh = Math.round(img.height * s);
  const dx = Math.round(boxX + (boxW - dw) / 2);
  const dy = Math.round(boxY + (boxH - dh) / 2);
  ctx.drawImage(img, dx, dy, dw, dh);
}

// Quebra simples de linha por largura
function drawTextWrap(ctx, text, x, y, maxWidth, lineHeight) {
  if (!text) return y;
  const words = String(text).split(/\s+/);
  let line = '';
  for (let n = 0; n < words.length; n++) {
    const test = line ? line + ' ' + words[n] : words[n];
    if (ctx.measureText(test).width > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n];
      y += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y);
  return y;
}

/* ============================================
   L Ó G I C A   D E   G E R A Ç Ã O   D E   G I F
   ============================================ */

const handleGifGeneration = async (req, res, isTrilha = false) => {
  const { name, title, phone, gifUrl, qrCodeData, address } = req.body;

  // Validações
  if (!gifUrl || !name || !title || !phone) {
    return res
      .status(400)
      .send('Erro: faltam parâmetros obrigatórios (nome, cargo, telefone, gifUrl).');
  }
  if (isTrilha && !qrCodeData) {
    return res.status(400).send('Erro: QR Code é obrigatório para a assinatura da Trilha.');
  }

  // Tamanho final (fixo desejado) com possibilidade de override
  const outW = Number(req.body.outWidth)  || 635;
  const outH = Number(req.body.outHeight) || 215;

  try {
    console.log(
      `[ASSINATURA] ${BUILD_VERSION} | ${isTrilha ? 'Trilha' : 'Outra'} | ${name} | ${outW}x${outH}`
    );

    // 1) Baixa o GIF de origem
    const gifResp = await fetch(gifUrl);
    if (!gifResp.ok) throw new Error(`Falha ao buscar GIF (${gifResp.status} ${gifResp.statusText})`);
    const gifBuffer = await gifResp.buffer();

    // 2) Extrai frames como PNG (evita DOM/document)
    const frames = await gifFrames({
      url: gifBuffer,
      frames: 'all',
      outputType: 'png'
    });
    if (!frames || frames.length === 0) throw new Error('Nenhum frame encontrado no GIF.');

    // 3) Encoder e canvas no tamanho final fixo
    res.setHeader('Content-Type', 'image/gif');
    const encoder = new GifEncoder(outW, outH, 'neuquant', true);
    encoder.createReadStream().pipe(res);
    encoder.start();
    encoder.setRepeat(0);
    encoder.setQuality(10);

    const canvas = createCanvas(outW, outH);
    const ctx = canvas.getContext('2d');

    // 4) Pré-carrega QR (se Trilha)
    let qrImage = null;
    if (isTrilha) {
      try {
        qrImage = await loadImage(qrCodeData);
      } catch {
        throw new Error('Falha ao carregar QR Code (qrCodeData inválido?).');
      }
    }

    // 5) Layout base (duas colunas)
    const padding = 16;
    const leftColW = 220; // coluna do logo/GIF à esquerda (se quiser ajustar, altere aqui)
    const dividerX = leftColW; // posição da divisória azul
    const textLeft = dividerX + 12;
    const textAreaRightBase = outW - padding;

    // 6) Processa frames
    for (const f of frames) {
      const delayMs = (f.frameInfo?.delay ?? 10) * 10;
      encoder.setDelay(delayMs);

      const frameBuf = await streamToBuffer(f.getImage());
      const frameImg = await loadImage(frameBuf);

      // Fundo branco (caso o GIF tenha transparência)
      ctx.clearRect(0, 0, outW, outH);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, outW, outH);

      // Esquerda: GIF contido
      drawContain(ctx, frameImg, padding, padding, leftColW - padding * 2, outH - padding * 2);

      // Divisória vertical azul
      ctx.fillStyle = '#1C4C9A';
      ctx.fillRect(dividerX, padding, 2, outH - padding * 2);

      // Se for Trilha, QR na extrema direita
      let textAreaRight = textAreaRightBase;
      if (isTrilha && qrImage) {
        const qrSize = Math.min(110, outH - padding * 2);
        const qrX = outW - padding - qrSize;
        const qrY = Math.round((outH - qrSize) / 2);

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12);
        ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

        textAreaRight = qrX - 12; // textos não invadem o QR
      }

      // Direita: textos
      const textMaxWidth = textAreaRight - textLeft;

      // Paleta
      const nameColor = isTrilha ? '#0E2923' : '#0E2B66';
      const normalColor = isTrilha ? '#0E2923' : '#2E3A4A';
      const addressColor = '#6A7280';

      // Tamanhos (ajustados para 215px de altura)
      const nameSize = 22;
      const subSize = 16;
      const lineH = 20;
      const addrSize = 12;
      const addrLineH = 15;

      let y = padding; // topo

      // Nome
      ctx.fillStyle = nameColor;
      ctx.textBaseline = 'top';
      ctx.font = `bold ${nameSize}px sans-serif`;
      y = drawTextWrap(ctx, name, textLeft, y, textMaxWidth, lineH) + 6;

      // Cargo
      ctx.fillStyle = normalColor;
      ctx.font = `${subSize}px sans-serif`;
      y = drawTextWrap(ctx, title, textLeft, y, textMaxWidth, lineH);

      // Telefone
      ctx.font = `bold ${subSize}px sans-serif`;
      y = drawTextWrap(ctx, phone, textLeft, y + 2, textMaxWidth, lineH);

      // Endereço (opcional, como no preview)
      if (address) {
        ctx.fillStyle = addressColor;
        ctx.font = `${addrSize}px sans-serif`;
        drawTextWrap(ctx, address, textLeft, y + 6, textMaxWidth, addrLineH);
      }

      // Adiciona frame
      encoder.addFrame(ctx);
    }

    // 7) Finaliza
    encoder.finish();
    console.log(`[ASSINATURA] OK ${BUILD_VERSION}`);
  } catch (error) {
    console.error('[ASSINATURA] ERRO:', error);
    if (!res.headersSent) {
      res
        .status(500)
        .send(`Erro interno crítico no servidor ao processar o GIF. Detalhe: ${error.message}`);
    } else {
      console.error('Erro após início do stream; resposta pode estar incompleta.');
    }
  }
};

/* ============================================
   R O T A S
   ============================================ */

// Outras empresas
app.post('/generate-gif-signature', (req, res) => handleGifGeneration(req, res, false));
// Trilha (com QR)
app.post('/generate-trilha-signature', (req, res) => handleGifGeneration(req, res, true));

// Healthcheck & versão
app.get('/version', (_req, res) => res.json({ version: BUILD_VERSION }));
app.get('/', (_req, res) => res.send(`Servidor no ar! build=${BUILD_VERSION}`));

/* ============================================
   S U B I N D O   S E R V I D O R
   ============================================ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT} | build=${BUILD_VERSION}`);
});

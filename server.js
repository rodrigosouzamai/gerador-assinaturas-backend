// --- SERVIDOR NODE.JS PARA GERAÇÃO DE ASSINATURAS (RAILWAY/RENDER - VERSÃO ESTÁVEL & RESPONSIVA) ---

const express = require('express');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const gifFrames = require('gif-frames');
const GifEncoder = require('gif-encoder-2');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

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

/* ============================================
   L Ó G I C A   D E   G E R A Ç Ã O   D E   G I F
   ============================================ */

const handleGifGeneration = async (req, res, isTrilha = false) => {
  const { name, title, phone, gifUrl, qrCodeData } = req.body;

  // Validações
  if (!gifUrl || !name || !title || !phone) {
    return res
      .status(400)
      .send('Erro: faltam parâmetros obrigatórios (nome, cargo, telefone, gifUrl).');
  }
  if (isTrilha && !qrCodeData) {
    return res.status(400).send('Erro: QR Code é obrigatório para a assinatura da Trilha.');
  }

  try {
    console.log(`[ASSINATURA] Início | empresa=${isTrilha ? 'Trilha' : 'Outra'} | nome=${name}`);

    // 1) Baixa o GIF de origem
    const gifResp = await fetch(gifUrl);
    if (!gifResp.ok) {
      throw new Error(`Falha ao buscar GIF (${gifResp.status} ${gifResp.statusText})`);
    }
    const gifBuffer = await gifResp.buffer();

    // 2) Extrai frames como PNG (evita DOM/document)
    const frames = await gifFrames({
      url: gifBuffer,
      frames: 'all',
      outputType: 'png'
    });

    if (!frames || frames.length === 0) {
      throw new Error('Nenhum frame encontrado no GIF.');
    }

    // 3) Dimensões a partir do primeiro frame
    const firstBuf = await streamToBuffer(frames[0].getImage());
    const firstImg = await loadImage(firstBuf);
    const width = firstImg.width;
    const height = firstImg.height;

    // 4) Configura encoder e resposta (stream)
    res.setHeader('Content-Type', 'image/gif');
    const encoder = new GifEncoder(width, height, 'neuquant', true);
    encoder.createReadStream().pipe(res);

    encoder.start();
    encoder.setRepeat(0); // loop infinito
    encoder.setQuality(10); // 1 (melhor) a 30 (pior)

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 5) Pré-carrega QR (se Trilha)
    let qrImage = null;
    if (isTrilha) {
      try {
        qrImage = await loadImage(qrCodeData);
      } catch (e) {
        throw new Error('Falha ao carregar QR Code (qrCodeData inválido?).');
      }
    }

    // 6) Processa frames
    for (const f of frames) {
      const delayMs = (f.frameInfo?.delay ?? 10) * 10; // fallback seguro
      encoder.setDelay(delayMs);

      // Converte frame (stream PNG) para imagem
      const frameBuf = await streamToBuffer(f.getImage());
      const frameImg = await loadImage(frameBuf);

      // Desenha base
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(frameImg, 0, 0, width, height);

      // ======= POSICIONAMENTO RESPONSIVO =======
      const padding = 16;

      // Tamanho do QR: limitado para caber com margem; evita cortar
      const qrSize = isTrilha
        ? Math.min(120, Math.max(80, Math.min(height - padding * 2, width * 0.25)))
        : 0; // só Trilha usa QR

      // Reserva área à direita para o QR
      const rightReserved = isTrilha ? qrSize + padding * 2 : 0;

      // Safe area para textos (lado esquerdo), respeitando logo da Trilha
      const textLeft = 140; // deixa espaço pro logo
      const textRight = width - rightReserved - padding;
      const textMaxWidth = Math.max(0, textRight - textLeft);

      // Posição do QR (direita, centralizado na vertical)
      const qrX = width - padding - qrSize;
      const qrY = Math.round((height - qrSize) / 2);

      // ======= DESENHO DE QR E TEXTOS =======
      if (isTrilha) {
        // Fundo claro atrás do QR para contraste
        if (qrImage) {
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.fillRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12);
          ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
        }

        // Textos Trilha
        ctx.fillStyle = '#0E2923';
        ctx.textBaseline = 'top';

        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(name, textLeft, 26, textMaxWidth);

        ctx.font = '14px sans-serif';
        ctx.fillText(title, textLeft, 48, textMaxWidth);

        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(phone, textLeft, 68, textMaxWidth);
      } else {
        // Fundo de contraste opcional (útil em GIFs claros, ex.: Pinterest)
        const badgeX = 150;
        const badgeY = 18;
        const badgeW = 240;
        const badgeH = 70;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(badgeX, badgeY, badgeW, badgeH);

        ctx.fillStyle = '#FFFFFF';
        ctx.textBaseline = 'top';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(name, badgeX + 10, badgeY + 10, badgeW - 20);

        ctx.font = '13px sans-serif';
        ctx.fillText(title, badgeX + 10, badgeY + 32, badgeW - 20);
        ctx.fillText(phone, badgeX + 10, badgeY + 50, badgeW - 20);
      }

      // Adiciona frame
      encoder.addFrame(ctx);
    }

    // 7) Finaliza
    encoder.finish();
    console.log('[ASSINATURA] Concluído com sucesso.');
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

// Rotas principais usadas pelo front (sem prefixo)
app.post('/generate-gif-signature', (req, res) => handleGifGeneration(req, res, false));
app.post('/generate-trilha-signature', (req, res) => handleGifGeneration(req, res, true));

// Healthcheck
app.get('/test-connection', (_req, res) =>
  res.json({ status: 'ok', message: 'Backend operacional.' })
);

// Root
app.get('/', (_req, res) => res.send('PROVA: Servidor vRAILWAY-STABLE está no ar!'));

/* ============================================
   S U B I N D O   S E R V I D O R
   ============================================ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

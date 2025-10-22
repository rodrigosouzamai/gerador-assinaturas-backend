// --- SERVIDOR NODE.JS PARA GERAÇÃO DE ASSINATURAS (RAILWAY/RENDER - LAYOUT MAIOR) ---

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
  origin: 'https://octopushelpdesk.com.br', // ajuste se precisar liberar outro domínio
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

// Converte um stream (gif-frames em PNG) para Buffer
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
    return res.status(400).send('Erro: faltam parâmetros obrigatórios (nome, cargo, telefone, gifUrl).');
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

    // 3) Dimensões a partir do primeiro frame (PNG)
    const firstBuf = await streamToBuffer(frames[0].getImage());
    const firstImg = await loadImage(firstBuf);
    const width = firstImg.width;
    const height = firstImg.height;
    console.log(`[ASSINATURA] Dimensões detectadas: ${width}x${height}`);

    // 4) Configura encoder e resposta (stream)
    res.setHeader('Content-Type', 'image/gif');
    const encoder = new GifEncoder(width, height, 'neuquant', true);
    encoder.createReadStream().pipe(res);

    encoder.start();
    encoder.setRepeat(0);   // loop infinito
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

    // --- Constantes de Layout MAIORES ---
    // QR Code ocupa ~30% da largura, mínimo 100px, máximo 150px
    const qrWidth = Math.max(100, Math.min(150, width * 0.30));
    const qrHeight = qrWidth;
    const qrMarginRight = 15;
    const qrMarginTop = 10;
    const qrX = width - qrWidth - qrMarginRight;
    // Tenta centralizar verticalmente, com margem mínima
    const qrY = (height - qrHeight) / 2 > qrMarginTop ? (height - qrHeight) / 2 : qrMarginTop;

    // Área estimada do logo (esquerda) - Mantendo ~40%
    const logoAreaWidth = width * 0.40;

    // Área para texto - Começa mais tarde, termina antes do QR/borda
    const textStartX = logoAreaWidth + 20; // Mais margem
    let textEndX = width - 20; // Mais margem direita
    if (isTrilha) {
        textEndX = qrX - 20; // Mais margem antes do QR
    }
    const textAvailableWidth = Math.max(50, textEndX - textStartX); // Garante largura mínima

    // 6) Processa frames
    for (const f of frames) {
      const delayMs = (f.frameInfo?.delay ?? 10) * 10; // fallback seguro
      encoder.setDelay(delayMs > 10 ? delayMs : 100); // Garante delay mínimo

      // Converte o frame (stream PNG) para imagem de canvas
      const frameBuf = await streamToBuffer(f.getImage());
      const frameImg = await loadImage(frameBuf);

      // Desenha base
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(frameImg, 0, 0, width, height);

      // --- DESENHO COM LAYOUT MAIOR ---
      if (isTrilha) {
        // Desenha QR
        if (qrImage) {
          ctx.drawImage(qrImage, qrX, qrY, qrWidth, qrHeight);
        }
        // Textos (Trilha) - Fontes BEM Maiores
        ctx.fillStyle = '#0E2923'; // Cor escura para Trilha
        // Tamanho base ~20% da altura, mínimo 18px, máximo 24px
        const trilhaBaseFontSize = Math.max(18, Math.min(24, height * 0.20));
        const trilhaLineSpacing = trilhaBaseFontSize * 0.5; // Maior espaçamento
        const trilhaNameFontSize = trilhaBaseFontSize + 6; // Nome ainda maior
        // Recalcula altura do bloco de texto e posição Y inicial
        const trilhaTextBlockHeight = (trilhaNameFontSize + trilhaLineSpacing + trilhaBaseFontSize + trilhaLineSpacing + trilhaBaseFontSize);
        let trilhaCurrentY = (height - trilhaTextBlockHeight) / 2 + trilhaNameFontSize;
        if (trilhaCurrentY < trilhaNameFontSize + 10) trilhaCurrentY = trilhaNameFontSize + 10; // Margem topo maior

        ctx.font = `bold ${trilhaNameFontSize}px sans-serif`;
        ctx.fillText(name, textStartX, trilhaCurrentY, textAvailableWidth);

        trilhaCurrentY += trilhaBaseFontSize + trilhaLineSpacing;
        ctx.font = `${trilhaBaseFontSize}px sans-serif`;
        ctx.fillText(title, textStartX, trilhaCurrentY, textAvailableWidth);

        trilhaCurrentY += trilhaBaseFontSize + trilhaLineSpacing;
        ctx.font = `bold ${trilhaBaseFontSize}px sans-serif`;
        ctx.fillText(phone, textStartX, trilhaCurrentY, textAvailableWidth);

      } else {
        // Textos padrão (outras empresas) - Fontes Maiores, Branco Padrão
        ctx.fillStyle = '#FFFFFF'; // Branco como padrão
        // Tamanho base ~18% da altura, mínimo 16px, máximo 20px
        const baseFontSize = Math.max(16, Math.min(20, height * 0.18));
        const lineSpacing = baseFontSize * 0.4; // Maior espaçamento
        const nameFontSize = baseFontSize + 4; // Nome maior
        // Recalcula altura do bloco de texto e posição Y inicial
        const textBlockHeight = (nameFontSize + lineSpacing + baseFontSize + lineSpacing + baseFontSize);
        let currentY = (height - textBlockHeight) / 2 + nameFontSize;
        if (currentY < nameFontSize + 10) currentY = nameFontSize + 10; // Margem topo maior

        ctx.font = `bold ${nameFontSize}px sans-serif`;
        ctx.fillText(name, textStartX, currentY, textAvailableWidth);

        currentY += baseFontSize + lineSpacing;
        ctx.font = `${baseFontSize}px sans-serif`;
        ctx.fillText(title, textStartX, currentY, textAvailableWidth);

        currentY += baseFontSize + lineSpacing;
        ctx.font = `${baseFontSize}px sans-serif`;
        ctx.fillText(phone, textStartX, currentY, textAvailableWidth);
      }
      // --- FIM DESENHO COM LAYOUT MAIOR ---

      // Adiciona frame
      encoder.addFrame(ctx);
    }

    // 7) Finaliza
    encoder.finish();
    console.log('[ASSINATURA] Concluído com sucesso.');
  } catch (error) {
    console.error('[ASSINATURA] ERRO:', error);
    if (!res.headersSent) {
      res.status(500).send(`Erro interno crítico no servidor ao processar o GIF. Detalhe: ${error.message}`);
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

// Healthcheck simples
app.get('/test-connection', (_req, res) => res.json({ status: 'ok', message: 'Backend operacional.' }));

// Root (vRAILWAY-LAYOUT-LARGER) - Nova versão para prova
app.get('/', (_req, res) => res.send('PROVA: Servidor vRAILWAY-LAYOUT-LARGER está no ar!'));

/* ============================================
   S U B I N D O   S E R V I D O R
   ============================================ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});


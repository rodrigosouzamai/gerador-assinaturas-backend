// --- SERVIDOR NODE.JS PARA GERAÇÃO DE ASSINATURAS (OTIMIZADO PARA RAILWAY/RENDER - VERSÃO ESTÁVEL) ---

const express = require('express');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const getFrames = require('gif-frames');
const GifEncoder = require('gif-encoder-2');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração explícita de CORS para permitir SOMENTE o seu domínio
const corsOptions = {
  origin: 'https://octopushelpdesk.com.br',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Pré-autoriza pedidos OPTIONS

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Função unificada para gerar GIFs
const handleGifGeneration = async (req, res, isTrilha = false) => {
    const { name, title, phone, gifUrl, qrCodeData } = req.body;

    // Validação robusta
    if (!gifUrl || !name || !title || !phone) {
        console.error("Erro: Parâmetros obrigatórios em falta.", req.body);
        return res.status(400).send('Erro: Faltam parâmetros obrigatórios (nome, cargo, telefone, URL do GIF).');
    }
    if (isTrilha && !qrCodeData) {
        console.error("Erro: QR Code em falta para Trilha.", req.body);
        return res.status(400).send('Erro: QR Code é obrigatório para a assinatura da Trilha.');
    }

    try {
        console.log(`Iniciando geração para ${name}, Empresa: ${isTrilha ? 'Trilha' : 'Outra'}, URL: ${gifUrl}`);

        // Etapa 1: Buscar o GIF
        console.log("Etapa 1: Buscando GIF...");
        const gifBufferResponse = await fetch(gifUrl);
        if (!gifBufferResponse.ok) {
            console.error(`Falha ao buscar GIF: ${gifBufferResponse.status} ${gifBufferResponse.statusText}`, { url: gifUrl });
            throw new Error(`Falha ao buscar o GIF (${gifBufferResponse.status})`);
        }
        const gifBuffer = await gifBufferResponse.buffer();
        console.log("Etapa 1: GIF buscado com sucesso.");

        // Etapa 2: Decodificar os frames do GIF
        console.log("Etapa 2: Decodificando frames...");
        const frameData = await getFrames({ url: gifBuffer, frames: 'all', outputType: 'canvas', napiCanvas: true });
        console.log(`Etapa 2: ${frameData.length} frames decodificados.`);

        const { width, height } = frameData[0].getImage();
        console.log(`Dimensões do GIF: ${width}x${height}`);

        res.setHeader('Content-Type', 'image/gif');
        const encoder = new GifEncoder(width, height, 'neuquant', true);

        // Pipe a saída diretamente para a resposta
        encoder.createReadStream().pipe(res);

        encoder.start();
        encoder.setRepeat(0); // Loop infinito
        encoder.setQuality(10); // Qualidade (1-30, menor é melhor)

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        let qrImage = null;
        if (isTrilha) {
             // Etapa 3: Carregar imagem do QR Code (se Trilha)
             console.log("Etapa 3: Carregando QR Code...");
             qrImage = await loadImage(qrCodeData);
             console.log("Etapa 3: QR Code carregado.");
        } else {
             console.log("Etapa 3: Não é Trilha, pulando QR Code.");
        }


        // Etapa 4: Processar e editar cada frame
        console.log("Etapa 4: Iniciando processamento dos frames...");
        let frameCount = 0;
        for (const frame of frameData) {
            frameCount++;
            const frameDelay = frame.frameInfo.delay * 10; // Converte para ms
            encoder.setDelay(frameDelay);

            // Limpa e desenha o frame original
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(frame.getImage(), 0, 0, width, height);

            // Desenha o texto e QR Code (se aplicável)
            if (isTrilha) {
                // Desenha QR Code
                if (qrImage) {
                    ctx.drawImage(qrImage, width - 120, 5, 110, 110);
                }
                // Desenha texto para Trilha
                ctx.fillStyle = '#0E2923';
                ctx.font = 'bold 18px sans-serif'; // Fonte genérica
                ctx.fillText(name, 160, 50);
                ctx.font = '14px sans-serif';
                ctx.fillText(title, 160, 70);
                ctx.font = 'bold 14px sans-serif';
                ctx.fillText(phone, 160, 90);
            } else {
                // Desenha texto para outras empresas
                ctx.fillStyle = '#FFFFFF'; // Cor Padrão Branca (simplificado)
                 // Se quiser cores específicas de volta, adicionar lógica aqui, mas testar cuidadosamente
                ctx.font = 'bold 16px sans-serif';
                ctx.fillText(name, 170, 45);
                ctx.font = '13px sans-serif';
                ctx.fillText(title, 170, 65);
                ctx.fillText(phone, 170, 85);
            }

            // Adiciona o frame editado ao novo GIF
            encoder.addFrame(ctx);
            // console.log(`Frame ${frameCount} processado.`); // Log opcional (pode poluir)
        }
        console.log("Etapa 4: Todos os frames processados.");

        // Etapa 5: Finalizar a codificação do novo GIF
        console.log("Etapa 5: Finalizando GIF...");
        encoder.finish();
        console.log("Etapa 5: GIF finalizado e enviado.");

    } catch (error) {
        // Etapa de Erro: Captura e envia o erro detalhado
        console.error("ERRO CRÍTICO NO PROCESSAMENTO:", error.message, error.stack);
        if (!res.headersSent) {
             // Envia uma resposta de erro clara para o frontend
             res.status(500).send(`Erro interno crítico no servidor ao processar o GIF. Detalhe: ${error.message}`);
        } else {
             // Se os headers já foram enviados (stream começou), apenas loga.
             console.error("Erro após início do stream. Resposta pode estar incompleta.");
        }
    }
};

// --- ROTAS DA API ---
app.post('/generate-gif-signature', (req, res) => {
    handleGifGeneration(req, res, false);
});
app.post('/generate-trilha-signature', (req, res) => {
    handleGifGeneration(req, res, true);
});

// Rota raiz para verificação (vRAILWAY-STABLE)
app.get('/', (req, res) => {
    res.send('PROVA: Servidor vRAILWAY-STABLE está no ar!'); // Nova versão para confirmação
});

// Inicia o servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});


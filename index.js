require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const https = require('https'); 

const app = express();

app.use(express.raw({ type: 'application/json' }));
app.use(express.json());

// Agente HTTPS para ignorar validação de certificado (útil para alguns ambientes ou APIs)
const agent = new https.Agent({
    rejectUnauthorized: false
});

// --- Variáveis de Ambiente da Jadlog e Yampi ---
const YAMPI_SECRET_TOKEN = process.env.YAMPI_SECRET_TOKEN;
const JADLOG_API_TOKEN = process.env.JADLOG_TOKEN; // Usando JADLOG_TOKEN do .env
const JADLOG_COD_CLIENTE = process.env.COD_CLIENTE; // Usando COD_CLIENTE do .env para 'conta'
const JADLOG_CNPJ_REMETENTE = process.env.JADLOG_USER; // Usando JADLOG_USER do .env para 'cnpj'
// NOTA: CONTA_CORRENTE e TIPO_FRETE/MODALIDADE do seu .env
// serão usados diretamente no payload, não como variáveis separadas aqui.
// Modalidade 3 é rodoviário (modalidade padrão da sua doc)

app.post('/cotacao', async (req, res) => {
    console.log('Headers Recebidos:', req.headers);

    const yampiSignature = req.headers['x-yampi-hmac-sha256'];
    const requestBodyRaw = req.body;

    // --- Validação de Segurança Yampi ---
    if (!yampiSignature || !YAMPI_SECRET_TOKEN) {
        console.error('Erro de Segurança: Assinatura Yampi ou Chave Secreta ausente.');
        return res.status(401).json({ error: 'Acesso não autorizado.' });
    }

    let calculatedSignature;
    try {
        const hmac = crypto.createHmac('sha256', YAMPI_SECRET_TOKEN);
        const parsedBody = JSON.parse(requestBodyRaw.toString('utf8'));
        const normalizedBodyString = JSON.stringify(parsedBody);
        hmac.update(normalizedBodyString);
        calculatedSignature = hmac.digest('base64');
    } catch (error) {
        console.error('Erro ao calcular a assinatura HMAC:', error.message);
        return res.status(500).json({ error: 'Erro interno na validação de segurança.' });
    }

    if (calculatedSignature !== yampiSignature) {
        console.error('Erro de Segurança: Assinatura Yampi inválida. Calculada:', calculatedSignature, 'Recebida:', yampiSignature);
        return res.status(401).json({ error: 'Acesso não autorizado. Assinatura Yampi inválida.' });
    }

    console.log('Validação de segurança Yampi: SUCESSO!');

    try {
        const yampiData = JSON.parse(requestBodyRaw.toString('utf8'));
        console.log('Payload Yampi Recebido:', JSON.stringify(yampiData, null, 2));

        const cepOrigem = "30720404"; // CEP de origem fixo
        const cepDestino = yampiData.zipcode ? yampiData.zipcode.replace(/\D/g, '') : null;
        const valorDeclarado = yampiData.amount || 0;

        let pesoTotal = 0;
        // let qtdeVolumeTotal = 0; // Não usado diretamente no payload Jadlog para peso/cubagem total

        if (yampiData.skus && Array.isArray(yampiData.skus)) {
            yampiData.skus.forEach(sku => {
                const pesoItem = sku.weight || 0;
                const quantidadeItem = sku.quantity || 1;
                
                pesoTotal += pesoItem * quantidadeItem;
                // Para a Jadlog, parece que o peso total é enviado, não volumes individuais de cubagem.
            });
        }

        const opcoesFrete = [];

        // --- Cotação Jadlog ---
        try {
            // As variáveis do .env agora são usadas diretamente nos campos apropriados
            const payloadJadlog = {
                "frete": [
                    {
                        "cepori": cepOrigem,
                        "cepdes": cepDestino,
                        "frap": null, // Não definido no .env, usar null conforme doc
                        "peso": pesoTotal,
                        "cnpj": JADLOG_CNPJ_REMETENTE, // Usando JADLOG_USER do .env
                        "conta": JADLOG_COD_CLIENTE, // Usando COD_CLIENTE do .env
                        "contrato": null, // Não definido no .env, usar null conforme doc
                        "modalidade": process.env.MODALIDADE ? parseInt(process.env.MODALIDADE) : 3, // Usando MODALIDADE do .env, default 3
                        "tpentrega": process.env.TIPO_FRETE === '0' ? 'D' : 'P', // Exemplo: '0' para Domiciliar, outro para Posta (verificar doc Jadlog)
                        "tpseguro": "N", // Tipo de seguro (N = Normal, A = Apólice)
                        "vldeclarado": valorDeclarado,
                        "vlcoleta": 0 // Valor da coleta (0 se não houver)
                    },
                    // Você pode adicionar outras modalidades aqui se desejar.
                    // Exemplo para Modalidade 5 (Jadlog Expresso)
                    {
                        "cepori": cepOrigem,
                        "cepdes": cepDestino,
                        "frap": null,
                        "peso": pesoTotal,
                        "cnpj": JADLOG_CNPJ_REMETENTE,
                        "conta": JADLOG_COD_CLIENTE,
                        "contrato": null,
                        "modalidade": 5, 
                        "tpentrega": process.env.TIPO_FRETE === '0' ? 'D' : 'P',
                        "tpseguro": "N",
                        "vldeclarado": valorDeclarado,
                        "vlcoleta": 0
                    }
                ]
            };

            console.log('Payload Jadlog Enviado:', JSON.stringify(payloadJadlog, null, 2));

            const jadlogApiUrl = `https://www.jadlog.com.br/embarcador/api/frete/valor`; 

            const responseJadlog = await axios.post(
                jadlogApiUrl,
                payloadJadlog,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${JADLOG_API_TOKEN}` // Usando o token JWT Jadlog
                    },
                    httpsAgent: agent 
                }
            );

            // Resposta da Jadlog é um array de objetos de frete
            if (responseJadlog.data && Array.isArray(responseJadlog.data.frete)) {
                responseJadlog.data.frete.forEach(freteItem => {
                    // Verifica se a cotação foi bem-sucedida para esta modalidade
                    if (freteItem.modalidade && freteItem.vlrTotal !== undefined && freteItem.prazo !== undefined) {
                        let serviceName = `Jadlog Modalidade ${freteItem.modalidade}`; 
                        if (freteItem.modalidade === 3) serviceName = "Jadlog Rodoviário";
                        if (freteItem.modalidade === 5) serviceName = "Jadlog Expresso";
                        // Adicione mais mapeamentos para outras modalidades se necessário

                        opcoesFrete.push({
                            "name": serviceName,
                            "service": `Jadlog_${freteItem.modalidade}`,
                            "price": freteItem.vlrTotal,
                            "days": freteItem.prazo,
                            "quote_id": `jadlog_cotacao_${freteItem.modalidade}`
                        });
                    } else if (freteItem.status && freteItem.status.msg) {
                        // Loga erros específicos para cada modalidade se houver
                        console.warn(`Jadlog: Erro na modalidade ${freteItem.modalidade}: ${freteItem.status.msg}`);
                    }
                });
                console.log('Cotação Jadlog SUCESSO! Opções encontradas:', opcoesFrete.length);
            } else {
                console.warn('Resposta da Jadlog não contém dados de frete esperados ou está vazia:', JSON.stringify(responseJadlog.data, null, 2));
            }

        } catch (error) {
            console.error('Erro na requisição Jadlog ou processamento:', error.message);
            if (error.response && error.response.data) {
                console.error('Detalhes do erro da Jadlog:', JSON.stringify(error.response.data, null, 2));
            } else {
                console.error('Nenhum detalhe de resposta de erro da Jadlog disponível.');
            }
        }

        const respostaFinalYampi = {
            "quotes": opcoesFrete
        };

        console.log('Resposta FINAL enviada para Yampi:', JSON.stringify(respostaFinalYampi, null, 2));
        res.json(respostaFinalYampi);

    } catch (erro) {
        console.error('Erro geral no processamento do webhook:', erro.message);
        return res.status(500).json({ erro: 'Erro interno no servidor de cotação.' });
    }
});

app.get('/', (req, res) => {
    res.send('Middleware da Jadlog rodando');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
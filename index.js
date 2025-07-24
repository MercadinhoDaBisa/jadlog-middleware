require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const https = require('https'); 

const app = express();

app.use(express.raw({ type: 'application/json' }));
app.use(express.json());

const agent = new https.Agent({
    rejectUnauthorized: false
});

// --- Variáveis de Ambiente ---
const YAMPI_SECRET_TOKEN = process.env.YAMPI_SECRET_TOKEN;
const JADLOG_TOKEN = process.env.JADLOG_TOKEN; // Este deve ser o TOKEN da API da Jadlog
const JADLOG_ID_EMPRESA = process.env.JADLOG_ID_EMPRESA; // Este é o 'conta'
const JADLOG_CPF_CNPJ = process.env.JADLOG_CPF_CNPJ; // Este é o 'cnpj' do remetente
// JADLOG_PASSWORD não é mais necessário para autenticação via Bearer Token, mas pode ser útil para outros endpoints.

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
        let qtdeVolumeTotal = 0;

        if (yampiData.skus && Array.isArray(yampiData.skus)) {
            yampiData.skus.forEach(sku => {
                const pesoItem = sku.weight || 0;
                const quantidadeItem = sku.quantity || 1;
                // const comprimento = sku.length || 0; // Não usado diretamente no payload Jadlog
                // const largura = sku.width || 0;     // Não usado diretamente no payload Jadlog
                // const altura = sku.height || 0;      // Não usado diretamente no payload Jadlog

                pesoTotal += pesoItem * quantidadeItem;
                qtdeVolumeTotal += quantidadeItem; 
            });
        }

        const opcoesFrete = [];

        // --- Cotação Jadlog ---
        try {
            // <<<<<<< ATENÇÃO AQUI! ALTERAÇÕES DE AUTENTICAÇÃO E PAYLOAD
            const payloadJadlog = {
                "frete": [
                    {
                        "cepori": cepOrigem,
                        "cepdes": cepDestino,
                        "frap": null, // Conforme documentação
                        "peso": pesoTotal,
                        "cnpj": JADLOG_CPF_CNPJ, // CNPJ do remetente
                        "conta": JADLOG_ID_EMPRESA, // Conta do correntista (ou null se não for)
                        "contrato": null, // Conforme documentação
                        "modalidade": 3, // Modalidade Rodoviário (exemplo da doc)
                        "tpentrega": "D", // Tipo de entrega (D = Domiciliar)
                        "tpseguro": "N", // Tipo de seguro (N = Normal, A = Apólice)
                        "vldeclarado": valorDeclarado,
                        "vlcoleta": 0 // Valor da coleta (0 se não houver)
                    },
                    // Você pode adicionar outras modalidades aqui se desejar, como a 5 (Jadlog Expresso)
                    {
                        "cepori": cepOrigem,
                        "cepdes": cepDestino,
                        "frap": null,
                        "peso": pesoTotal,
                        "cnpj": JADLOG_CPF_CNPJ,
                        "conta": JADLOG_ID_EMPRESA,
                        "contrato": null,
                        "modalidade": 5, // Exemplo: Jadlog Expresso
                        "tpentrega": "D",
                        "tpseguro": "N",
                        "vldeclarado": valorDeclarado,
                        "vlcoleta": 0
                    }
                ]
            };
            // <<<<<<< FIM ALTERAÇÕES DE PAYLOAD

            console.log('Payload Jadlog Enviado:', JSON.stringify(payloadJadlog, null, 2));

            const jadlogApiUrl = `https://www.jadlog.com.br/embarcador/api/frete/valor`; 

            const responseJadlog = await axios.post(
                jadlogApiUrl,
                payloadJadlog,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        // <<<<<<< ATENÇÃO AQUI! NOVO CABEÇALHO DE AUTENTICAÇÃO (Bearer Token)
                        'Authorization': `Bearer ${JADLOG_TOKEN}` 
                    },
                    httpsAgent: agent 
                }
            );

            if (responseJadlog.data && Array.isArray(responseJadlog.data.frete)) {
                responseJadlog.data.frete.forEach(freteItem => {
                    if (freteItem.modalidade && freteItem.vlrTotal && freteItem.prazo) {
                        let serviceName = `Jadlog ${freteItem.modalidade}`; // Nome genérico
                        if (freteItem.modalidade === 3) serviceName = "Jadlog Rodoviário";
                        if (freteItem.modalidade === 5) serviceName = "Jadlog Expresso";
                        // Adicione mais mapeamentos se tiver outras modalidades

                        opcoesFrete.push({
                            "name": serviceName,
                            "service": `Jadlog_${freteItem.modalidade}`,
                            "price": freteItem.vlrTotal,
                            "days": freteItem.prazo,
                            "quote_id": `jadlog_cotacao_${freteItem.modalidade}`
                        });
                    } else if (freteItem.status && freteItem.status.msg) {
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
                console.error('Detalhes do erro da Jadlog:', error.response.data);
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
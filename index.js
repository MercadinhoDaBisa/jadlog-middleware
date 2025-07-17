require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(express.json());

const agent = new https.Agent({
  rejectUnauthorized: false
});

const YAMPI_SECRET_TOKEN = process.env.YAMPI_SECRET_TOKEN;

app.post('/cotacao', async (req, res) => {
  const yampiToken = req.headers['x-yampi-token'];

  if (!yampiToken || yampiToken !== YAMPI_SECRET_TOKEN) {
    return res.status(401).json({ error: 'Acesso não autorizado. Token Yampi inválido.' });
  }

  try {
    const {
      totPeso,
      totValor,
      des,
      volume
    } = req.body;

    const payloadCotacao = {
      rem: {
        cnpjCpf: "59554346000184", // CNPJ do Mercadinho da Bisa
        cep: "30720404"
      },
      des: {
        cnpjCpf: des.cnpjCpf || null,
        cep: des.cep
      },
      vlrMerc: totValor,
      pesoEfetivo: totPeso,
      modalidade: parseInt(process.env.MODALIDADE),
      tipoFrete: parseInt(process.env.TIPO_FRETE),
      frap: false,
      cte: false,
      entregaParcial: false,
      volumes: volume.map(vol => ({
        peso: vol.peso,
        altura: vol.altura,
        largura: vol.largura,
        comprimento: vol.comprimento
      }))
    };

    const respostaJadlog = await axios.post(
      'https://www.jadlog.com.br/embarcador/api/frete/valor',
      payloadCotacao,
      {
        headers: {
          Authorization: `Bearer ${process.env.JADLOG_TOKEN}`,
          'Content-Type': 'application/json'
        },
        httpsAgent: agent
      }
    );

    const opcoesFrete = [];
    if (respostaJadlog.data && Array.isArray(respostaJadlog.data.fretes) && respostaJadlog.data.fretes.length > 0) {
      respostaJadlog.data.fretes.forEach(frete => {
        opcoesFrete.push({
          nome: frete.modalidade || "Jadlog Padrão",
          valor: frete.valorFrete || 0,
          prazo: frete.prazoEntrega || 0
        });
      });
    } else if (respostaJadlog.data && respostaJadlog.data.valorFrete !== undefined && respostaJadlog.data.prazoEntrega !== undefined) {
        opcoesFrete.push({
          nome: "Jadlog Padrão",
          valor: respostaJadlog.data.valorFrete,
          prazo: respostaJadlog.data.prazoEntrega
        });
    }

    res.json(opcoesFrete);

  } catch (erro) {
    console.error('Erro na requisição:', erro.message);
    if (erro.response && erro.response.data) {
        console.error('Detalhes do erro da Jadlog:', erro.response.data);
        return res.status(erro.response.status).json({ erro: erro.response.data });
    }
    return res.status(500).json({ erro: erro.message });
  }
});

app.get('/', (req, res) => {
  res.send('Middleware da JadLog rodando');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

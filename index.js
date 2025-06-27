require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

app.post('/envio-pedido', async (req, res) => {
  try {
    const dadosYampi = req.body;

    const payload = {
      codCliente: process.env.COD_CLIENTE,
      contaCorrente: process.env.CONTA_CORRENTE,
      pedido: [dadosYampi.numero || "pedido-sem-numero"],
      totPeso: dadosYampi.peso || 0.4,
      totValor: dadosYampi.valor || 56.05,
      tipoFrete: parseInt(process.env.TIPO_FRETE),
      modalidade: parseInt(process.env.MODALIDADE),
      tipoColeta: "package",
      rem: {
        nome: "Mercadinho da Bisa",
        endereco: "Rua Progresso, 280",
        bairro: "Padre Eustáquio",
        cidade: "Belo Horizonte",
        uf: "MG",
        cep: "30720404",
        cnpjCpf: "59554346000184"
      },
      origem: {
        cep: "30720404"
      },
      destino: {
        cep: dadosYampi.cep_destino || "88010140"
      },
      volume: [
  {
    peso: 0.4,
    altura: 10,
    largura: 10,
    comprimento: 10,
    vlrMerc: 56.05,
    dfe: [
      {
        serie: "1",
        numero: "123456",
        valor: 56.05
      }
    ]
  }
]
};
    const resposta = await axios.post(
      'https://www.jadlog.com.br/embarcador/api/pedido/incluir',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.JADLOG_TOKEN}`
        }
      }
    );

    return res.status(200).json({ sucesso: true, resposta: resposta.data 
});

  } catch (erro) {
    return res.status(500).json({ erro: erro.message });
  }
});

app.get('/', (req, res) => {
  res.send('Middleware da JadLog rodando');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

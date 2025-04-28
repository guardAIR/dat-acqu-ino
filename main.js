// importa as bibliotecas necessárias
const serialport = require('serialport');
const express = require('express');
const mysql = require('mysql2');

// constantes para configurações
// ------------------------------------------------

const SERIAL_BAUD_RATE = 9600;
const SERVIDOR_PORTA = 3300;

// habilita ou desabilita a inserção de dados no banco de dados
const HABILITAR_OPERACAO_INSERIR = true;

// função para comunicação serial
const serial = async (valoresSensorAnalogico) => {

    // conexão com o banco de dados MySQL
    let poolBancoDados = mysql.createPool({
        host: 'localhost',
        user: 'dataquino',
        password: 'Sptech#2024',
        database: 'airguard',
        port: 3307
    }).promise();

    // lista as portas seriais disponíveis e procura pelo Arduino
    const portas = await serialport.SerialPort.list();
    const portaArduino = portas.find((porta) => porta.vendorId == 2341 && porta.productId == 43);
    if (!portaArduino) {
        throw new Error('O Arduino não foi encontrado em nenhuma porta serial');
    }

    // configura a porta serial com o baud rate especificado
    const arduino = new serialport.SerialPort({
        path: portaArduino.path,
        baudRate: SERIAL_BAUD_RATE
    });

    // evento quando a porta serial é aberta
    arduino.on('open', () => {
        console.log(`A leitura do Arduino foi iniciada na porta ${portaArduino.path} utilizando Baud Rate de ${SERIAL_BAUD_RATE}`);
    });

    // processa os dados recebidos do Arduino
    arduino.pipe(new serialport.ReadlineParser({ delimiter: '\r\n' })).on('data', async (data) => {
        console.log(data);
        const valores = data.split(';');
        const sensorAnalogico = parseFloat(valores[0]);

        // armazena os valores dos sensores nos arrays correspondentes
        valoresSensorAnalogico.push(sensorAnalogico);

        // insere os dados no banco de dados (se habilitado)
        if (HABILITAR_OPERACAO_INSERIR) {
            await poolBancoDados.execute(
                'INSERT INTO airguard.leituraSensor (concentracao_gas, fkSensor) VALUES (?, 1)',
                [sensorAnalogico]
            );
            if (sensorAnalogico > 39) {
                await poolBancoDados.execute(
                    `INSERT INTO airguard.alerta (concentracao_gas, data_hora, fkleituraSensor, nivel_alerta, mensagem_alerta)
	SELECT ls.concentracao_gas, ls.data_hora, ls.id,
		CASE
			WHEN ls.concentracao_gas < 50 THEN 'baixo'
			WHEN ls.concentracao_gas < 80 THEN 'médio'
			WHEN ls.concentracao_gas < 100 THEN 'alto'
			ELSE 'crítico'
		END AS nivel_alerta,
		CASE
			WHEN ls.concentracao_gas < 50 THEN 'Cuidado o nivel de gás está ultrapassando o limite estipulado'
			WHEN ls.concentracao_gas < 80 THEN 'Cuidado o nivel de gás está ultrapassando consideravelmente o limite'
			WHEN ls.concentracao_gas < 100 THEN 'Cuidado o nivel de gás está consideravelmente alto'
			ELSE 'O nivel de gás está extremamente alto'
		END AS mensagem_alerta
	FROM airguard.leituraSensor ls
    LEFT JOIN alerta a on ls.id = a.fkleituraSensor
	WHERE ls.concentracao_gas > 39
    AND a.fkleituraSensor IS NULL;
`
                );
                console.log("Alerta emitido");
            }
            console.log("Valores inseridos no banco: ", sensorAnalogico);
        }
    });

    // evento para lidar com erros na comunicação serial
    arduino.on('error', (mensagem) => {
        console.error(`Erro no Arduino (Mensagem: ${mensagem})`);
    });
}

// função para criar e configurar o servidor web
const servidor = (valoresSensorAnalogico) => {
    const app = express();

    // configurações de requisição e resposta
    app.use((request, response, next) => {
        response.header('Access-Control-Allow-Origin', '*');
        response.header('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept');
        next();
    });

    // inicia o servidor na porta especificada
    app.listen(SERVIDOR_PORTA, () => {
        console.log(`API executada com sucesso na porta ${SERVIDOR_PORTA}`);
    });

    // define os endpoints da API para cada tipo de sensor
    app.get('/sensores/analogico', (_, response) => {
        return response.json(valoresSensorAnalogico);
    });
}

// função principal assíncrona para iniciar a comunicação serial e o servidor web
(async () => {
    // arrays para armazenar os valores dos sensores
    const valoresSensorAnalogico = [];

    // inicia a comunicação serial
    await serial(valoresSensorAnalogico);

    // inicia o servidor web
    servidor(valoresSensorAnalogico);
})();

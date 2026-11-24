const { SerialPort, ReadlineParser } = require("serialport");

function startSerialBridge({ path, port, baseUrl = "http://127.0.0.1",
    SerialPortImpl = SerialPort, ReadlineParserImpl = ReadlineParser, fetchImpl = fetch }) {
    if (!path) {
        console.log("SERVER: serial bridge disabled (ARDUINO_COM_PORT not set)");
        return null;
    }
    const serialPort = new SerialPortImpl({ path, baudRate: 9600 });
    const parser = serialPort.pipe(new ReadlineParserImpl({ delimiter: "\n" }));
    let pending = Promise.resolve();

    parser.on("data", (raw) => {
        const line = raw.trim();
        if (!line.startsWith("{")) return; // Ignore informational Arduino output.
        pending = pending.then(async () => {
            let message;
            try {
                if (line.length > 8192) throw new Error("Oversized serial request");
                message = JSON.parse(line);
                if (!message || !["/api/arduinoPublic1", "/api/newMeasure"].includes(message.api)) {
                    throw new Error("Unsupported serial API");
                }
                const response = await fetchImpl(`${baseUrl}:${port}${message.api}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ value: message.value }),
                    signal: AbortSignal.timeout(120000) // Mining may take time.
                });
                // A newline is necessary: Arduino waits for a line, not a raw byte stream.
                serialPort.write(`${await response.text()}\n`);
            } catch (error) {
                console.error(`SERVER: serial request failed: ${error.message}`);
                serialPort.write("ERROR\n");
            }
        });
    });
    serialPort.on("error", (error) => {
        console.error(`SERVER: serial port error: ${error.message}`);
    });
    console.log(`SERVER: serial port configured: ${path}`);
    return serialPort;
}

module.exports = { startSerialBridge };
